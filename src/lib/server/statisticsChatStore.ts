import { promises as fs } from "node:fs";
import path from "node:path";
import { statisticsChatFingerprint } from "@/lib/statisticsChat";
import type {
  StatisticsChatAnswer,
  StatisticsChatHistory,
  StatisticsChatTurn,
} from "@/types/statisticsChat";

function maxTurns() { return Math.max(1, Math.min(50, Number(process.env.STATISTICS_CHAT_HISTORY_LIMIT || 24))); }
function maxMessages() { return maxTurns() * 2; }
const inflight = new Map<string, Promise<StatisticsChatAnswer>>();

function storageRoot() {
  const configured = process.env.STATISTICS_CHAT_STORAGE_DIR || "data/statistics_chat";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function safeId(value: string) {
  const clean = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "conversation";
  return `${clean}_${statisticsChatFingerprint(value).slice(0, 16)}`;
}

function historyPath(conversationId: string) {
  return path.join(storageRoot(), "history", `${safeId(conversationId)}.json`);
}

function cachePath(key: string) {
  return path.join(storageRoot(), "cache", `${key}.json`);
}

function isSafeCacheKey(key: string) {
  return /^[a-f0-9]{32,128}$/i.test(key);
}

function emptyHistory(conversationId: string): StatisticsChatHistory {
  const now = new Date().toISOString();
  return {
    schemaVersion: "ecowitt.statistics-chat-history.v1",
    conversationId,
    messages: [],
    turns: [],
    createdAt: now,
    updatedAt: now,
    dataRevision: "",
  };
}

function normalizeHistory(value: unknown, conversationId: string): StatisticsChatHistory {
  if (!value || typeof value !== "object") return emptyHistory(conversationId);
  const raw = value as Partial<StatisticsChatHistory>;
  return {
    ...emptyHistory(conversationId),
    ...raw,
    schemaVersion: "ecowitt.statistics-chat-history.v1",
    conversationId,
    messages: Array.isArray(raw.messages) ? raw.messages.filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string") : [],
    turns: Array.isArray(raw.turns) ? raw.turns.filter((item) => item && typeof item.message === "string" && item.result) as StatisticsChatTurn[] : [],
  };
}

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function atomicWrite(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function trim<T>(items: T[], limit: number) {
  return items.length > limit ? items.slice(items.length - limit) : items;
}

function messageKey(item: { role?: string; content?: string }) {
  return `${item.role || ""}\n${String(item.content || "").trim().replace(/\s+/g, " ")}`;
}

function turnKey(turn: Partial<StatisticsChatTurn>) {
  return turn.requestFingerprint || `${turn.message || ""}\n${turn.result?.answer || ""}`;
}

function historyFromTurns(history: StatisticsChatHistory, turns: StatisticsChatTurn[]) {
  const messages = turns.flatMap((turn) => [
    { role: "user" as const, content: turn.message },
    { role: "assistant" as const, content: turn.result.answer },
  ]);
  return {
    ...history,
    turns,
    messages,
  };
}

function stripDeletedContent(value: unknown, deletedContents: Set<string>): unknown {
  if (typeof value === "string") {
    let next = value;
    for (const deleted of deletedContents) {
      if (deleted && next.includes(deleted)) next = next.replaceAll(deleted, "[gelöscht]");
    }
    return next;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        if (!item || typeof item !== "object") return true;
        const content = (item as { content?: unknown }).content;
        return typeof content !== "string" || !deletedContents.has(content);
      })
      .map((item) => stripDeletedContent(item, deletedContents));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, stripDeletedContent(item, deletedContents)]),
  );
}

function stripDeletedTurnFromRemainingTurn(turn: StatisticsChatTurn, deletedTurn: StatisticsChatTurn): StatisticsChatTurn {
  const deletedContents = new Set([deletedTurn.message, deletedTurn.result.answer].filter(Boolean));
  return stripDeletedContent(turn, deletedContents) as StatisticsChatTurn;
}

export async function readStatisticsChatHistory(conversationId: string) {
  const parsed = await readJson(historyPath(conversationId));
  return normalizeHistory(parsed, conversationId);
}

export async function writeStatisticsChatHistory(history: StatisticsChatHistory) {
  const normalized = normalizeHistory(history, history.conversationId);
  normalized.messages = trim(normalized.messages, maxMessages());
  normalized.turns = trim(normalized.turns, maxTurns());
  normalized.updatedAt = new Date().toISOString();
  await atomicWrite(historyPath(history.conversationId), normalized);
  return normalized;
}

export async function appendStatisticsChatTurn(
  conversationId: string,
  turn: StatisticsChatTurn,
  dataRevision: string,
) {
  const history = await readStatisticsChatHistory(conversationId);
  const messages = [...history.messages];
  for (const message of [
    { role: "user" as const, content: turn.message },
    { role: "assistant" as const, content: turn.result.answer },
  ]) {
    if (!messages.some((existing) => messageKey(existing) === messageKey(message))) messages.push(message);
  }
  const existingTurnIndex = history.turns.findIndex((existing) => turnKey(existing) === turnKey(turn));
  if (existingTurnIndex === -1) {
    history.turns.push(turn);
  } else {
    history.turns[existingTurnIndex] = {
      ...history.turns[existingTurnIndex],
      ...turn,
      createdAt: history.turns[existingTurnIndex].createdAt || turn.createdAt,
    };
  }
  history.messages = messages;
  history.dataRevision = dataRevision;
  return writeStatisticsChatHistory(history);
}

export async function mergeStatisticsChatHistory(conversationId: string, incoming: Partial<StatisticsChatHistory>) {
  const history = await readStatisticsChatHistory(conversationId);
  const messages = Array.isArray(incoming.messages) ? incoming.messages : [];
  const turns = Array.isArray(incoming.turns) ? incoming.turns : [];
  for (const message of messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") continue;
    if (!history.messages.some((existing) => messageKey(existing) === messageKey(message))) history.messages.push(message);
  }
  for (const turn of turns) {
    if (!turn || typeof turn.message !== "string" || !turn.result) continue;
    if (!history.turns.some((existing) => turnKey(existing) === turnKey(turn))) history.turns.push(turn);
  }
  return writeStatisticsChatHistory(history);
}

export async function deleteStatisticsChatCacheKeys(keys: Iterable<string>) {
  const uniqueKeys = [...new Set([...keys].filter(Boolean))];
  let deletedCacheEntries = 0;
  let skippedCacheKeys = 0;
  for (const key of uniqueKeys) {
    if (!isSafeCacheKey(key)) {
      skippedCacheKeys += 1;
      continue;
    }
    try {
      await fs.unlink(cachePath(key));
      deletedCacheEntries += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { deletedCacheEntries, skippedCacheKeys };
}

export async function deleteStatisticsChatHistory(conversationId: string, options: { deleteCache?: boolean } = {}) {
  const existingHistory = await readStatisticsChatHistory(conversationId);
  const cacheResult = options.deleteCache
    ? await deleteStatisticsChatCacheKeys(existingHistory.turns.map((turn) => turn.requestFingerprint))
    : { deletedCacheEntries: 0, skippedCacheKeys: 0 };
  await fs.rm(historyPath(conversationId), { force: true });
  return { history: emptyHistory(conversationId), ...cacheResult };
}

export async function deleteStatisticsChatTurn(
  conversationId: string,
  selector: { requestFingerprint: string; createdAt?: string },
  options: { deleteCache?: boolean } = {},
) {
  const history = await readStatisticsChatHistory(conversationId);
  const index = history.turns.findIndex((turn) => {
    if (turn.requestFingerprint !== selector.requestFingerprint) return false;
    return !selector.createdAt || turn.createdAt === selector.createdAt;
  });
  if (index === -1) {
    return {
      history,
      deletedTurns: 0,
      deletedCacheEntries: 0,
      skippedCacheKeys: 0,
    };
  }
  const [deletedTurn] = history.turns.splice(index, 1);
  const cacheResult = options.deleteCache
    ? await deleteStatisticsChatCacheKeys([deletedTurn.requestFingerprint])
    : { deletedCacheEntries: 0, skippedCacheKeys: 0 };
  const remainingTurns = history.turns.map((turn) => stripDeletedTurnFromRemainingTurn(turn, deletedTurn));
  const updated = await writeStatisticsChatHistory(historyFromTurns(history, remainingTurns));
  return { history: updated, deletedTurns: 1, ...cacheResult };
}

export async function readStatisticsChatCache(key: string, dataRevision: string) {
  if (process.env.STATISTICS_CHAT_CACHE_ENABLED === "false") return null;
  const parsed = await readJson(cachePath(key));
  if (!parsed || typeof parsed !== "object") return null;
  const entry = parsed as { dataRevision?: string; createdAt?: string; answer?: StatisticsChatAnswer };
  if (entry.dataRevision !== dataRevision || !entry.answer) return null;
  const ttl = Number(process.env.STATISTICS_CHAT_CACHE_TTL_MS || 0);
  if (ttl > 0 && entry.createdAt && Date.now() - Date.parse(entry.createdAt) > ttl) return null;
  return { answer: entry.answer, createdAt: entry.createdAt || undefined };
}

export async function writeStatisticsChatCache(key: string, dataRevision: string, answer: StatisticsChatAnswer) {
  if (process.env.STATISTICS_CHAT_CACHE_ENABLED === "false") return;
  await atomicWrite(cachePath(key), {
    schemaVersion: "ecowitt.statistics-chat-cache.v1",
    keyVersion: "v1",
    dataRevision,
    createdAt: new Date().toISOString(),
    answer,
  });
}

export async function withStatisticsChatInflight<T extends StatisticsChatAnswer>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

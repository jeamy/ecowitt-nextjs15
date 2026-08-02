"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { API_ENDPOINTS } from "@/constants";
import type { StatisticsChatAnswer, StatisticsChatHistory } from "@/types/statisticsChat";

const CONVERSATION_STORAGE_KEY = "ecowitt-statistics-chat-conversation-id";

function getConversationId() {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
  if (existing) return existing;
  const created = typeof window.crypto?.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(CONVERSATION_STORAGE_KEY, created);
  return created;
}

function numberText(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${unit}`;
}

function turnDomId(turn: { requestFingerprint: string; createdAt: string }, index: number) {
  return `statistics-chat-turn-${turn.requestFingerprint.slice(0, 12)}-${Date.parse(turn.createdAt) || index}`;
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function friendlyErrorMessage(code: string, t: (key: string, fallback: string) => string) {
  if (code === "UNSUPPORTED_STATISTICS_QUESTION") {
    return t(
      "statistics.chat.unsupportedQuestion",
      "Diese Frage passt nicht zu den gespeicherten Wetterstatistiken. Frag zum Beispiel nach Temperatur, Niederschlag, Wind, Vergleichen, Extremwerten oder einem Sensor-Kanal.",
    );
  }
  if (code === "MESSAGE_REQUIRED") return t("statistics.chat.messageRequired", "Bitte gib zuerst eine Frage ein.");
  if (code === "MESSAGE_TOO_LONG") return t("statistics.chat.messageTooLong", "Die Frage ist zu lang. Bitte formuliere sie etwas kürzer.");
  if (code === "NO_STATISTICS_DATA") return t("statistics.chat.noStatisticsData", "Für diesen Zeitraum sind keine Statistikdaten vorhanden.");
  if (code === "STATISTICS_SENSOR_METRIC_NOT_FOUND") return t("statistics.chat.sensorMetricNotFound", "Für diesen Sensor oder Messwert konnte keine passende gespeicherte Messreihe gefunden werden.");
  return t("statistics.chat.genericError", "Die Anfrage konnte nicht beantwortet werden. Bitte prüfe Zeitraum, Messwert oder Formulierung.");
}

function inlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={index} className="rounded bg-gray-100 px-1 dark:bg-neutral-800">{token.slice(1, -1)}</code>;
    }
    return token;
  });
}

function MarkdownAnswer({ value }: { value: string }) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (
      line.startsWith("|")
      && index + 1 < lines.length
      && /^\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1].trim())
    ) {
      const header = line.split("|").slice(1, -1).map((cell) => cell.trim());
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(lines[index].trim().split("|").slice(1, -1).map((cell) => cell.trim()));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="my-2 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex} className="border border-gray-300 bg-gray-50 px-2 py-1 text-left font-semibold dark:border-neutral-700 dark:bg-neutral-800">
                    {inlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border border-gray-300 px-2 py-1 dark:border-neutral-700">
                      {inlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const Tag = heading[1].length === 1 ? "h3" : heading[1].length === 2 ? "h4" : "h5";
      blocks.push(<Tag key={`heading-${index}`} className="mt-2 font-semibold">{inlineMarkdown(heading[2])}</Tag>);
      index += 1;
      continue;
    }

    if (/^(---+|\*\*\*+)$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} className="my-2 border-gray-300 dark:border-neutral-700" />);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={`quote-${index}`} className="my-2 border-l-2 border-blue-500 pl-3 italic text-gray-600 dark:text-gray-400">
          {inlineMarkdown(line.replace(/^>\s?/, ""))}
        </blockquote>,
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`} className="my-2 list-disc space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`} className="my-2 list-decimal space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length
      && lines[index].trim()
      && !/^(#{1,6})\s+/.test(lines[index].trim())
      && !lines[index].trim().startsWith("|")
      && !/^[-*]\s+/.test(lines[index].trim())
      && !/^\d+\.\s+/.test(lines[index].trim())
      && !/^>/.test(lines[index].trim())
      && !/^(---+|\*\*\*+)$/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="my-1">
        {paragraph.map((part, partIndex) => <span key={partIndex}>{partIndex > 0 && <br />}{inlineMarkdown(part)}</span>)}
      </p>,
    );
  }

  return <div className="space-y-1">{blocks}</div>;
}

export default function StatisticsChat() {
  const { t, i18n } = useTranslation();
  const [conversationId, setConversationId] = useState("");
  const [history, setHistory] = useState<StatisticsChatHistory | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDebug, setExpandedDebug] = useState<string | null>(null);
  const turnRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const id = getConversationId();
    setConversationId(id);
    if (!id) return;
    fetch(`${API_ENDPOINTS.STATISTICS_CHAT_HISTORY}?conversation_id=${encodeURIComponent(id)}`)
      .then((response) => response.json())
      .then((payload) => { if (payload?.history) setHistory(payload.history); })
      .catch(() => undefined);
  }, []);

  const turns = useMemo(() => (history?.turns || []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [history?.turns]);

  function scrollToTurn(id: string) {
    turnRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ask() {
    const text = message.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API_ENDPOINTS.STATISTICS_CHAT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId || getConversationId(),
          message: text,
          locale: i18n.language?.startsWith("en") ? "en" : "de",
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(friendlyErrorMessage(String(payload?.error || `HTTP ${response.status}`), t));
      setMessage("");
      const historyResponse = await fetch(`${API_ENDPOINTS.STATISTICS_CHAT_HISTORY}?conversation_id=${encodeURIComponent(payload.conversation_id)}`);
      const historyPayload = await historyResponse.json();
      if (historyPayload?.history) setHistory(historyPayload.history);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function clearHistory() {
    if (!conversationId) return;
    await fetch(`${API_ENDPOINTS.STATISTICS_CHAT_HISTORY}?conversation_id=${encodeURIComponent(conversationId)}`, { method: "DELETE" }).catch(() => undefined);
    setHistory(null);
  }

  return (
    <section className="mb-6 flex max-h-[100dvh] flex-col overflow-hidden rounded border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950" aria-labelledby="statistics-chat-title">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 id="statistics-chat-title" className="text-lg font-semibold">{t("statistics.chat.title", "Wetterstatistik-Chat")}</h3>
          <p className="text-xs text-gray-500">{t("statistics.chat.subtitle", "Frage nach Temperaturen, Niederschlag, Vergleichen und Extremen.")}</p>
        </div>
        <button type="button" className="text-xs underline" onClick={clearHistory} disabled={!turns.length}>
          {t("statistics.chat.clear", "Verlauf löschen")}
        </button>
      </div>
      <div className="mb-3 grid gap-1 text-xs text-gray-600 dark:text-gray-400" aria-label={t("statistics.chat.examples", "Beispielfragen")}>
        <span>„{t("statistics.chat.exampleTemperature", "War es 2024 durchschnittlich wärmer als 2025?")}“</span>
        <span>„{t("statistics.chat.exampleRain", "Gab es 2024 oder 2025 mehr Niederschlag?")}“</span>
        <span>„{t("statistics.chat.exampleExtreme", "Wann wurde zwischen 2024 und 2026 die höchste Temperatur gemessen?")}“</span>
      </div>
      <div className="mb-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }}
          placeholder={t("statistics.chat.placeholder", "z. B. War es 2024 wärmer als 2025?")}
          aria-label={t("statistics.chat.input", "Frage zur Wetterstatistik")}
        />
        <button type="button" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={() => void ask()} disabled={loading || !message.trim()}>
          {loading ? t("statistics.chat.loading", "Lädt …") : t("statistics.chat.ask", "Fragen")}
        </button>
      </div>
      {error && <div className="mb-3 text-sm text-red-600" role="alert">{t("statistics.chat.error", "Fehler")}: {error}</div>}
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1" aria-live="polite">
          {turns.map((turn, index) => {
            const result = turn.result as StatisticsChatAnswer;
            const id = turnDomId(turn, index);
            const diagnostics = result.diagnostics;
            const debugOpen = expandedDebug === id;
            return (
              <article
                key={id}
                ref={(node) => { turnRefs.current[id] = node; }}
                className="scroll-mt-4 space-y-2"
              >
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg rounded-bl-sm bg-blue-600 px-3 py-2 text-sm text-white shadow-sm">
                    <div className="mb-1 text-[11px] font-semibold opacity-80">{t("statistics.chat.question", "Frage")}</div>
                    {turn.message}
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="max-w-[92%] rounded-lg rounded-br-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                    <div className="mb-1 text-[11px] font-semibold text-gray-500">{t("statistics.chat.answer", "Antwort")}</div>
                    <MarkdownAnswer value={result.answer} />
                    {result.facts.values && (
                      <div className="mt-2 grid gap-1 border-t border-gray-200 pt-2 text-xs text-gray-600 dark:border-neutral-800 dark:text-gray-400 sm:grid-cols-2">
                        {result.facts.values.map((value) => (
                          <div key={value.label}>
                            {value.label}: {numberText(value.value, value.unit)} ({value.validDays}{value.expectedDays ? `/${value.expectedDays}` : ""} {t("statistics.chat.validDays", "gültige Tage")}{value.coverage !== undefined && value.coverage !== null ? `, ${numberText(value.coverage, "%")}` : ""})
                          </div>
                        ))}
                      </div>
                    )}
                    {result.facts.items?.slice(0, 5).map((item) => <div key={`${item.date}-${item.value}`} className="text-xs text-gray-600 dark:text-gray-400">{item.date}: {numberText(item.value, item.unit)}</div>)}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span>
                        {result.mode === "sidecar" ? "PI-Sidecar" : t("statistics.chat.local", "lokale Berechnung")}
                        {result.cache?.hit ? ` · ${t("statistics.chat.cacheHit", "Cache-Treffer")}` : ""}
                      </span>
                      <button
                        type="button"
                        className="rounded border border-gray-300 px-2 py-0.5 text-[11px] hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
                        onClick={() => setExpandedDebug(debugOpen ? null : id)}
                      >
                        {debugOpen ? t("statistics.chat.hideTraffic", "Datenverkehr ausblenden") : t("statistics.chat.showTraffic", "Datenverkehr anzeigen")}
                      </button>
                    </div>
                    {debugOpen && (
                      <div className="mt-3 rounded border border-gray-200 bg-white p-2 text-xs dark:border-neutral-800 dark:bg-neutral-950">
                        <div className="mb-2 grid gap-1 text-gray-600 dark:text-gray-400 sm:grid-cols-2">
                          <div>Request: {diagnostics?.requestId || "–"}</div>
                          <div>Dauer: {diagnostics?.durationMs ?? "–"} ms</div>
                          <div>Cache: {diagnostics?.cache.status || (result.cache?.hit ? "hit" : "miss")} {diagnostics?.cache.key ? `(${diagnostics.cache.key})` : ""}</div>
                          <div>PI: {diagnostics?.sidecar.attempted ? `${diagnostics.sidecar.httpStatus || "?"} · ${diagnostics.sidecar.durationMs ?? "–"} ms` : t("statistics.chat.notCalled", "nicht aufgerufen")}</div>
                          <div>Provider: {diagnostics?.sidecar.provider || "–"}</div>
                          <div>Model: {diagnostics?.sidecar.model || "–"}</div>
                        </div>
                        <div className="mb-1 font-semibold text-gray-600 dark:text-gray-300">{t("statistics.chat.trafficLog", "Datenverkehr")}</div>
                        <div className="space-y-1">
                          {(diagnostics?.events || []).map((event, eventIndex) => (
                            <details key={`${event.at}-${eventIndex}`} className="rounded bg-gray-50 px-2 py-1 dark:bg-neutral-900">
                              <summary className="cursor-pointer text-gray-700 dark:text-gray-300">
                                <span className="font-mono">{new Date(event.at).toLocaleTimeString()}</span> · {event.direction} · {event.label}
                              </summary>
                              {event.detail !== undefined && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-gray-600 dark:text-gray-400">{compactJson(event.detail)}</pre>}
                            </details>
                          ))}
                        </div>
                        <details className="mt-2 rounded bg-gray-50 px-2 py-1 dark:bg-neutral-900">
                          <summary className="cursor-pointer text-gray-700 dark:text-gray-300">{t("statistics.chat.intentAndFacts", "Intent und Fakten")}</summary>
                          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] text-gray-600 dark:text-gray-400">{compactJson({ intent: diagnostics?.intent, facts: result.facts, source: result.source, warnings: result.warnings })}</pre>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="flex min-h-0 flex-col rounded border border-gray-200 bg-gray-50 p-2 dark:border-neutral-800 dark:bg-neutral-900/50" aria-label={t("statistics.chat.questionList", "Gestellte Fragen")}>
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t("statistics.chat.questionList", "Gestellte Fragen")}</div>
          {turns.length ? (
            <div className="max-h-48 flex-1 space-y-1 overflow-auto lg:max-h-none">
              {turns.map((turn, index) => {
                const id = turnDomId(turn, index);
                return (
                  <button
                    key={id}
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-300 dark:hover:bg-neutral-800"
                    onClick={() => scrollToTurn(id)}
                    title={turn.message}
                  >
                    <span className="line-clamp-2">{turn.message}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-1 text-xs text-gray-500">{t("statistics.chat.noQuestions", "Noch keine Fragen.")}</div>
          )}
        </aside>
      </div>
    </section>
  );
}

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  computeStatisticsChatFacts,
  formatStatisticsChatAnswer,
  getStatisticsChatDataRevision,
  parseStatisticsQuestion,
  statisticsChatFingerprint,
} from "@/lib/statisticsChat";
import {
  appendStatisticsChatTurn,
  readStatisticsChatCache,
  readStatisticsChatHistory,
  withStatisticsChatInflight,
  writeStatisticsChatCache,
} from "@/lib/server/statisticsChatStore";
import { askStatisticsPiSidecar, statisticsPiSidecarConfig } from "@/lib/server/piSidecar";
import { readStatistics } from "@/lib/statistics";
import type { StatisticsChatAnswer, StatisticsChatDiagnostics, StatisticsChatFacts, StatisticsChatIntent } from "@/types/statisticsChat";

export const runtime = "nodejs";

function errorResponse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAtMs: number) {
  return Math.max(0, Date.now() - startedAtMs);
}

function buildDiagnostics(input: {
  requestId: string;
  startedAt: string;
  startedAtMs: number;
  cacheStatus: "hit" | "miss";
  cacheKey: string;
  cacheCreatedAt?: string;
  intent: StatisticsChatIntent;
  sidecar: Partial<StatisticsChatDiagnostics["sidecar"]>;
  events: StatisticsChatDiagnostics["events"];
}): StatisticsChatDiagnostics {
  const config = statisticsPiSidecarConfig();
  const finishedAt = nowIso();
  return {
    requestId: input.requestId,
    startedAt: input.startedAt,
    finishedAt,
    durationMs: elapsedMs(input.startedAtMs),
    cache: {
      status: input.cacheStatus,
      key: input.cacheKey.slice(0, 16),
      createdAt: input.cacheCreatedAt,
    },
    intent: input.intent,
    sidecar: {
      enabled: process.env.STATISTICS_CHAT_ENABLED === "true",
      attempted: false,
      endpoint: config.endpoint,
      provider: config.provider,
      model: config.model,
      ...input.sidecar,
    },
    events: input.events,
  };
}

function answerContradictsFacts(answer: string, facts: StatisticsChatFacts) {
  const normalized = answer
    .normalize("NFKC")
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
  const sentences = normalized.split(/[.!?\n]+/).map((item) => item.trim()).filter(Boolean);
  if (facts.operation === "record_check" && facts.recordCheck?.isRecord !== null && facts.recordCheck?.isRecord !== undefined) {
    const expectedPrefix = facts.recordCheck.isRecord ? "ja" : "nein";
    const startsCorrectly = normalized.trim().startsWith(expectedPrefix);
    const deniesComparison = /keine vergleichsdaten|keine historischen vergleichsdaten|ausschliesslich.*tagesdaten|ausschlieslich.*tagesdaten|nur.*tagesdaten/.test(normalized);
    if (!startsCorrectly || deniesComparison) return true;
  }
  for (const value of facts.values || []) {
    if (!value.label || value.validDays <= 0) continue;
    const label = value.label.toLocaleLowerCase("de-DE");
    const year = label.match(/\b(?:19|20)\d{2}\b/)?.[0] || label;
    if (sentences.some((sentence) => sentence.includes(year) && /keine daten|keine messwerte|liegen keine daten|fehlen daten|nicht vorhanden/.test(sentence))) {
      return true;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const requestId = randomUUID();
    const startedAtMs = Date.now();
    const startedAt = nowIso();
    const events: StatisticsChatDiagnostics["events"] = [
      { at: startedAt, direction: "browser", label: "POST /api/statistics/chat" },
    ];
    const body = await req.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const maxLength = Math.max(100, Number(process.env.STATISTICS_CHAT_MAX_MESSAGE_LENGTH || 1000));
    if (!message) return errorResponse("MESSAGE_REQUIRED", 400);
    if (message.length > maxLength) return errorResponse("MESSAGE_TOO_LONG", 400);

    const conversationId = typeof body?.conversation_id === "string" && body.conversation_id.trim()
      ? body.conversation_id.trim()
      : randomUUID();
    const locale = body?.locale === "en" ? "en" : "de";
    let intent;
    try {
      intent = parseStatisticsQuestion(message);
    } catch {
      return errorResponse("UNSUPPORTED_STATISTICS_QUESTION", 422);
    }
    events.push({
      at: nowIso(),
      direction: "app",
      label: "Frage klassifiziert",
      detail: { operation: intent.operation, metric: intent.metric, periods: intent.periods },
    });

    const dataRevision = await getStatisticsChatDataRevision();
    const cacheKey = statisticsChatFingerprint({
      schemaVersion: "ecowitt.statistics-chat-answer.v1",
      promptVersion: "statistics-chat-prompt-v2-condition-items",
      message,
      intent,
      locale,
      model: process.env.PI_SIDECAR_MODEL || "local",
      provider: process.env.PI_SIDECAR_PROVIDER || "local",
    });
    const cached = await readStatisticsChatCache(cacheKey, dataRevision);
    if (cached) {
      events.push({ at: nowIso(), direction: "cache", label: "Antwort-Cache Treffer", detail: { key: cacheKey.slice(0, 16) } });
      const answer = {
        ...cached.answer,
        cache: { hit: true, keyVersion: "v1" as const, createdAt: cached.createdAt },
        diagnostics: buildDiagnostics({
          requestId,
          startedAt,
          startedAtMs,
          cacheStatus: "hit",
          cacheKey,
          cacheCreatedAt: cached.createdAt,
          intent,
          sidecar: { attempted: false },
          events,
        }),
      } satisfies StatisticsChatAnswer;
      await appendStatisticsChatTurn(conversationId, {
        message,
        result: answer,
        createdAt: new Date().toISOString(),
        requestFingerprint: cacheKey,
        dataRevision,
      }, dataRevision);
      return NextResponse.json({ ok: true, conversation_id: conversationId, ...answer }, { headers: { "Cache-Control": "no-store" } });
    }

    return withStatisticsChatInflight(cacheKey, async () => {
      const cachedInsideLock = await readStatisticsChatCache(cacheKey, dataRevision);
      if (cachedInsideLock) {
        events.push({ at: nowIso(), direction: "cache", label: "Antwort-Cache Treffer nach In-Flight Wartezeit", detail: { key: cacheKey.slice(0, 16) } });
        return {
          ...cachedInsideLock.answer,
          cache: { hit: true, keyVersion: "v1" as const, createdAt: cachedInsideLock.createdAt },
          diagnostics: buildDiagnostics({
            requestId,
            startedAt,
            startedAtMs,
            cacheStatus: "hit",
            cacheKey,
            cacheCreatedAt: cachedInsideLock.createdAt,
            intent,
            sidecar: { attempted: false },
            events,
          }),
        } satisfies StatisticsChatAnswer;
      }

      events.push({ at: nowIso(), direction: "cache", label: "Antwort-Cache Miss", detail: { key: cacheKey.slice(0, 16) } });
      const facts = await computeStatisticsChatFacts(intent);
      events.push({
        at: nowIso(),
        direction: "app",
        label: "Lokale Statistik berechnet",
        detail: {
          operation: facts.operation,
          metric: facts.metric,
          values: facts.values,
          itemCount: facts.items?.length || 0,
        },
      });
      const stats = await readStatistics();
      const history = await readStatisticsChatHistory(conversationId);
      let answerText = formatStatisticsChatAnswer(facts);
      events.push({
        at: nowIso(),
        direction: "app",
        label: "Lokale Antwort vorbereitet",
        detail: { answer: answerText, answerLength: answerText.length },
      });
      let mode: StatisticsChatAnswer["mode"] = "local_fallback";
      const warnings = [...facts.warnings];
      const sidecarConfig = statisticsPiSidecarConfig();
      let sidecarDiagnostics: Partial<StatisticsChatDiagnostics["sidecar"]> = {
        enabled: process.env.STATISTICS_CHAT_ENABLED === "true",
        attempted: false,
        endpoint: sidecarConfig.endpoint,
        provider: sidecarConfig.provider,
        model: sidecarConfig.model,
      };

      if (process.env.STATISTICS_CHAT_ENABLED === "true") {
        try {
          events.push({
            at: nowIso(),
            direction: "sidecar",
            label: "POST /run-chat",
            detail: { endpoint: sidecarConfig.endpoint, provider: sidecarConfig.provider, model: sidecarConfig.model },
          });
          const sidecarResult = await askStatisticsPiSidecar({
            message,
            locale,
            facts,
            conversation: history.messages,
          });
          if (answerContradictsFacts(sidecarResult.answer, facts)) {
            warnings.push("Die PI-Antwort widersprach den lokal berechneten Fakten; die Antwort wurde lokal erzeugt.");
            events.push({
              at: nowIso(),
              direction: "app",
              label: "PI-Antwort verworfen",
              detail: {
                reason: "contradicts_local_facts",
                answer: sidecarResult.answer,
                answerLength: sidecarResult.answer.length,
                localFallbackAnswer: answerText,
                requestPayload: sidecarResult.diagnostics.requestPayload,
                responsePayload: sidecarResult.diagnostics.responsePayload,
              },
            });
          } else {
            answerText = sidecarResult.answer;
            mode = "sidecar";
          }
          sidecarDiagnostics = {
            ...sidecarDiagnostics,
            attempted: true,
            httpStatus: sidecarResult.diagnostics.httpStatus,
            ok: sidecarResult.diagnostics.ok,
            durationMs: sidecarResult.diagnostics.durationMs,
            provider: sidecarResult.diagnostics.provider,
            model: sidecarResult.diagnostics.model,
            answer: sidecarResult.diagnostics.answer,
            answerLength: sidecarResult.diagnostics.answerLength,
            requestPayload: sidecarResult.diagnostics.requestPayload,
            responsePayload: sidecarResult.diagnostics.responsePayload,
          };
          events.push({
            at: nowIso(),
            direction: "provider",
            label: "PI-Antwort erhalten",
            detail: {
              httpStatus: sidecarDiagnostics.httpStatus,
              durationMs: sidecarDiagnostics.durationMs,
              provider: sidecarDiagnostics.provider,
              model: sidecarDiagnostics.model,
              answer: sidecarResult.answer,
              answerLength: sidecarResult.answer.length,
              requestPayload: sidecarResult.diagnostics.requestPayload,
              responsePayload: sidecarResult.diagnostics.responsePayload,
            },
          });
        } catch (sidecarError) {
          const diagnosticError = sidecarError as Error & { diagnostics?: Partial<StatisticsChatDiagnostics["sidecar"]> };
          sidecarDiagnostics = {
            ...sidecarDiagnostics,
            attempted: true,
            httpStatus: diagnosticError.diagnostics?.httpStatus,
            ok: false,
            durationMs: diagnosticError.diagnostics?.durationMs,
            error: diagnosticError.diagnostics?.error || diagnosticError.message,
            requestPayload: diagnosticError.diagnostics?.requestPayload,
            responsePayload: diagnosticError.diagnostics?.responsePayload,
          };
          events.push({
            at: nowIso(),
            direction: "sidecar",
            label: "PI-Sidecar Fehler",
            detail: {
              httpStatus: sidecarDiagnostics.httpStatus,
              durationMs: sidecarDiagnostics.durationMs,
              error: sidecarDiagnostics.error,
              requestPayload: sidecarDiagnostics.requestPayload,
              responsePayload: sidecarDiagnostics.responsePayload,
            },
          });
          warnings.push("Der PI-Sidecar war nicht erreichbar; die Antwort wurde lokal aus den Statistikdaten erzeugt.");
        }
      }

      const answer: StatisticsChatAnswer = {
        schema_version: "ecowitt.statistics-chat-answer.v1",
        answer: answerText,
        facts,
        source: {
          granularity: "day",
          dataset: facts.dataset || "main",
          statisticsUpdatedAt: stats?.updatedAt || null,
          dataRevision,
        },
        warnings,
        mode,
        cache: { hit: false, keyVersion: "v1" },
        diagnostics: buildDiagnostics({
          requestId,
          startedAt,
          startedAtMs,
          cacheStatus: "miss",
          cacheKey,
          intent,
          sidecar: sidecarDiagnostics,
          events,
        }),
      };
      await writeStatisticsChatCache(cacheKey, dataRevision, answer);
      await appendStatisticsChatTurn(conversationId, {
        message,
        result: answer,
        createdAt: new Date().toISOString(),
        requestFingerprint: cacheKey,
        dataRevision,
      }, dataRevision);
      return answer;
    }).then((answer) => NextResponse.json({ ok: true, conversation_id: conversationId, ...answer }, { headers: { "Cache-Control": "no-store" } }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "NO_STATISTICS_DATA") return errorResponse("NO_STATISTICS_DATA", 404);
    if (message === "STATISTICS_SENSOR_METRIC_NOT_FOUND") return errorResponse("STATISTICS_SENSOR_METRIC_NOT_FOUND", 422);
    console.error("[statistics/chat] error:", message);
    return errorResponse("STATISTICS_CHAT_FAILED", 500);
  }
}

import type { StatisticsChatFacts } from "@/types/statisticsChat";

function sidecarUrl() {
  return (process.env.PI_SIDECAR_URL || "http://pi-sidecar:3001").replace(/\/$/, "");
}

export function statisticsPiSidecarEndpoint() {
  return `${sidecarUrl()}/run-chat`;
}

export function statisticsPiSidecarConfig() {
  return {
    endpoint: statisticsPiSidecarEndpoint(),
    provider: process.env.PI_SIDECAR_PROVIDER || "auto",
    model: process.env.PI_SIDECAR_MODEL || "auto",
  };
}

export async function askStatisticsPiSidecar(input: {
  message: string;
  locale: string;
  facts: StatisticsChatFacts;
  conversation: Array<{ role: string; content: string }>;
}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(process.env.PI_SIDECAR_TIMEOUT_MS || 120000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  let httpStatus: number | undefined;
  try {
    const response = await fetch(statisticsPiSidecarEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.PI_SIDECAR_MODEL || undefined,
        provider: process.env.PI_SIDECAR_PROVIDER || undefined,
        task: "ecowitt_statistics_chat",
        prompt: [
          "Beantworte die Wetterstatistik-Frage ausschließlich anhand der verifizierten Fakten.",
          "Erfinde keine Werte. Antworte auf Deutsch, falls locale=de.",
          `locale=${input.locale}`,
          `Frage: ${input.message}`,
          `Fakten: ${JSON.stringify(input.facts)}`,
        ].join("\n"),
        ai_request: {
          schema_version: "ecowitt.statistics-ai-request.v1",
          task: "statistics_chat",
          user_message: input.message,
          facts: input.facts,
          conversation: input.conversation.slice(-Math.max(1, Math.min(50, Number(process.env.STATISTICS_CHAT_MAX_HISTORY || 12)))),
          expected_response: "ecowitt.statistics-chat-answer.v1-compatible-text",
        },
      }),
    });
    httpStatus = response.status;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`PI_SIDECAR_HTTP_${response.status}`);
    const answer = typeof payload?.answer === "string"
      ? payload.answer
      : typeof payload?.summary === "string"
        ? payload.summary
        : typeof payload?.text === "string" ? payload.text : "";
    if (!answer.trim()) throw new Error("PI_SIDECAR_EMPTY_ANSWER");
    return {
      answer: answer.trim(),
      diagnostics: {
        httpStatus,
        ok: true,
        durationMs: Date.now() - started,
        provider: typeof payload?.provider === "string" ? payload.provider : statisticsPiSidecarConfig().provider,
        model: typeof payload?.model === "string" ? payload.model : statisticsPiSidecarConfig().model,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(message), {
      diagnostics: {
        httpStatus,
        ok: false,
        durationMs: Date.now() - started,
        error: message,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

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

function buildPrompt(input: {
  message: string;
  locale: string;
  facts: StatisticsChatFacts;
}) {
  return [
    "Beantworte die Wetterstatistik-Frage ausschließlich anhand der verifizierten Fakten.",
    "Erfinde keine Werte. Antworte auf Deutsch, falls locale=de.",
    `locale=${input.locale}`,
    `Frage: ${input.message}`,
    `Fakten: ${JSON.stringify(input.facts)}`,
  ].join("\n");
}

function buildPayload(input: {
  message: string;
  locale: string;
  facts: StatisticsChatFacts;
  conversation: Array<{ role: string; content: string }>;
}) {
  const conversation = input.conversation.slice(-Math.max(1, Math.min(50, Number(process.env.STATISTICS_CHAT_MAX_HISTORY || 12))));
  const prompt = buildPrompt(input);
  return {
    model: process.env.PI_SIDECAR_MODEL || undefined,
    provider: process.env.PI_SIDECAR_PROVIDER || undefined,
    task: "ecowitt_statistics_chat",
    prompt,
    ai_request: {
      schema_version: "ecowitt.statistics-ai-request.v1",
      task: "statistics_chat",
      user_message: input.message,
      facts: input.facts,
      conversation,
      expected_response: "ecowitt.statistics-chat-answer.v1-compatible-text",
    },
  };
}

function redactPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactPayload);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (/api[_-]?key|authorization|token|secret|password/i.test(key)) return [key, "[redacted]"];
    return [key, redactPayload(item)];
  }));
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
  const requestPayload = buildPayload(input);
  try {
    const response = await fetch(statisticsPiSidecarEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(requestPayload),
    });
    httpStatus = response.status;
    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`PI_SIDECAR_HTTP_${response.status}`), { responsePayload });
    const answer = typeof responsePayload?.answer === "string"
      ? responsePayload.answer
      : typeof responsePayload?.summary === "string"
        ? responsePayload.summary
        : typeof responsePayload?.text === "string" ? responsePayload.text : "";
    if (!answer.trim()) throw new Error("PI_SIDECAR_EMPTY_ANSWER");
    return {
      answer: answer.trim(),
      diagnostics: {
        httpStatus,
        ok: true,
        durationMs: Date.now() - started,
        provider: typeof responsePayload?.provider === "string" ? responsePayload.provider : statisticsPiSidecarConfig().provider,
        model: typeof responsePayload?.model === "string" ? responsePayload.model : statisticsPiSidecarConfig().model,
        answer: answer.trim(),
        answerLength: answer.trim().length,
        requestPayload: redactPayload(requestPayload),
        responsePayload: redactPayload(responsePayload),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnosticError = error as Error & { responsePayload?: unknown };
    throw Object.assign(new Error(message), {
      diagnostics: {
        httpStatus,
        ok: false,
        durationMs: Date.now() - started,
        error: message,
        requestPayload: redactPayload(requestPayload),
        responsePayload: diagnosticError.responsePayload ? redactPayload(diagnosticError.responsePayload) : undefined,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

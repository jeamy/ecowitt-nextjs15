import http from "node:http";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const host = process.env.AI_AGENT_HOST || "0.0.0.0";
const port = Number(process.env.AI_AGENT_PORT || 3001);

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function providerConfig(body) {
  const provider = String(body.provider || process.env.PI_SIDECAR_PROVIDER || "").toLowerCase()
    || (process.env.OPENAI_API_KEY ? "openai" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "");
  const fallbackModel = provider === "anthropic" ? "claude-haiku-4-5"
    : provider === "ollama" ? "llama3.1:8b"
    : "gpt-4o-mini";
  const model = String(body.model || process.env.PI_SIDECAR_MODEL || process.env.AI_AGENT_MODEL || "")
    || fallbackModel;
  return { provider, model };
}

function promptFrom(body) {
  if (typeof body.prompt === "string" && body.prompt.trim()) return body.prompt;
  return [
    "Beantworte die Wetterstatistik-Frage ausschließlich mit den verifizierten Fakten.",
    "Keine Werte erfinden. Nenne Vergleichswerte, Einheiten, Zeitraum und Datenlücken.",
    `Frage: ${String(body.ai_request?.user_message || "")}`,
    `Fakten: ${JSON.stringify(body.ai_request?.facts || {})}`,
  ].join("\n");
}

let runtimePromise;

function providerBaseUrl(provider) {
  const configured = provider === "anthropic"
    ? process.env.PI_SIDECAR_ANTHROPIC_BASE_URL
    : provider === "openai" ? process.env.PI_SIDECAR_OPENAI_BASE_URL : undefined;
  if (!configured) return undefined;
  return configured
    .replace(/\/v1\/messages\/?$/, "")
    .replace(/\/chat\/completions\/?$/, "")
    .replace(/\/$/, "");
}

function ollamaBaseUrl() {
  return (process.env.PI_SIDECAR_OLLAMA_BASE_URL || "http://localhost:11434/v1")
    .replace(/\/chat\/completions\/?$/, "")
    .replace(/\/$/, "");
}

function ollamaEnabled() {
  return Boolean(process.env.PI_SIDECAR_OLLAMA_BASE_URL)
    || String(process.env.PI_SIDECAR_PROVIDER || "").toLowerCase() === "ollama";
}

function ollamaModelDef(modelId) {
  return {
    id: modelId,
    name: modelId,
    reasoning: /reason|think|gpt-oss|deepseek-r1|qwen3|:r1|-r1/i.test(modelId),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Math.max(4096, Number(process.env.PI_SIDECAR_OLLAMA_CONTEXT_WINDOW || 131072)),
    maxTokens: Math.max(1, Number(process.env.PI_SIDECAR_MAX_TOKENS || 1200)),
    // Ollama's OpenAI-compatible endpoint does not understand the `developer`
    // role or `reasoning_effort`; send a plain system message instead.
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
}

function ollamaModelIds(extra) {
  const ids = new Set(
    String(process.env.PI_SIDECAR_OLLAMA_MODELS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (String(process.env.PI_SIDECAR_PROVIDER || "").toLowerCase() === "ollama" && process.env.PI_SIDECAR_MODEL) {
    ids.add(process.env.PI_SIDECAR_MODEL.trim());
  }
  if (extra) ids.add(String(extra).trim());
  if (ids.size === 0) ids.add("llama3.1:8b");
  return [...ids];
}

function registerOllama(runtime, extraModelId) {
  runtime.registerProvider("ollama", {
    name: "Ollama",
    baseUrl: ollamaBaseUrl(),
    // Placeholder: Ollama ignores it, but pi requires auth before a model is usable.
    apiKey: process.env.PI_SIDECAR_OLLAMA_API_KEY || "ollama",
    api: "openai-completions",
    models: ollamaModelIds(extraModelId).map(ollamaModelDef),
  });
}

async function piRuntime() {
  if (!runtimePromise) {
    runtimePromise = ModelRuntime.create().then((runtime) => {
      for (const provider of ["anthropic", "openai"]) {
        const baseUrl = providerBaseUrl(provider);
        if (baseUrl) runtime.registerProvider(provider, { baseUrl });
      }
      if (ollamaEnabled()) registerOllama(runtime);
      return runtime;
    });
  }
  return runtimePromise;
}

function isTransientError(error) {
  const message = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  if (/no api key|not found in pi registry|not found in registry/.test(message)) return false;
  return /429|rate.?limit|too many requests|overloaded|capacity|50[0239]|timeout|timed out|etimedout|econnreset|socket|network|fetch failed|other side closed|empty response/.test(message);
}

async function runPiPromptOnce(provider, modelId, prompt) {
  const modelRuntime = await piRuntime();
  if (provider === "ollama" && !modelRuntime.getModel(provider, modelId)) {
    registerOllama(modelRuntime, modelId);
  }
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) throw new Error(`Model ${provider}/${modelId} not found in Pi registry`);
  if (provider !== "ollama") {
    const available = await modelRuntime.getAvailable();
    if (!available.some((item) => item.provider === model.provider && item.id === model.id)) {
      throw new Error(`No API key configured for ${model.provider}`);
    }
  }
  const maxTokens = Math.max(1, Number(process.env.PI_SIDECAR_MAX_TOKENS || 1200));
  const { session } = await createAgentSession({
    model: { ...model, maxTokens },
    modelRuntime,
    sessionManager: SessionManager.inMemory(),
    tools: [],
  });
  let answer = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      answer += event.assistantMessageEvent.delta;
    }
  });
  try {
    await session.prompt(prompt);
  } finally {
    unsubscribe();
    session.dispose();
  }
  if (!answer.trim()) throw new Error("PI_EMPTY_ANSWER");
  return answer.trim();
}

async function runPiPrompt(provider, model, prompt) {
  const maxRetries = Math.max(0, Number(process.env.PI_SIDECAR_MAX_RETRIES || 3));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runPiPromptOnce(provider, model, prompt);
    } catch (error) {
      if (attempt >= maxRetries || !isTransientError(error)) throw error;
      const backoffMs = Math.min(30000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 500);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

async function runChat(body) {
  const { provider, model } = providerConfig(body);
  if (!provider) throw new Error("PI_PROVIDER_NOT_CONFIGURED");
  const answer = await runPiPrompt(provider, model, promptFrom(body));
  return { answer, summary: answer, mode: "sidecar", provider, model };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, status: "ok" });
    if (req.method === "POST" && url.pathname === "/run-chat") return json(res, 200, await runChat(await readBody(req)));
    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, 500, { error: true, message: error instanceof Error ? error.message : "unknown error" });
  }
});

server.listen(port, host, () => console.log(`[ecowitt_pi_sidecar] listening on http://${host}:${port}`));

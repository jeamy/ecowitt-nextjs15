import http from "node:http";

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
  const model = String(body.model || process.env.PI_SIDECAR_MODEL || process.env.AI_AGENT_MODEL || "")
    || (provider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4o-mini");
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

async function callOpenAI(model, prompt) {
  const response = await fetch(process.env.PI_SIDECAR_OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 1200, messages: [
      { role: "system", content: "Du bist ein präziser Assistent für lokale Wetterstatistiken. Verwende nur die gelieferten Fakten." },
      { role: "user", content: prompt },
    ] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
  const answer = payload?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("OPENAI_EMPTY_ANSWER");
  return answer.trim();
}

async function callAnthropic(model, prompt) {
  const response = await fetch(process.env.PI_SIDECAR_ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 1200, temperature: 0, system: "Du bist ein präziser Assistent für lokale Wetterstatistiken. Verwende nur die gelieferten Fakten.", messages: [{ role: "user", content: prompt }] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ANTHROPIC_HTTP_${response.status}`);
  const answer = payload?.content?.find((item) => item?.type === "text")?.text;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("ANTHROPIC_EMPTY_ANSWER");
  return answer.trim();
}

async function runChat(body) {
  const { provider, model } = providerConfig(body);
  if (!provider) throw new Error("PI_PROVIDER_NOT_CONFIGURED");
  const prompt = promptFrom(body);
  const answer = provider === "anthropic" ? await callAnthropic(model, prompt) : await callOpenAI(model, prompt);
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

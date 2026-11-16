import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test("sidecar serves chat through a local OpenAI-compatible provider", { timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ecowitt-sidecar-"));
  const requests = [];
  const answer = "Die niedrigste Temperatur betrug −4,1 °C am 15.11.2026 um 04:43.";
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ url: req.url, body });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const content = body.model === "empty-answer" ? "" : answer;
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: body.model,
      choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  t.after(async () => {
    await close(upstream);
    await rm(dir, { recursive: true, force: true });
  });
  const upstreamPort = await listen(upstream);
  const reservation = http.createServer();
  const port = await listen(reservation);
  await close(reservation);
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      PI_CODING_AGENT_DIR: dir,
      AI_AGENT_HOST: "127.0.0.1",
      AI_AGENT_PORT: String(port),
      PI_SIDECAR_PROVIDER: "ollama",
      PI_SIDECAR_MODEL: "weather-test",
      PI_SIDECAR_OLLAMA_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
      PI_SIDECAR_MAX_RETRIES: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, output);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      assert.deepEqual(await response.json(), { ok: true, status: "ok" });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(ready, true, output);

  const chat = async (body) => {
    const response = await fetch(`${base}/run-chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  };

  await t.test("health and unknown routes do not call a model", async () => {
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    assert.equal(requests.length, 0);
  });
  await t.test("streams a response and keeps Ollama compatibility settings", async () => {
    const result = await chat({ prompt: "Nenne das geprüfte Minimum." });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body, {
      answer, summary: answer, mode: "sidecar", provider: "ollama", model: "weather-test",
    });
    const request = requests.at(-1);
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.body.model, "weather-test");
    assert.equal(request.body.max_tokens ?? request.body.max_completion_tokens, 1200);
    assert.equal(request.body.messages.some((message) => message.role === "developer"), false);
    assert.equal(request.body.reasoning_effort, undefined);
    assert.equal(request.body.messages.some((message) =>
      message.role === "user" && JSON.stringify(message.content).includes("Nenne das geprüfte Minimum.")
    ), true);
  });
  await t.test("registers requested models and includes verified facts in the fallback prompt", async () => {
    const result = await chat({
      model: "weather-extra",
      ai_request: { user_message: "Wie kalt war es?", facts: { min: -4.1, time: "04:43" } },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.model, "weather-extra");
    const request = requests.at(-1);
    assert.equal(request.body.model, "weather-extra");
    const prompt = JSON.stringify(request.body.messages);
    assert.match(prompt, /Wie kalt war es/);
    assert.match(prompt, /-4\.1/);
    assert.match(prompt, /04:43/);
  });
  await t.test("returns a controlled error for unknown providers", async () => {
    const count = requests.length;
    const result = await chat({ provider: "missing-provider", model: "missing", prompt: "Test" });
    assert.equal(result.status, 500);
    assert.match(result.body.message, /not found in Pi registry/);
    assert.equal(requests.length, count);
  });
  await t.test("rejects an empty model answer", async () => {
    const result = await chat({ model: "empty-answer", prompt: "Test" });
    assert.equal(result.status, 500);
    assert.equal(result.body.message, "PI_EMPTY_ANSWER");
  });
});

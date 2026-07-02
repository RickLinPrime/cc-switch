import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import { createProxyServer } from "../src/server.js";

function listen(server) {
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => {
    const address = server.address();
    return `http://${address.address}:${address.port}`;
  });
}

test("proxy converts Claude Messages request to ModelHub OpenAI Chat request", async (t) => {
  let upstreamBody;
  let upstreamUrl;
  let upstreamAuth;
  const upstream = http.createServer(async (req, res) => {
    upstreamUrl = req.url;
    upstreamAuth = req.headers.authorization;
    upstreamBody = JSON.parse(await new Response(req).text());
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl_test",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "pong" },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    );
  });
  t.after(() => upstream.close());
  const upstreamBaseUrl = await listen(upstream);

  const proxy = createProxyServer({
    provider: {
      name: "ByteDance ModelHub",
      apiFormat: "openai_chat",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: `${upstreamBaseUrl}/api/modelhub/online/v2/crawl`,
          ANTHROPIC_AUTH_TOKEN: "secret-ak",
          ANTHROPIC_MODEL: "gpt-5.5-2026-04-24",
        },
      },
    },
  });
  t.after(() => proxy.close());
  const proxyBaseUrl = await listen(proxy);

  const response = await fetch(`${proxyBaseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [{ role: "user", content: "ping" }],
      tools: [
        {
          name: "get_horoscope",
          description: "Get horoscope.",
          input_schema: { type: "object", properties: {} },
        },
      ],
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "/api/modelhub/online/v2/crawl?ak=secret-ak");
  assert.equal(upstreamAuth, undefined);
  assert.equal(upstreamBody.model, "gpt-5.5-2026-04-24");
  assert.equal(upstreamBody.stream, false);
  assert.deepEqual(upstreamBody.tools, [
    {
      type: "function",
      function: {
        name: "get_horoscope",
        description: "Get horoscope.",
        parameters: { type: "object", properties: {} },
      },
    },
  ]);
  assert.deepEqual(body.content, [{ type: "text", text: "pong" }]);
  assert.deepEqual(body.usage, { input_tokens: 5, output_tokens: 2 });
});

test("proxy returns Anthropic SSE when Claude requests stream", async (t) => {
  const upstream = http.createServer(async (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "pong" },
          },
        ],
      }),
    );
  });
  t.after(() => upstream.close());
  const upstreamBaseUrl = await listen(upstream);

  const proxy = createProxyServer({
    provider: {
      name: "ByteDance ModelHub",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: `${upstreamBaseUrl}/crawl`,
          ANTHROPIC_AUTH_TOKEN: "secret-ak",
          ANTHROPIC_MODEL: "gpt-5.5-2026-04-24",
        },
      },
    },
  });
  t.after(() => proxy.close());
  const proxyBaseUrl = await listen(proxy);

  const response = await fetch(`${proxyBaseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: true,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.match(text, /event: message_start/);
  assert.match(text, /event: content_block_delta/);
  assert.match(text, /pong/);
  assert.match(text, /event: message_stop/);
});

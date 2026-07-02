import http from "node:http";

import {
  anthropicSseFromMessage,
  transformAnthropicToOpenAI,
  transformOpenAIToAnthropic,
} from "./transform.js";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function upstreamUrl(baseUrl, token) {
  const url = new URL(baseUrl);
  if (token) {
    url.searchParams.set("ak", token);
  }
  return url;
}

function providerEnv(provider) {
  return provider?.settingsConfig?.env || {};
}

function providerModel(provider, requestModel) {
  const env = providerEnv(provider);
  return env.ANTHROPIC_MODEL || requestModel || "gpt-5.5-2026-04-24";
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function handleMessages(req, res, provider) {
  const rawBody = await readBody(req);
  const requestBody = rawBody ? JSON.parse(rawBody) : {};
  const env = providerEnv(provider);
  const baseUrl = env.ANTHROPIC_BASE_URL;
  const token = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (!baseUrl || !token) {
    sendJson(res, 500, {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Current provider is missing ANTHROPIC_BASE_URL or token",
      },
    });
    return;
  }

  const upstreamBody = transformAnthropicToOpenAI({
    ...requestBody,
    model: providerModel(provider, requestBody.model),
  });
  const response = await fetch(upstreamUrl(baseUrl, token), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tt-logid": `cc-switch-cli-${Date.now()}`,
    },
    body: JSON.stringify(upstreamBody),
  });
  const text = await response.text();
  let upstreamJson;
  try {
    upstreamJson = JSON.parse(text);
  } catch {
    upstreamJson = null;
  }

  if (!response.ok) {
    sendJson(res, response.status, {
      type: "error",
      error: {
        type: "api_error",
        message: upstreamJson?.message || upstreamJson?.error?.message || text,
      },
    });
    return;
  }

  const anthropic = transformOpenAIToAnthropic(
    upstreamJson,
    providerModel(provider, requestBody.model),
  );

  if (requestBody.stream) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.end(anthropicSseFromMessage(anthropic));
    return;
  }

  sendJson(res, 200, anthropic);
}

export function createProxyServer({ provider }) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/status") {
        sendJson(res, 200, {
          running: true,
          provider: provider?.name || null,
        });
        return;
      }
      if (req.method === "POST" && url.pathname.endsWith("/messages")) {
        await handleMessages(req, res, provider);
        return;
      }
      sendJson(res, 404, {
        type: "error",
        error: { type: "not_found_error", message: "Unsupported path" },
      });
    } catch (error) {
      sendJson(res, 500, {
        type: "error",
        error: { type: "api_error", message: errorMessage(error) },
      });
    }
  });
}

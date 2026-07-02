import assert from "node:assert/strict";
import test from "node:test";

import {
  transformAnthropicToOpenAI,
  transformOpenAIToAnthropic,
} from "../src/transform.js";

test("converts Anthropic tools to OpenAI function tools", () => {
  const result = transformAnthropicToOpenAI({
    model: "gpt-5.5-2026-04-24",
    max_tokens: 128,
    messages: [{ role: "user", content: "What is my horoscope?" }],
    tools: [
      {
        name: "get_horoscope",
        description: "Get today's horoscope.",
        input_schema: {
          type: "object",
          properties: { sign: { type: "string" } },
          required: ["sign"],
        },
      },
    ],
  });

  assert.equal(result.model, "gpt-5.5-2026-04-24");
  assert.equal(result.max_tokens, 128);
  assert.deepEqual(result.tools, [
    {
      type: "function",
      function: {
        name: "get_horoscope",
        description: "Get today's horoscope.",
        parameters: {
          type: "object",
          properties: { sign: { type: "string" } },
          required: ["sign"],
        },
      },
    },
  ]);
});

test("converts Anthropic tool_result and tool_use messages to OpenAI messages", () => {
  const result = transformAnthropicToOpenAI({
    model: "gpt-5.5-2026-04-24",
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "get_horoscope",
            input: { sign: "Aquarius" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: "Great day.",
          },
        ],
      },
    ],
  });

  assert.deepEqual(result.messages, [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "toolu_123",
          type: "function",
          function: {
            name: "get_horoscope",
            arguments: "{\"sign\":\"Aquarius\"}",
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "toolu_123",
      content: "Great day.",
    },
  ]);
});

test("coalesces consecutive assistant tool_use messages before tool results", () => {
  const result = transformAnthropicToOpenAI({
    model: "gpt-5.5-2026-04-24",
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_read",
            name: "Read",
            input: { file_path: "package.json" },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_bash",
            name: "Bash",
            input: { command: "pwd" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_read",
            content: "{}",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_bash",
            content: "/tmp",
          },
        ],
      },
    ],
  });

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].role, "assistant");
  assert.deepEqual(
    result.messages[0].tool_calls.map((call) => call.id),
    ["call_read", "call_bash"],
  );
  assert.deepEqual(
    result.messages.slice(1).map((message) => [message.role, message.tool_call_id]),
    [
      ["tool", "call_read"],
      ["tool", "call_bash"],
    ],
  );
});

test("converts multiple tool_result blocks from one user message", () => {
  const result = transformAnthropicToOpenAI({
    model: "gpt-5.5-2026-04-24",
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_read",
            name: "Read",
            input: { file_path: "README.md" },
          },
          {
            type: "tool_use",
            id: "call_bash",
            name: "Bash",
            input: { command: "pwd" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_read",
            content: "README",
          },
          {
            type: "tool_result",
            tool_use_id: "call_bash",
            content: "/tmp",
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    result.messages.map((message) => [message.role, message.tool_call_id]),
    [
      ["assistant", undefined],
      ["tool", "call_read"],
      ["tool", "call_bash"],
    ],
  );
});

test("converts OpenAI text response to Anthropic message response", () => {
  const result = transformOpenAIToAnthropic(
    {
      id: "chatcmpl_123",
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "pong" },
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
      },
    },
    "gpt-5.5-2026-04-24",
  );

  assert.equal(result.type, "message");
  assert.equal(result.role, "assistant");
  assert.equal(result.model, "gpt-5.5-2026-04-24");
  assert.deepEqual(result.content, [{ type: "text", text: "pong" }]);
  assert.deepEqual(result.usage, {
    input_tokens: 3,
    output_tokens: 2,
  });
});

test("converts OpenAI tool calls to Anthropic tool_use blocks", () => {
  const result = transformOpenAIToAnthropic(
    {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "get_horoscope",
                  arguments: "{\"sign\":\"Aquarius\"}",
                },
              },
            ],
          },
        },
      ],
    },
    "gpt-5.5-2026-04-24",
  );

  assert.equal(result.stop_reason, "tool_use");
  assert.deepEqual(result.content, [
    {
      type: "tool_use",
      id: "call_123",
      name: "get_horoscope",
      input: { sign: "Aquarius" },
    },
  ]);
});

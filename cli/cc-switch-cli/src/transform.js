import { randomUUID } from "node:crypto";

function normalizeContentBlocks(content) {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return content;
  }
  return [];
}

function stringifyToolResult(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block?.type === "text") return block.text ?? "";
        return JSON.stringify(block);
      })
      .join("");
  }
  if (content == null) {
    return "";
  }
  return JSON.stringify(content);
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function convertAnthropicMessage(message) {
  const blocks = normalizeContentBlocks(message.content);
  const textParts = [];
  const toolCalls = [];
  const toolResults = [];
  const converted = [];

  for (const block of blocks) {
    if (block?.type === "text") {
      textParts.push(block.text ?? "");
      continue;
    }

    if (block?.type === "image") {
      const source = block.source ?? {};
      const data =
        source.type === "base64"
          ? `data:${source.media_type ?? "image/jpeg"};base64,${source.data ?? ""}`
          : source.url;
      if (data) {
        converted.push({ type: "image_url", image_url: { url: data } });
      }
      continue;
    }

    if (block?.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
      continue;
    }

    if (block?.type === "tool_result") {
      toolResults.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: stringifyToolResult(block.content),
      });
      continue;
    }
  }

  if (toolResults.length > 0) {
    const trailingMessages = [];
    const text = textParts.join("");
    if (converted.length > 0) {
      if (text) converted.unshift({ type: "text", text });
      trailingMessages.push({ role: message.role, content: converted });
    } else if (text) {
      trailingMessages.push({ role: message.role, content: text });
    }
    return [...toolResults, ...trailingMessages];
  }

  if (toolCalls.length > 0) {
    return {
      role: "assistant",
      content: textParts.join("") || null,
      tool_calls: toolCalls,
    };
  }

  const text = textParts.join("");
  if (converted.length > 0) {
    if (text) converted.unshift({ type: "text", text });
    return { role: message.role, content: converted };
  }
  return { role: message.role, content: text };
}

function convertToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (toolChoice.type === "auto") return "auto";
  if (toolChoice.type === "any") return "required";
  if (toolChoice.type === "tool") {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }
  return toolChoice;
}

function coalesceConsecutiveAssistantToolCalls(messages) {
  const output = [];
  for (const message of messages) {
    const previous = output[output.length - 1];
    const canMerge =
      previous?.role === "assistant" &&
      message.role === "assistant" &&
      Array.isArray(previous.tool_calls) &&
      Array.isArray(message.tool_calls);

    if (canMerge) {
      previous.tool_calls.push(...message.tool_calls);
      if (message.content) {
        previous.content = [previous.content, message.content].filter(Boolean).join("\n");
      }
      continue;
    }

    output.push(message);
  }
  return output;
}

export function transformAnthropicToOpenAI(body) {
  const messages = [];
  const systemBlocks = normalizeContentBlocks(body.system);
  const systemText = systemBlocks
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  if (systemText) {
    messages.push({ role: "system", content: systemText });
  }

  for (const message of body.messages ?? []) {
    const converted = convertAnthropicMessage(message);
    if (Array.isArray(converted)) {
      messages.push(...converted);
    } else {
      messages.push(converted);
    }
  }

  const output = {
    model: body.model,
    messages: coalesceConsecutiveAssistantToolCalls(messages),
    stream: false,
  };

  if (body.max_tokens != null) output.max_tokens = body.max_tokens;
  if (body.temperature != null) output.temperature = body.temperature;
  if (body.top_p != null) output.top_p = body.top_p;
  if (body.stop_sequences != null) output.stop = body.stop_sequences;

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    output.tools = body.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.input_schema ?? { type: "object", properties: {} },
      },
    }));
  }

  const toolChoice = convertToolChoice(body.tool_choice);
  if (toolChoice !== undefined) {
    output.tool_choice = toolChoice;
  }

  return output;
}

function finishReason(reason, hasToolCalls) {
  if (hasToolCalls || reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "stop_sequence";
  return "end_turn";
}

export function transformOpenAIToAnthropic(body, requestModel) {
  const choice = body.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content = [];

  const text = typeof message.content === "string" ? message.content : "";
  if (text) {
    content.push({ type: "text", text });
  }

  for (const call of message.tool_calls ?? []) {
    if (call?.type !== "function") continue;
    content.push({
      type: "tool_use",
      id: call.id ?? `toolu_${randomUUID()}`,
      name: call.function?.name ?? "",
      input: parseJsonObject(call.function?.arguments),
    });
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  const hasToolCalls = content.some((block) => block.type === "tool_use");
  return {
    id: body.id ?? `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: body.model ?? requestModel,
    content,
    stop_reason: finishReason(choice.finish_reason, hasToolCalls),
    stop_sequence: null,
    usage: {
      input_tokens: body.usage?.prompt_tokens ?? 0,
      output_tokens: body.usage?.completion_tokens ?? 0,
    },
  };
}

export function anthropicSseFromMessage(message) {
  const lines = [];
  const start = { ...message, content: [] };
  lines.push(["message_start", { type: "message_start", message: start }]);

  for (let index = 0; index < message.content.length; index += 1) {
    const block = message.content[index];
    if (block.type === "text") {
      lines.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        },
      ]);
      if (block.text) {
        lines.push([
          "content_block_delta",
          {
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text: block.text },
          },
        ]);
      }
      lines.push(["content_block_stop", { type: "content_block_stop", index }]);
      continue;
    }

    if (block.type === "tool_use") {
      lines.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: {},
          },
        },
      ]);
      lines.push([
        "content_block_delta",
        {
          type: "content_block_delta",
          index,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(block.input ?? {}),
          },
        },
      ]);
      lines.push(["content_block_stop", { type: "content_block_stop", index }]);
    }
  }

  lines.push([
    "message_delta",
    {
      type: "message_delta",
      delta: {
        stop_reason: message.stop_reason,
        stop_sequence: message.stop_sequence ?? null,
      },
      usage: { output_tokens: message.usage?.output_tokens ?? 0 },
    },
  ]);
  lines.push(["message_stop", { type: "message_stop" }]);

  return lines
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

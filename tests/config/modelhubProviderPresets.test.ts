import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";
import { claudeDesktopProviderPresets } from "@/config/claudeDesktopProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { hermesProviderPresets } from "@/config/hermesProviderPresets";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";
import {
  extractCodexBaseUrl,
  extractCodexModelName,
  extractCodexWireApi,
} from "@/utils/providerConfigUtils";

const MODELHUB_BASE_URL =
  "https://aidp.bytedance.net/api/modelhub/online/v2/crawl";
const MODELHUB_MODEL = "gpt-5.5-2026-04-24";

describe("ByteDance ModelHub provider presets", () => {
  it("keeps Claude Desktop routed through the local OpenAI Chat adapter", () => {
    const preset = claudeDesktopProviderPresets.find(
      (item) => item.providerType === "bytedance_modelhub",
    );

    expect(preset).toBeDefined();
    expect(preset?.name).toBe("ByteDance ModelHub");
    expect(preset?.baseUrl).toBe(MODELHUB_BASE_URL);
    expect(preset?.isFullUrl).toBe(true);
    expect(preset?.mode).toBe("proxy");
    expect(preset?.apiFormat).toBe("openai_chat");
  });

  it("adds Claude Code preset with ModelHub routing metadata", () => {
    const preset = providerPresets.find(
      (item) => item.providerType === "bytedance_modelhub",
    );
    const env = (preset?.settingsConfig as { env: Record<string, string> })
      ?.env;

    expect(preset).toBeDefined();
    expect(preset?.name).toBe("ByteDance ModelHub");
    expect(preset?.category).toBe("cn_official");
    expect(preset?.apiFormat).toBe("openai_chat");
    expect(preset?.providerType).toBe("bytedance_modelhub");
    expect(env.ANTHROPIC_BASE_URL).toBe(MODELHUB_BASE_URL);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("");
    expect(env.ANTHROPIC_MODEL).toBe(MODELHUB_MODEL);
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(MODELHUB_MODEL);
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(MODELHUB_MODEL);
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(MODELHUB_MODEL);
  });

  it("adds Codex preset that routes Responses requests to ModelHub Chat Completions", () => {
    const preset = codexProviderPresets.find(
      (item) => item.name === "ByteDance ModelHub",
    );

    expect(preset).toBeDefined();
    expect(preset?.category).toBe("cn_official");
    expect(preset?.apiFormat).toBe("openai_chat");
    expect(extractCodexBaseUrl(preset?.config)).toBe(MODELHUB_BASE_URL);
    expect(extractCodexWireApi(preset?.config)).toBe("responses");
    expect(extractCodexModelName(preset?.config)).toBe(MODELHUB_MODEL);
    expect(preset?.endpointCandidates).toEqual([MODELHUB_BASE_URL]);
    expect(preset?.modelCatalog?.[0]).toMatchObject({
      model: MODELHUB_MODEL,
      displayName: "GPT-5.5 ModelHub",
      contextWindow: 400000,
    });
  });

  it("adds OpenCode preset using OpenAI-compatible Chat Completions config", () => {
    const preset = opencodeProviderPresets.find(
      (item) => item.name === "ByteDance ModelHub",
    );

    expect(preset).toBeDefined();
    expect(preset?.category).toBe("cn_official");
    expect(preset?.settingsConfig.npm).toBe("@ai-sdk/openai-compatible");
    expect(preset?.settingsConfig.options?.baseURL).toBe(MODELHUB_BASE_URL);
    expect(preset?.settingsConfig.options?.apiKey).toBe("");
    expect(preset?.settingsConfig.models).toHaveProperty(MODELHUB_MODEL);
    expect(preset?.settingsConfig.models[MODELHUB_MODEL]).toMatchObject({
      name: "GPT-5.5 ModelHub",
    });
  });

  it("adds OpenClaw preset using OpenAI completions config", () => {
    const preset = openclawProviderPresets.find(
      (item) => item.name === "ByteDance ModelHub",
    );

    expect(preset).toBeDefined();
    expect(preset?.category).toBe("cn_official");
    expect(preset?.settingsConfig.baseUrl).toBe(MODELHUB_BASE_URL);
    expect(preset?.settingsConfig.apiKey).toBe("");
    expect(preset?.settingsConfig.api).toBe("openai-completions");
    expect(preset?.settingsConfig.models).toEqual([
      {
        id: MODELHUB_MODEL,
        name: "GPT-5.5 ModelHub",
        contextWindow: 400000,
      },
    ]);
    expect(preset?.suggestedDefaults?.model).toEqual({
      primary: `bytedance_modelhub/${MODELHUB_MODEL}`,
    });
  });

  it("adds Hermes preset using Chat Completions mode", () => {
    const preset = hermesProviderPresets.find(
      (item) => item.name === "ByteDance ModelHub",
    );

    expect(preset).toBeDefined();
    expect(preset?.category).toBe("cn_official");
    expect(preset?.settingsConfig).toMatchObject({
      name: "bytedance_modelhub",
      base_url: MODELHUB_BASE_URL,
      api_key: "",
      api_mode: "chat_completions",
      models: [{ id: MODELHUB_MODEL, name: "GPT-5.5 ModelHub" }],
    });
    expect(preset?.suggestedDefaults).toEqual({
      model: { default: MODELHUB_MODEL, provider: "bytedance_modelhub" },
    });
  });
});

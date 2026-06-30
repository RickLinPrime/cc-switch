import { describe, expect, it } from "vitest";
import { claudeDesktopProviderPresets } from "@/config/claudeDesktopProviderPresets";

describe("Claude Desktop provider presets", () => {
  it("includes ByteDance ModelHub as a proxied OpenAI Chat full-url provider", () => {
    const preset = claudeDesktopProviderPresets.find(
      (item) => item.providerType === "bytedance_modelhub",
    );

    expect(preset).toBeDefined();
    expect(preset?.baseUrl).toBe(
      "https://aidp.bytedance.net/api/modelhub/online/v2/crawl",
    );
    expect(preset?.mode).toBe("proxy");
    expect(preset?.apiFormat).toBe("openai_chat");
    expect(preset?.isFullUrl).toBe(true);
  });
});

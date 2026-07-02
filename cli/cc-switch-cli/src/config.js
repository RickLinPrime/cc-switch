import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 15721;

export function homeDir() {
  return process.env.CC_SWITCH_CLI_HOME || os.homedir();
}

export function configPath() {
  return path.join(homeDir(), ".cc-switch-cli", "config.json");
}

export function claudeSettingsPath() {
  const override = process.env.CLAUDE_CONFIG_DIR;
  return path.join(override || path.join(homeDir(), ".claude"), "settings.json");
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on filesystems that do not support chmod.
  }
}

export function loadConfig() {
  return readJson(configPath(), {
    version: 1,
    providers: {},
    currentProviderId: null,
    language: "zh",
  });
}

export function saveConfig(config) {
  writeJson(configPath(), config);
}

export function listProviders(config = loadConfig()) {
  return Object.values(config.providers || {}).sort((a, b) => {
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

export function currentProvider(config = loadConfig()) {
  if (!config.currentProviderId) return null;
  return config.providers?.[config.currentProviderId] || null;
}

export function findProvider(nameOrId, config = loadConfig()) {
  return (
    config.providers?.[nameOrId] ||
    listProviders(config).find((provider) => provider.name === nameOrId) ||
    null
  );
}

export function writeClaudeProxySettings(provider, port = DEFAULT_PORT) {
  const settings = structuredClone(provider.settingsConfig || {});
  settings.env = settings.env || {};
  settings.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  settings.env.ANTHROPIC_AUTH_TOKEN = "cc-switch-proxy";
  settings.env.ANTHROPIC_MODEL =
    settings.env.ANTHROPIC_MODEL || "gpt-5.5-2026-04-24";
  writeJson(claudeSettingsPath(), settings);
}

export function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

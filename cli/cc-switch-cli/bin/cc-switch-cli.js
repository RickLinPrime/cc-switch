#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PORT,
  currentProvider,
  findProvider,
  listProviders,
  loadConfig,
  maskApiKey,
  saveConfig,
  writeClaudeProxySettings,
} from "../src/config.js";
import { createProxyServer } from "../src/server.js";

const VERSION = "3.16.4-modelhub.1";

function usage() {
  console.log(`ccsc ${VERSION}

Commands:
  list                         List providers
  current                      Show current provider
  use <name-or-id>             Switch current provider and write Claude proxy settings
  start [--port N]             Start the local proxy in background
  check [--port N]             Check local proxy status
  proxy start [--port N]       Start the local proxy in foreground
  proxy start --daemon         Start the local proxy in background
  proxy status [--port N]      Check local proxy status
`);
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function printProvider(provider, currentId) {
  const env = provider.settingsConfig?.env || {};
  const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || "";
  const marker = provider.id === currentId ? "*" : " ";
  console.log(
    `${marker} ${provider.name.padEnd(24)} ${maskApiKey(key).padEnd(16)} ${
      provider.apiFormat || "openai_chat"
    }`,
  );
}

async function startProxy({ daemon, port }) {
  const provider = currentProvider();
  if (!provider) {
    console.error("No current provider configured.");
    process.exit(1);
  }

  if (daemon) {
    const currentFile = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [currentFile, "proxy", "start", "--port", String(port)], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    writeClaudeProxySettings(provider, port);
    console.log(`Started cc-switch proxy on http://127.0.0.1:${port}`);
    return;
  }

  writeClaudeProxySettings(provider, port);
  const server = createProxyServer({ provider });
  server.listen(port, "127.0.0.1", () => {
    console.log(`cc-switch proxy listening on http://127.0.0.1:${port}`);
  });
}

async function proxyStatus(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`);
    const body = await response.json();
    console.log(JSON.stringify(body, null, 2));
    process.exit(response.ok ? 0 : 1);
  } catch (error) {
    console.error(`Proxy is not reachable on port ${port}: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const [command, subcommand, maybeName] = args;

  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }

  if (command === "list" || command === "ls") {
    const config = loadConfig();
    const providers = listProviders(config);
    if (providers.length === 0) {
      console.log("No providers configured");
      return;
    }
    for (const provider of providers) {
      printProvider(provider, config.currentProviderId);
    }
    return;
  }

  if (command === "current") {
    const provider = currentProvider();
    if (!provider) {
      console.log("No providers configured");
      return;
    }
    const env = provider.settingsConfig?.env || {};
    console.log(`* ${provider.name}`);
    console.log(`  Base URL: ${env.ANTHROPIC_BASE_URL || ""}`);
    console.log(`  Model:    ${env.ANTHROPIC_MODEL || ""}`);
    console.log(`  Format:   ${provider.apiFormat || "openai_chat"}`);
    return;
  }

  if (command === "use") {
    const name = subcommand;
    const config = loadConfig();
    const provider = findProvider(name, config);
    if (!provider) {
      console.error(`Provider not found: ${name}`);
      process.exit(1);
    }
    config.currentProviderId = provider.id;
    saveConfig(config);
    writeClaudeProxySettings(provider, Number(argValue(args, "--port", DEFAULT_PORT)));
    console.log(`Switched to ${provider.name}`);
    return;
  }

  if (command === "start") {
    const port = Number(argValue(args, "--port", DEFAULT_PORT));
    await startProxy({ daemon: true, port });
    return;
  }

  if (command === "check") {
    const port = Number(argValue(args, "--port", DEFAULT_PORT));
    await proxyStatus(port);
    return;
  }

  if (command === "proxy" && subcommand === "start") {
    const port = Number(argValue(args, "--port", DEFAULT_PORT));
    await startProxy({ daemon: args.includes("--daemon"), port });
    return;
  }

  if (command === "proxy" && subcommand === "status") {
    const port = Number(argValue(args, "--port", DEFAULT_PORT));
    await proxyStatus(port);
    return;
  }

  if (command === "add") {
    console.error("This repo CLI currently supports synced providers only; use existing config sync.");
    process.exit(1);
  }

  if (maybeName) {
    console.error(`Unknown command: ${args.join(" ")}`);
  } else {
    console.error(`Unknown command: ${command}`);
  }
  process.exit(1);
}

main();

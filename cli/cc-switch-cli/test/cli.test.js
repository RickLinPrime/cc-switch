import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";

const CLI = new URL("../bin/cc-switch-cli.js", import.meta.url).pathname;
const PACKAGE_JSON = new URL("../package.json", import.meta.url).pathname;

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, CC_SWITCH_CLI_HOME: "/tmp/cc-switch-cli-test-home" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function listen(server) {
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => server.address().port);
}

test("help shows simple start and check commands", async () => {
  const result = await runCli(["--help"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^ccsc 3\.16\.4-modelhub\.1/m);
  assert.match(result.stdout, /start \[--port N\]\s+Start the local proxy in background/);
  assert.match(result.stdout, /check \[--port N\]\s+Check local proxy status/);
});

test("package exposes ccsc as the short executable name", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));

  assert.equal(pkg.bin.ccsc, "bin/cc-switch-cli.js");
  assert.equal(pkg.bin["cc-switch-cli"], "bin/cc-switch-cli.js");
});

test("check command verifies proxy status", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ running: true, provider: "ByteDance ModelHub" }));
  });
  t.after(() => server.close());
  const port = await listen(server);

  const result = await runCli(["check", "--port", String(port)]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /ByteDance ModelHub/);
});

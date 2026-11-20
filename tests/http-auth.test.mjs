import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  probe.close();
  await once(probe, "close");
  return port;
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      TRANSPORT: "http",
      PORT: String(port),
      MESHY_API_KEY: "msy_test_key",
      MCP_ACCESS_TOKEN: "test-http-token",
      ...extraEnv,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let logs = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (logs += chunk));
  const url = `http://127.0.0.1:${port}`;

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) break;
      throw new Error(`Health endpoint returned ${response.status}`);
    } catch (error) {
      if (attempt >= 100 || child.exitCode !== null) {
        child.kill();
        throw new Error(`HTTP server did not start: ${logs}\n${error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return {
    url,
    child,
    async request(authorization) {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (authorization !== undefined) headers.Authorization = authorization;
      return fetch(`${url}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "http-auth-test", version: "1.0.0" },
          },
        }),
      });
    },
    stop() {
      child.kill();
    },
  };
}

test("HTTP: /health stays public while /mcp rejects missing or invalid Bearer tokens", async () => {
  const server = await startServer();
  try {
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);

    for (const authorization of [undefined, "Basic test-http-token", "Bearer wrong-token"]) {
      const response = await server.request(authorization);
      assert.equal(response.status, 401, `authorization=${authorization ?? "<missing>"}`);
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
    }

    const accepted = await server.request("Bearer test-http-token");
    assert.equal(accepted.status, 200);
    const result = await accepted.json();
    assert.equal(result.jsonrpc, "2.0");
    assert.equal(result.id, 1);
    assert.ok(result.result?.serverInfo, JSON.stringify(result));
  } finally {
    server.stop();
  }
});

test("HTTP: /mcp returns 503 when MCP_ACCESS_TOKEN is not configured", async () => {
  const server = await startServer({ MCP_ACCESS_TOKEN: "" });
  try {
    const response = await server.request("Bearer test-http-token");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "MCP authentication is not configured" });
  } finally {
    server.stop();
  }
});

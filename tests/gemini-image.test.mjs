import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { GeminiImageClient } from "../dist/services/gemini-image-client.js";
import { registerGeminiImageTools } from "../dist/tools/gemini-image.js";
import { GeminiImageInputSchema } from "../dist/schemas/gemini-image.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/X1sAAAAASUVORK5CYII=";

async function createFakeGoogleApi(status, payload) {
  const requests = [];
  const api = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  return {
    requests,
    endpoint: `http://127.0.0.1:${api.address().port}/v1beta/interactions`,
    close: () => new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve())),
  };
}

test("Gemini client uses the documented Interactions REST API and extracts image blocks", async () => {
  const api = await createFakeGoogleApi(200, {
    id: "interaction-1",
    status: "completed",
    steps: [{ type: "model_output", content: [
      { type: "text", text: "Generated." },
      { type: "image", mime_type: "image/png", data: PNG_BASE64 },
    ] }],
  });
  try {
    const client = new GeminiImageClient("test-google-key", api.endpoint);
    const result = await client.generateImage({
      prompt: "A small test image",
      model: "gemini-3.1-flash-lite-image",
      aspectRatio: "1:1",
    });
    assert.equal(result.data, PNG_BASE64);
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.text, "Generated.");
    assert.equal(result.model, "gemini-3.1-flash-lite-image");
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0].method, "POST");
    assert.equal(api.requests[0].url, "/v1beta/interactions");
    assert.equal(api.requests[0].headers["x-goog-api-key"], "test-google-key");
    assert.equal(api.requests[0].headers["api-revision"], "2026-05-20");
    assert.deepEqual(api.requests[0].body, {
      model: "gemini-3.1-flash-lite-image",
      input: "A small test image",
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" },
      store: false,
    });
  } finally {
    await api.close();
  }
});

test("Gemini client with GEMINI_API_KEY sends the key header (flag off)", async () => {
  const api = await createFakeGoogleApi(200, { status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: PNG_BASE64 }] }] });
  try {
    const client = new GeminiImageClient("test-google-key", api.endpoint, false);
    await client.generateImage({ prompt: "A test", model: "gemini-3.1-flash-lite-image" });
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0].headers["x-goog-api-key"], "test-google-key");
  } finally {
    await api.close();
  }
});

test("Gemini client keeps sending the local key when proxy mode is also enabled", async () => {
  const api = await createFakeGoogleApi(200, { status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: PNG_BASE64 }] }] });
  try {
    const client = new GeminiImageClient("test-google-key", api.endpoint, true);
    await client.generateImage({ prompt: "A test", model: "gemini-3.1-flash-lite-image" });
    assert.equal(api.requests[0].headers["x-goog-api-key"], "test-google-key");
  } finally {
    await api.close();
  }
});

test("Gemini client in proxy mode (no key, header injected) sends the request without x-goog-api-key", async () => {
  const api = await createFakeGoogleApi(200, { status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: PNG_BASE64 }] }] });
  try {
    const client = new GeminiImageClient("", api.endpoint, true);
    const result = await client.generateImage({ prompt: "A test", model: "gemini-3.1-flash-lite-image" });
    assert.equal(result.data, PNG_BASE64);
    assert.equal(api.requests.length, 1);
    assert.equal(Object.hasOwn(api.requests[0].headers, "x-goog-api-key"), false);
    assert.equal(api.requests[0].headers["api-revision"], "2026-05-20");
  } finally {
    await api.close();
  }
});

test("Gemini client rejects when neither key nor proxy mode is configured, before any request", async () => {
  const api = await createFakeGoogleApi(200, {});
  try {
    const client = new GeminiImageClient("", api.endpoint, false);
    await assert.rejects(
      client.generateImage({ prompt: "A test", model: "gemini-3.1-flash-lite-image" }),
      /GEMINI_API_KEY is not configured.*GEMINI_API_KEY_HEADER_INJECTED=true/,
    );
    assert.equal(api.requests.length, 0);
  } finally {
    await api.close();
  }
});

test("Gemini client reads GEMINI_API_KEY_HEADER_INJECTED from the environment (true only)", async () => {
  const saved = { key: process.env.GEMINI_API_KEY, flag: process.env.GEMINI_API_KEY_HEADER_INJECTED };
  try {
    delete process.env.GEMINI_API_KEY;
    for (const [value, allowed] of [["true", true], [" TRUE ", true], ["false", false], ["1", false], [undefined, false]]) {
      if (value === undefined) delete process.env.GEMINI_API_KEY_HEADER_INJECTED; else process.env.GEMINI_API_KEY_HEADER_INJECTED = value;
      const api = await createFakeGoogleApi(200, { status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: PNG_BASE64 }] }] });
      try {
        const client = new GeminiImageClient(undefined, api.endpoint);
        const attempt = client.generateImage({ prompt: "A test", model: "gemini-3.1-flash-lite-image" });
        if (allowed) { await attempt; assert.equal(api.requests.length, 1, String(value)); }
        else { await assert.rejects(attempt, /GEMINI_API_KEY is not configured/, String(value)); assert.equal(api.requests.length, 0); }
      } finally {
        await api.close();
      }
    }
  } finally {
    if (saved.key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved.key;
    if (saved.flag === undefined) delete process.env.GEMINI_API_KEY_HEADER_INJECTED; else process.env.GEMINI_API_KEY_HEADER_INJECTED = saved.flag;
  }
});

test("Gemini client reports Google quota errors clearly", async () => {
  const api = await createFakeGoogleApi(429, { error: { message: "Quota exceeded" } });
  try {
    const client = new GeminiImageClient("test-google-key", api.endpoint);
    await assert.rejects(
      client.generateImage({ prompt: "A test", model: "gemini-3.1-flash-lite-image" }),
      /rate or quota limit reached.*Quota exceeded/,
    );
  } finally {
    await api.close();
  }
});

test("Lite model schema rejects unsupported 2K and 4K requests", () => {
  for (const image_size of ["2K", "4K"]) {
    const result = GeminiImageInputSchema.safeParse({
      prompt: "A test image",
      model: "gemini-3.1-flash-lite-image",
      image_size,
    });
    assert.equal(result.success, false, image_size);
  }
});

test("Gemini tool returns an MCP image block and does not use Meshy client", async () => {
  const registered = new Map();
  const fakeClient = {
    async generateImage(input) {
      assert.equal(input.prompt, "A blue crystal icon");
      return { data: PNG_BASE64, mimeType: "image/png", model: "gemini-3.1-flash-lite-image" };
    },
  };
  registerGeminiImageTools({ registerTool(name, config, handler) { registered.set(name, { config, handler }); } }, fakeClient);
  const tool = registered.get("google_generate_image");
  assert.ok(tool);
  const args = tool.config.inputSchema.parse({ prompt: "A blue crystal icon" });
  const result = await tool.handler(args);
  assert.equal(result.isError, undefined);
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].mimeType, "image/png");
  assert.equal(result.content[1].data, PNG_BASE64);
});

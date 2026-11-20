#!/usr/bin/env node
/**
 * Meshy MCP Server
 *
 * Model Context Protocol server for Meshy AI's 3D generation platform.
 * Enables AI agents to create and manage 3D models programmatically.
 */

import { createHash, timingSafeEqual } from "node:crypto";

// Load environment variables from .env file
import dotenv from "dotenv";
// Redirect console.log to stderr during dotenv load to prevent stdio corruption
// (dotenv may call console.log which would corrupt the stdio JSON-RPC transport)
const originalLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);
dotenv.config();
console.log = originalLog;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";
import { createMeshyClient } from "./services/meshy-client.js";
import type { HostInfo } from "./utils/user-agent.js";
import { registerGenerationTools } from "./tools/generation.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerPostProcessingTools } from "./tools/postprocessing.js";
import { registerConversionTools } from "./tools/conversion.js";
import { registerImageTools } from "./tools/image.js";
import { registerPrintingTools } from "./tools/printing.js";
import { registerCreativeLabTools } from "./tools/creative-lab.js";
import { registerBalanceTool } from "./tools/balance.js";
import { GeminiImageClient } from "./services/gemini-image-client.js";
import { registerGeminiImageTools } from "./tools/gemini-image.js";
import { MESHY_INSTRUCTIONS } from "./instructions.js";
import { VERSION } from "./version.js";

// Create MCP server instance
const server = new McpServer(
  { name: "@meshy-ai/meshy-mcp-server", version: VERSION },
  { instructions: MESHY_INSTRUCTIONS }
);

/**
 * Initialize server and register tools. `clientInfo` names the connected MCP
 * client in the API User-Agent.
 */
async function initializeServer(clientInfo?: () => HostInfo | undefined) {
  try {
    const meshyClient = createMeshyClient(clientInfo);
    console.error("✓ Meshy client initialized");

    console.error("Registering MCP tools...");

    registerGenerationTools(server, meshyClient);
    console.error("  ✓ Generation tools registered (text-to-3d, text-to-3d-refine, image-to-3d, multi-image-to-3d)");

    registerTaskTools(server, meshyClient);
    console.error("  ✓ Task management tools registered (get status, list, cancel, download)");

    registerWorkspaceTools(server, meshyClient);
    console.error("  ✓ Workspace tools registered (list models)");

    registerPostProcessingTools(server, meshyClient);
    console.error("  ✓ Post-processing tools registered (remesh, retexture, rig, animate, text-to-motion, animation library)");

    registerConversionTools(server, meshyClient);
    console.error("  ✓ Conversion tools registered (convert, resize, uv-unwrap)");

    registerImageTools(server, meshyClient);
    console.error("  ✓ Image tools registered (text-to-image, image-to-image)");

    registerPrintingTools(server, meshyClient);
    console.error("  ✓ Printing tools registered (send-to-slicer, analyze-printability, repair-printability, process-multicolor, auto-split)");

    registerCreativeLabTools(server, meshyClient);
    console.error("  ✓ Creative Lab tool registered (end-to-end prototype→build)");

    registerBalanceTool(server, meshyClient);
    console.error("  ✓ Account tools registered (check-balance, list-usage)");

    registerGeminiImageTools(server, new GeminiImageClient());
    console.error("  ✓ Google Gemini image tool registered (google_generate_image)");

    console.error("✓ Server initialized successfully with 29 tools");
    return meshyClient;
  } catch (error) {
    console.error("Failed to initialize server:", error);
    throw error;
  }
}

/**
 * Strip the `$schema` dialect marker from every tool schema we publish.
 */
function stripSchemaDialect(transport: Transport): Transport {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    const tools = (message as { result?: { tools?: unknown } }).result?.tools;
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        delete tool?.inputSchema?.$schema;
        delete tool?.outputSchema?.$schema;
      }
    }
    return send(message, options);
  };
  return transport;
}

/**
 * Run server with stdio transport (for local integrations)
 */
async function runStdio() {
  console.error("Starting Meshy MCP Server (stdio mode)...");

  await initializeServer(() => server.server.getClientVersion());

  const transport = new StdioServerTransport();
  await server.connect(stripSchemaDialect(transport));

  console.error("✓ Meshy MCP Server running via stdio");
  console.error("Ready to accept requests from MCP client");
}

/**
 * Run server with HTTP transport (for remote access)
 */
async function runHTTP() {
  console.error("Starting Meshy MCP Server (HTTP mode)...");

  await initializeServer();

  const app = express();

  app.use(express.json({ limit: "100mb" }));

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", server: "meshy-mcp-server", version: VERSION });
  });

  // Protect every MCP HTTP method with a private bearer token.
  app.use("/mcp", (req, res, next) => {
    const expectedToken = process.env.MCP_ACCESS_TOKEN?.trim();

    if (!expectedToken) {
      console.error("MCP_ACCESS_TOKEN is not configured");
      res.status(503).json({ error: "MCP authentication is not configured" });
      return;
    }

    const authHeader = req.header("authorization") ?? "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const suppliedToken = match?.[1]?.trim() ?? "";

    if (!suppliedToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const expectedHash = createHash("sha256")
      .update(expectedToken)
      .digest();

    const suppliedHash = createHash("sha256")
      .update(suppliedToken)
      .digest();

    if (!timingSafeEqual(expectedHash, suppliedHash)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  });

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on("close", () => transport.close());

    await server.connect(stripSchemaDialect(transport));
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);

  app.listen(port, () => {
    console.error(`✓ Meshy MCP Server running on port ${port}`);
    console.error(`Health check: http://localhost:${port}/health`);
  });
}

/**
 * Main entry point
 */
async function main() {
  const transport = process.env.TRANSPORT || "stdio";

  try {
    if (transport === "http") {
      await runHTTP();
    } else {
      await runStdio();
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.error("\nShutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("\nShutting down gracefully...");
  process.exit(0);
});

// Start the server
main();

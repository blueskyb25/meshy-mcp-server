import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GeminiImageClient } from "../services/gemini-image-client.js";
import { GeminiImageInputSchema } from "../schemas/gemini-image.js";

/** Register Google's image generation independently of Meshy tools and credits. */
export function registerGeminiImageTools(server: McpServer, client: GeminiImageClient) {
  server.registerTool(
    "google_generate_image",
    {
      title: "Generate Image with Google Gemini",
      description: "Generate one 2D image directly with Google's Gemini image API (Google AI Studio), independently of Meshy credits. Default model: gemini-3.1-flash-lite-image (economical 1K output). Use gemini-3.1-flash-image for 2K/4K output or gemini-3-pro-image for premium detailed work. Returns the generated image to the MCP client. This synchronous tool uses standard API pricing, not discounted Batch pricing. A timeout may still result in a billable generation; check Google usage before retrying.",
      inputSchema: GeminiImageInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: z.infer<typeof GeminiImageInputSchema>) => {
      try {
        const result = await client.generateImage({
          prompt: params.prompt,
          model: params.model,
          aspectRatio: params.aspect_ratio,
          imageSize: params.image_size,
        });
        const sizeBytes = Math.floor((result.data.length * 3) / 4);
        return {
          content: [
            { type: "text" as const, text: `Image generated successfully with Google Gemini. Model: ${result.model}. Format: ${result.mimeType}. Approximate size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB.${result.text ? `\n\nModel note: ${result.text}` : ""}` },
            { type: "image" as const, data: result.data, mimeType: result.mimeType },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Unknown Google Gemini image generation error." }],
        };
      }
    },
  );
}

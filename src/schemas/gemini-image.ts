import { z } from "zod";

export const GeminiImageInputSchema = z.object({
  prompt: z.string().trim().min(1).max(12000).describe("Detailed visual prompt. Include composition, style, lighting, camera, materials, and exclusions."),
  model: z.enum(["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image"])
    .default("gemini-3.1-flash-lite-image")
    .describe("Image model. Flash Lite is the economical 1K option; Flash Image supports higher resolutions; Pro Image is for premium detailed work."),
  aspect_ratio: z.enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"])
    .optional().describe("Optional output aspect ratio."),
  image_size: z.enum(["1K", "2K", "4K"]).optional()
    .describe("Output resolution. Flash Lite supports 1K only; Flash Image and Pro Image support higher resolutions."),
}).strict().superRefine((value, context) => {
  if (value.model === "gemini-3.1-flash-lite-image" && value.image_size && value.image_size !== "1K") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["image_size"],
      message: "gemini-3.1-flash-lite-image supports 1K only. Select gemini-3.1-flash-image or gemini-3-pro-image for 2K/4K.",
    });
  }
});

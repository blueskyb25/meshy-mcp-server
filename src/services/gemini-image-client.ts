/** Google Gemini native image generation client (Google AI Studio / Gemini API). */
import axios from "axios";

export type GeminiImageModel =
  | "gemini-3.1-flash-lite-image"
  | "gemini-3.1-flash-image"
  | "gemini-3-pro-image";
export type GeminiAspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
export type GeminiImageSize = "1K" | "2K" | "4K";

const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface GeminiGeneratedImage {
  data: string;
  mimeType: string;
  text?: string;
  model: GeminiImageModel;
}

interface GeminiImageContent {
  type?: string;
  data?: string;
  mime_type?: string;
  text?: string;
}

interface GeminiInteractionResponse {
  status?: string;
  output_image?: { data?: string; mime_type?: string };
  output_text?: string;
  steps?: Array<{
    type?: string;
    content?: GeminiImageContent[];
  }>;
  error?: { message?: string; status?: string; code?: number };
}

export class GeminiImageClient {
  private readonly apiKey: string | undefined;

  /** endpoint is injectable for deterministic local HTTP tests; production uses Google's endpoint. */
  constructor(
    apiKey: string | undefined = process.env.GEMINI_API_KEY,
    private readonly endpoint = DEFAULT_ENDPOINT,
  ) {
    this.apiKey = apiKey?.trim() || undefined;
  }

  async generateImage(input: {
    prompt: string;
    model: GeminiImageModel;
    aspectRatio?: GeminiAspectRatio;
    imageSize?: GeminiImageSize;
  }): Promise<GeminiGeneratedImage> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not configured. Add it to Render Environment Variables.");
    }

    if (input.model === "gemini-3.1-flash-lite-image" && input.imageSize && input.imageSize !== "1K") {
      throw new Error("gemini-3.1-flash-lite-image supports 1K images only. Choose another model for 2K or 4K output.");
    }

    const responseFormat: Record<string, string> = {
      type: "image",
      mime_type: "image/png",
    };
    if (input.aspectRatio) responseFormat.aspect_ratio = input.aspectRatio;
    responseFormat.image_size = input.imageSize ?? "1K";

    let response;
    try {
      response = await axios.post<GeminiInteractionResponse>(this.endpoint, {
        model: input.model,
        input: input.prompt,
        response_format: responseFormat,
        store: false,
      }, {
        timeout: 180_000,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
          "Api-Revision": "2026-05-20",
        },
        maxContentLength: 30 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data as { error?: { message?: string } } | undefined;
        const message = data?.error?.message;
        if (status === 401 || status === 403) {
          throw new Error(`Google API authentication/permission error${message ? `: ${message}` : ". Check GEMINI_API_KEY and API access."}`);
        }
        if (status === 429) {
          throw new Error(`Google API rate or quota limit reached${message ? `: ${message}` : ". Check Google AI Studio quota and billing."}`);
        }
        if (error.code === "ECONNABORTED") {
          throw new Error("Google image generation timed out. The request may still have completed and may be billable; check Google usage before submitting it again.");
        }
        throw new Error(`Google Gemini request failed${status ? ` (HTTP ${status})` : ""}${message ? `: ${message}` : `: ${error.message}`}`);
      }
      throw error;
    }

    const payload = response.data;
    const imageFromConvenienceField = payload.output_image;
    const modelOutputContent = payload.steps
      ?.filter((step) => !step.type || step.type === "model_output")
      .flatMap((step) => step.content ?? []) ?? [];
    const imageFromSteps = modelOutputContent.find((item) => item.type === "image" && item.data && item.mime_type);
    const imageData = imageFromConvenienceField?.data ?? imageFromSteps?.data;
    const mimeType = imageFromConvenienceField?.mime_type ?? imageFromSteps?.mime_type;
    const text = [
      payload.output_text,
      ...modelOutputContent.filter((item) => item.type === "text" && item.text).map((item) => item.text),
    ].filter((value): value is string => Boolean(value?.trim())).join("\n").trim();

    if (!imageData || !mimeType) {
      const details = payload.error?.message || text || `Google interaction status: ${payload.status ?? "unknown"}`;
      throw new Error(`Google returned no image: ${details}`);
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
      throw new Error(`Google returned an unsupported image MIME type: ${mimeType}`);
    }

    const imageBytes = Math.floor((imageData.length * 3) / 4);
    if (imageBytes <= 0 || imageBytes > MAX_IMAGE_BYTES) {
      throw new Error(`Google image size is outside the accepted limit (maximum ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
    }

    return { data: imageData, mimeType, text: text || undefined, model: input.model };
  }
}

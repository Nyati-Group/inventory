import { ApiError, GoogleGenAI } from "@google/genai";
import type { ZodType } from "zod";

// Google Gemini (GEMINI_API_KEY) for quotation extraction and market-price extraction.
export const LLM_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

export function llmAvailable() {
  return !!process.env.GEMINI_API_KEY;
}

/** One piece of the prompt: text, or a document/image sent inline (base64). */
export type LlmPart = { text: string } | { inlineData: { mimeType: string; data: string } };

let client: GoogleGenAI | null = null;
function getClient() {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [2_000, 6_000, 15_000];

/** Retry temporary Gemini errors (overload, rate limit) with back-off; other errors fail at once. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof ApiError) || !RETRYABLE.has(e.status) || attempt >= BACKOFF_MS.length) throw e;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }
}

/**
 * Ask Gemini for JSON matching `schema` (structured output via responseJsonSchema), validate with zod,
 * retry once on invalid output.
 */
export async function llmJson<T>(opts: { system: string; parts: LlmPart[]; schema: Record<string, unknown>; validate: ZodType<T> }): Promise<T> {
  if (!llmAvailable()) throw new Error("GEMINI_API_KEY is not configured");
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = attempt === 0 ? opts.parts : [...opts.parts, { text: `Your previous output was invalid: ${lastError}. Return corrected JSON only.` }];
    const res = await withRetry(() =>
      getClient().models.generateContent({
        model: LLM_MODEL,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema,
          temperature: 0,
        },
      }),
    );
    const blocked = res.promptFeedback?.blockReason;
    if (blocked) throw new Error(`Gemini blocked the request (${blocked})`);
    const text = res.text ?? "";
    try {
      const parsed = opts.validate.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) {
      lastError = `JSON parse error: ${(e as Error).message}`;
    }
  }
  throw new Error(`Extraction output failed validation: ${lastError}`);
}

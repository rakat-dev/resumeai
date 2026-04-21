import { callOpenAI } from "./openai-client";
import { DedupeSchema } from "./schemas";
import { SYSTEM_PROMPT_BASE, DEDUPE_PROMPT } from "./prompts";
import type { DedupeResult } from "./types";

export async function dedupeAssist(
  jobA: Record<string, unknown>,
  jobB: Record<string, unknown>
): Promise<DedupeResult | null> {
  if (process.env.AI_DEDUPE_ASSIST_ENABLED !== "true" || process.env.AI_ENABLED === "false") {
    return null;
  }

  const model = process.env.AI_MODEL_DEFAULT ?? "gpt-4o-mini";
  const userPrompt = DEDUPE_PROMPT
    .replace("{{JOB_A_JSON}}", JSON.stringify(jobA))
    .replace("{{JOB_B_JSON}}", JSON.stringify(jobB));

  try {
    const result = await callOpenAI(SYSTEM_PROMPT_BASE, userPrompt, { model });
    const parsed = DedupeSchema.safeParse(JSON.parse(result.content));
    if (!parsed.success) {
      console.warn("[AI] dedupeAssist validation failed:", parsed.error.message);
      return null;
    }
    return parsed.data;
  } catch (e: unknown) {
    console.warn("[AI] dedupeAssist error:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

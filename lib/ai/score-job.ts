import { callOpenAI } from "./openai-client";
import { FitScoreSchema } from "./schemas";
import { SYSTEM_PROMPT_BASE, FIT_SCORE_PROMPT } from "./prompts";
import type { FitScoreResult, JobNormalization } from "./types";

export async function scoreJobFit(
  job: { company: string; title: string; location: string; description: string },
  normalization: JobNormalization
): Promise<FitScoreResult | null> {
  if (process.env.AI_ENABLED === "false" || process.env.AI_ENRICHMENT_ENABLED === "false") {
    return null;
  }

  const model = process.env.AI_MODEL_DEFAULT ?? "gpt-4o-mini";
  const rawJobJson = JSON.stringify(job);
  const normJson = JSON.stringify(normalization);

  const userPrompt = FIT_SCORE_PROMPT
    .replace("{{RAW_JOB_JSON}}", rawJobJson)
    .replace("{{NORMALIZATION_JSON}}", normJson);

  try {
    const result = await callOpenAI(SYSTEM_PROMPT_BASE, userPrompt, { model });
    const parsed = FitScoreSchema.safeParse(JSON.parse(result.content));
    if (!parsed.success) {
      console.warn("[AI] fitScore validation failed:", parsed.error.message);
      return null;
    }
    return parsed.data;
  } catch (e: unknown) {
    console.warn("[AI] scoreJobFit error:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

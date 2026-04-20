import { createHash } from "crypto";
import { callOpenAI } from "./openai-client";
import { JobNormalizationSchema, RelevanceSchema } from "./schemas";
import { SYSTEM_PROMPT_BASE, NORMALIZATION_PROMPT, RELEVANCE_PROMPT, PROMPT_VERSION } from "./prompts";
import type { EnrichedJob, AiEnrichment, AiMeta, JobNormalization } from "./types";

export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED !== "false" && process.env.AI_ENRICHMENT_ENABLED !== "false";
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  result: EnrichedJob;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface JobInputForEnrichment {
  company: string;
  id?: string;
  url?: string;
  title: string;
  location: string;
  description: string;
  employmentType?: string;
  team?: string;
}

export function buildCacheKey(job: JobInputForEnrichment): string {
  const model = process.env.AI_MODEL_DEFAULT ?? "gpt-4o-mini";
  const contentHash = createHash("sha256")
    .update(job.title + job.location + job.description.slice(0, 500))
    .digest("hex");
  const idPart = job.id ?? job.url ?? "";
  return createHash("sha256")
    .update(`${job.company}|${idPart}|${contentHash}|${PROMPT_VERSION}|${model}`)
    .digest("hex");
}

export function buildRawHash(job: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(job))
    .digest("hex")
    .slice(0, 32);
}

function makeMeta(
  cacheKey: string,
  rawHash: string,
  startMs: number,
  status: AiMeta["status"],
  extra?: Partial<AiMeta>
): AiMeta {
  return {
    cacheKey,
    promptVersion: PROMPT_VERSION,
    rawHash,
    latencyMs: Date.now() - startMs,
    status,
    ...extra,
  };
}

export async function enrichJob(job: JobInputForEnrichment): Promise<EnrichedJob> {
  const startMs = Date.now();
  const cacheKey = buildCacheKey(job);
  const rawHash = buildRawHash(job);

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.result, aiMeta: { ...cached.result.aiMeta, status: "cached" } };
  }

  if (!isAiEnabled()) {
    return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "skipped") };
  }

  const model = process.env.AI_MODEL_DEFAULT ?? "gpt-4o-mini";
  let totalInput = 0, totalOutput = 0;

  try {
    const rawJobJson = JSON.stringify(job);

    const normUserPrompt = NORMALIZATION_PROMPT.replace("{{RAW_JOB_JSON}}", rawJobJson);
    const normResult = await callOpenAI(SYSTEM_PROMPT_BASE, normUserPrompt, { model, maxTokens: 500 });
    totalInput  += normResult.usage.input;
    totalOutput += normResult.usage.output;

    const normParsed = JobNormalizationSchema.safeParse(JSON.parse(normResult.content));
    if (!normParsed.success) {
      console.warn("[AI] normalization validation failed:", normParsed.error.message);
      return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "failed", { error: "normalization_validation_failed" }) };
    }
    const normData: JobNormalization = normParsed.data;

    const relUserPrompt = RELEVANCE_PROMPT
      .replace("{{RAW_JOB_JSON}}", rawJobJson)
      .replace("{{NORMALIZATION_JSON}}", JSON.stringify(normData));
    const relResult = await callOpenAI(SYSTEM_PROMPT_BASE, relUserPrompt, { model, maxTokens: 300 });
    totalInput  += relResult.usage.input;
    totalOutput += relResult.usage.output;

    const relParsed = RelevanceSchema.safeParse(JSON.parse(relResult.content));
    if (!relParsed.success) {
      console.warn("[AI] relevance validation failed:", relParsed.error.message);
      return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "failed", { error: "relevance_validation_failed" }) };
    }
    const relData = relParsed.data;

    const aiEnrichment: AiEnrichment = {
      version:             PROMPT_VERSION,
      normalizedTitle:     normData.normalizedTitle,
      roleFamily:          normData.roleFamily,
      seniority:           normData.seniority,
      skills:              normData.skills,
      relatedTitleMatches: normData.relatedTitleMatches,
      sponsorshipSignal:   normData.sponsorshipSignal,
      remoteType:          normData.remoteType,
      relevanceScore:      relData.relevanceScore,
      fitScore:            0,
      confidence:          normData.confidence,
      summary:             "",
      reasons:             relData.reasons,
      warnings:            [...normData.warnings, ...relData.warnings],
      enrichedAt:          new Date().toISOString(),
      sourceModel:         model,
    };

    const aiMeta: AiMeta = makeMeta(cacheKey, rawHash, startMs, "success", {
      tokenUsage: { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
    });

    const enriched: EnrichedJob = { ai: aiEnrichment, aiMeta };
    cache.set(cacheKey, { result: enriched, expiresAt: Date.now() + CACHE_TTL_MS });
    return enriched;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[AI] enrichJob error:", msg);
    return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "failed", { error: msg }) };
  }
}

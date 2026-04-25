import { createHash } from "crypto";
import { callOpenAI } from "./openai-client";
import { JobNormalizationSchema, RelevanceSchema } from "./schemas";
import { SYSTEM_PROMPT_BASE, NORMALIZATION_PROMPT, RELEVANCE_PROMPT, PROMPT_VERSION } from "./prompts";
import { scoreJobFit } from "./score-job";
import {
  cleanJobDescription,
  parseJobSections,
  extractSponsorshipLines,
  assemblePromptDescription,
} from "./clean-job-description";
import type { EnrichedJob, AiEnrichment, AiMeta, JobNormalization } from "./types";

// Three-tier JD-length policy for AI enrichment:
//   < MIN_JD_CHARS_FOR_ENRICHMENT (800)         → skip OpenAI entirely
//   [MIN, LOW_CONFIDENCE_JD_THRESHOLD) (800-1200) → enrich, tag aiMeta.confidence="low"
//   >= LOW_CONFIDENCE_JD_THRESHOLD (1200)        → enrich normally
//
// Confidence tagging is metadata only — it does not change prompt content or
// scoring. Job ingestion/storage are NOT gated by this; only the enrichment
// path here is affected.
const MIN_JD_CHARS_FOR_ENRICHMENT = 800;
const LOW_CONFIDENCE_JD_THRESHOLD = 1200;

export function isAiEnabled(): boolean {
  // AI is OPT-IN: requires AI_ENABLED=true to be explicitly set.
  // Default-off prevents accidental function timeouts when the key is
  // present but the operator has not confirmed the enrichment budget.
  return (
    process.env.AI_ENABLED === "true" &&
    process.env.AI_ENRICHMENT_ENABLED !== "false" &&
    !!process.env.OPENAI_API_KEY
  );
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
  // Source tag (e.g. "amazon_jobs", "walmart_cxs") — surfaced in skip
  // diagnostics so the operator can attribute insufficient_jd_content cases
  // to a specific scraper.
  source?: string;
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

  // 1. Clean the raw description (strip scripts/HTML/analytics/EEO/etc.).
  //    Cache key was already computed from the *raw* job above so bumping
  //    PROMPT_VERSION is the way to invalidate when cleaning logic changes.
  const cleanedDescription = cleanJobDescription(job.description);

  // 2. Safety guard — if the cleaner produced too little content, the JD is
  //    almost certainly broken (failed extraction, page chrome only). Don't
  //    burn an OpenAI call on it.
  if (cleanedDescription.length < MIN_JD_CHARS_FOR_ENRICHMENT) {
    console.log(
      `[ai_skip] job_id=${job.id ?? "unknown"} source=${job.source ?? "unknown"} chars=${cleanedDescription.length} reason=insufficient_jd_content`,
    );
    return {
      ai: null,
      aiMeta: makeMeta(cacheKey, rawHash, startMs, "skipped", {
        reason: "insufficient_jd_content",
        source: job.source,
        jobId: job.id,
      }),
    };
  }

  // 2b. Enrich, but flag the result as low-confidence when the cleaned JD
  //     sits in the [MIN, LOW_CONFIDENCE_JD_THRESHOLD) band — the AI is
  //     working from limited evidence and downstream consumers should weight
  //     the result accordingly. Metadata only; prompt/scoring unchanged.
  const isLowConfidence = cleanedDescription.length < LOW_CONFIDENCE_JD_THRESHOLD;

  // 3. Parse cleaned text into sections + extract sponsorship lines so they
  //    can be appended unconditionally at the end of every prompt.
  const sections = parseJobSections(cleanedDescription);
  const sponsorshipLines = extractSponsorshipLines(cleanedDescription);

  // 4. Assemble the final prompt description (priority-ordered + structured
  //    trim). This replaces job.description in the JSON payload sent to the
  //    model — title/company/location/url stay intact.
  const promptDescription = assemblePromptDescription(sections, sponsorshipLines);
  const promptJob: JobInputForEnrichment = {
    ...job,
    description: promptDescription,
  };

  try {
    const rawJobJson = JSON.stringify(promptJob);

    const normUserPrompt = NORMALIZATION_PROMPT.replace("{{RAW_JOB_JSON}}", rawJobJson);
    const normResult = await callOpenAI(SYSTEM_PROMPT_BASE, normUserPrompt, { model });
    if (normResult.error === "rate_limited") {
      console.warn(`[enrich-job] returning null ai reason=rate_limited_norm jobId=${job.id ?? "unknown"}`);
      return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "failed", { error: "rate_limited" }) };
    }
    if (!normResult.content || normResult.content.trim() === "") {
      console.warn(`[enrich-job] empty content from normalization jobId=${job.id ?? "unknown"}`);
    }
    totalInput  += normResult.usage.input;
    totalOutput += normResult.usage.output;

    const normParsed = JobNormalizationSchema.safeParse(JSON.parse(normResult.content));
    if (!normParsed.success) {
      console.warn("[AI] normalization validation failed:", normParsed.error.message);
      console.warn(`[enrich-job] returning null ai reason=norm_parse_failed jobId=${job.id ?? "unknown"}`);
      return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "failed", { error: "normalization_validation_failed" }) };
    }
    const normData: JobNormalization = normParsed.data;

    const relUserPrompt = RELEVANCE_PROMPT
      .replace("{{RAW_JOB_JSON}}", rawJobJson)
      .replace("{{NORMALIZATION_JSON}}", JSON.stringify(normData));
    const relResult = await callOpenAI(SYSTEM_PROMPT_BASE, relUserPrompt, { model });
    if (relResult.error === "rate_limited") {
      console.warn(`[enrich-job] returning null ai reason=rate_limited_rel jobId=${job.id ?? "unknown"}`);
      return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "failed", { error: "rate_limited" }) };
    }
    if (!relResult.content || relResult.content.trim() === "") {
      console.warn(`[enrich-job] empty content from relevance jobId=${job.id ?? "unknown"}`);
    }
    totalInput  += relResult.usage.input;
    totalOutput += relResult.usage.output;

    const relParsed = RelevanceSchema.safeParse(JSON.parse(relResult.content));
    if (!relParsed.success) {
      console.warn("[AI] relevance validation failed:", relParsed.error.message);
      console.warn(`[enrich-job] returning null ai reason=rel_parse_failed jobId=${job.id ?? "unknown"}`);
      return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "failed", { error: "relevance_validation_failed" }) };
    }
    const relData = relParsed.data;

    // Step 3: Fit score — uses the cleaned description for the same reason
    // the normalization/relevance prompts do (smaller, no noise).
    const fitResult = await scoreJobFit(
      { company: promptJob.company, title: promptJob.title, location: promptJob.location, description: promptJob.description },
      normData
    );
    if (fitResult) {
      totalInput  += 0; // token usage not tracked through scoreJobFit (separate call)
      totalOutput += 0;
    }

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
      fitScore:            fitResult?.fitScore ?? 0,
      confidence:          normData.confidence,
      summary:             "",
      reasons:             [...relData.reasons, ...(fitResult?.reasons ?? [])],
      warnings:            [...normData.warnings, ...relData.warnings],
      enrichedAt:          new Date().toISOString(),
      sourceModel:         model,
    };

    const aiMeta: AiMeta = makeMeta(cacheKey, rawHash, startMs, "success", {
      tokenUsage: { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
      ...(isLowConfidence ? { confidence: "low" as const } : {}),
    });

    const enriched: EnrichedJob = { ai: aiEnrichment, aiMeta };
    cache.set(cacheKey, { result: enriched, expiresAt: Date.now() + CACHE_TTL_MS });
    return enriched;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[AI] enrichJob error:", msg);
    console.warn(`[enrich-job] returning null ai reason=outer_catch error=${msg} jobId=${job.id ?? "unknown"}`);
    return { ai: null, aiMeta: makeMeta(cacheKey, rawHash, startMs, "failed", { error: msg }) };
  }
}

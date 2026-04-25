import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enrichBatch } from "@/lib/ai/enrich-batch";
import { isAiEnabled } from "@/lib/ai/enrich-job";
import type { JobInputForEnrichment } from "@/lib/ai/enrich-job";
import { PROMPT_VERSION } from "@/lib/ai/prompts";

export const maxDuration = 60;

const ENRICH_ELIGIBLE_SOURCES = new Set(["walmart_cxs", "amazon_jobs", "google_v2"]);

// Sized so a single call reliably fits inside Vercel's 60s function limit.
// Empirically: 15 jobs × ~2 OpenAI calls each at concurrency 3 ≈ 25-35s wall.
// Two batches max with a 40s budget keeps the worst case well under 60s.
// Operators can call /api/jobs/enrich repeatedly to drain remaining jobs.
const AI_BATCH_SIZE = 15;
const AI_MAX_BATCHES_PER_CALL = 2;
const AI_MAX_RUNTIME_MS = 40_000;

interface EnrichResult {
  source:             string;
  selected:           number;
  eligible:           number;
  batches_attempted:  number;
  batches_completed:  number;
  total_sent:         number;
  persisted:          number;
  skipped:            number;
  stopped_early:      boolean;
  error?:             string;
}

async function enrichSource(source: string): Promise<EnrichResult> {
  const result: EnrichResult = {
    source, selected: 0, eligible: 0,
    batches_attempted: 0, batches_completed: 0,
    total_sent: 0, persisted: 0, skipped: 0,
    stopped_early: false,
  };

  const { data: dbJobsRaw, error: selectErr } = await supabaseAdmin
    .from("jobs")
    .select("id, source, company, title, description, full_description, location, apply_url, ai_enrichment, ai_meta")
    .eq("source", source).eq("is_active", true).limit(200);
  if (selectErr) {
    result.error = selectErr.message;
    return result;
  }
  const dbJobs = (dbJobsRaw ?? []) as Array<Record<string, unknown>>;
  result.selected = dbJobs.length;

  // Eligibility:
  //   1. must have a title and a description (otherwise nothing to classify)
  //   2. either has never been enriched, OR the stored prompt version differs
  //      from the current PROMPT_VERSION (existing enrichment is stale).
  // Stored ai_meta is JSONB written by enrich-job.ts:makeMeta — keys are
  // camelCase (`promptVersion`) per JSON.stringify.
  let staleVersionCount = 0;
  const eligibleJobs = dbJobs.filter(j => {
    const description = j.full_description || j.description;
    if (!j.title || !description) return false;
    if (!j.ai_enrichment) return true;
    const aiMeta = j.ai_meta as { promptVersion?: string } | null | undefined;
    if (!aiMeta || aiMeta.promptVersion !== PROMPT_VERSION) {
      staleVersionCount++;
      return true;
    }
    return false;
  });
  result.eligible = eligibleJobs.length;
  if (staleVersionCount > 0) {
    console.log(`[ai_enrichment] source=${source} stale_version_count=${staleVersionCount} current_prompt_version=${PROMPT_VERSION}`);
  }
  console.log(`[ai_enrichment] source=${source} selected=${result.selected} eligible=${result.eligible}`);

  const enrichStart = Date.now();
  for (let batchIdx = 0; batchIdx < AI_MAX_BATCHES_PER_CALL; batchIdx++) {
    if (Date.now() - enrichStart > AI_MAX_RUNTIME_MS) {
      console.warn(`[ai_enrichment] source=${source} stopping early — time budget exceeded`);
      result.stopped_early = true;
      break;
    }
    const batch = eligibleJobs.slice(batchIdx * AI_BATCH_SIZE, (batchIdx + 1) * AI_BATCH_SIZE);
    if (batch.length === 0) break;

    result.batches_attempted++;
    result.total_sent += batch.length;

    const batchInput: JobInputForEnrichment[] = batch.map(j => {
      const description = j.full_description || j.description;
      return {
        id:          String(j.id ?? ""),
        company:     String(j.company ?? ""),
        title:       String(j.title ?? ""),
        description: String(description ?? ""),
        location:    String(j.location ?? ""),
        url:         String(j.apply_url ?? ""),
        source:      source,  // for ai_skip diagnostics in enrich-job.ts
      };
    });

    const t0 = Date.now();
    const { results: batchResults, stats } = await enrichBatch(batchInput);
    console.log(`[ai_enrichment] source=${source} batch=${batchIdx + 1} enrichBatch_ms=${Date.now() - t0} enriched=${stats.enriched} failed=${stats.failed}`);

    let batchPersisted = 0;
    let batchSkipped = 0;
    for (const [key, enriched] of batchResults) {
      if (!key || !enriched?.ai) {
        batchSkipped++; result.skipped++;
        continue;
      }
      const { error: updateErr } = await supabaseAdmin
        .from("jobs")
        .update({ ai_enrichment: enriched.ai, ai_meta: enriched.aiMeta ?? null })
        .eq("id", key);
      if (updateErr) {
        console.error(`[ai_enrichment] update failed id=${key} source=${source}`, JSON.stringify({ message: updateErr.message, code: updateErr.code }));
        batchSkipped++; result.skipped++;
      } else {
        batchPersisted++; result.persisted++;
      }
    }
    result.batches_completed++;
    console.log(`[ai_enrichment] source=${source} batch=${batchIdx + 1} persisted=${batchPersisted} skipped=${batchSkipped}`);
  }

  console.log(`[ai_enrichment] source=${source} eligible=${result.eligible} batches_attempted=${result.batches_attempted} batches_completed=${result.batches_completed} total_sent=${result.total_sent} persisted=${result.persisted} skipped=${result.skipped} stopped_early=${result.stopped_early}`);
  return result;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAiEnabled()) {
      return NextResponse.json(
        { ok: false, error: "AI enrichment disabled (set AI_ENABLED=true and OPENAI_API_KEY)" },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const sourceFilter =
      (body.source as string) ||
      url.searchParams.get("source") ||
      "";

    if (!sourceFilter) {
      return NextResponse.json(
        { ok: false, error: "source query/body param required (e.g. walmart_cxs, amazon_jobs)" },
        { status: 400 },
      );
    }
    if (!ENRICH_ELIGIBLE_SOURCES.has(sourceFilter)) {
      return NextResponse.json(
        { ok: false, error: `source="${sourceFilter}" is not configured for AI enrichment. Allowed: ${[...ENRICH_ELIGIBLE_SOURCES].join(", ")}` },
        { status: 400 },
      );
    }

    const startMs = Date.now();
    console.log(`[ai_enrichment] triggered source=${sourceFilter}`);
    const result = await enrichSource(sourceFilter);
    const durationMs = Date.now() - startMs;
    return NextResponse.json({ ok: true, duration_ms: durationMs, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai_enrichment] uncaught error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return POST(req); }

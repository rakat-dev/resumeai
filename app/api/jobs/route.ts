import { NextRequest, NextResponse } from "next/server";
import { getFortuneTier, getPriorityTier, formatPostedDate, computeJobScore } from "@/lib/jobUtils";
import type { QualityBucket } from "@/lib/jobUtils";
import { supabaseAdmin } from "@/lib/supabase";
import type { JobRow } from "@/lib/supabase";

export const maxDuration = 60;
// Bypass Next.js App Router fetch cache — Supabase JS client uses fetch()
// internally, and stale cached responses were hiding fresh DB writes from
// the GET handler. force-dynamic runs the handler fresh every request.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── Types ──────────────────────────────────────────────────────────────────
export type JobFilter = "24h" | "3d" | "7d" | "any";
export type SortOption = "date_desc" | "date_asc" | "company_desc" | "company_asc" | "best_match";

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  type: string;
  salary?: string;
  description: string;
  applyUrl: string;
  postedAt: string;
  postedDate: string;
  postedTimestamp: number;
  source: string;
  sourceType: "greenhouse" | "workday" | "jsearch" | "adzuna" | "jooble" | "phenom" | "meta" | "playwright" | "v2" | "other";
  skills: string[];
  sponsorshipTag: "mentioned" | "not_mentioned";
  experience?: string;
  priorityTier?: "highest" | "high" | "must_apply";
  fortuneRank?: number;
  relevanceScore?: number;
  bucket?: QualityBucket;
  positionRank?: number;   // 1..120 for jobs from no-date Tier A scrapers (Google etc.)
  fullDescription?: string; // full JD body — populated when available (Walmart etc.)
  // Subset of the AiMeta JSONB column surfaced for UI badge rendering.
  // Backed by the `ai_meta` column populated by app/api/jobs/enrich.
  aiMeta?: {
    status?: "success" | "skipped" | "failed" | "cached";
    confidence?: "low" | "normal";
    reason?: string;
  };
}

export interface SourceStatus {
  status: "healthy" | "degraded" | "broken" | "skipped" | "rate_limited";
  fetched: number;
  kept: number;
  error?: string;
}

export interface SourceDiagnostic {
  source: string;
  called: boolean;
  status: "success" | "degraded" | "error" | "skipped" | "timeout" | "rate_limited";
  rawCount: number;
  postFilterCount: number;
  error: string | null;
}

// ── Map DB row to Job ──────────────────────────────────────────────────────
function rowToJob(row: JobRow): Job {
  const ts = row.posted_at ? Math.floor(new Date(row.posted_at).getTime() / 1000) : 0;
  const rawSource = row.source as string;
  // v2 sources (direct API adapters that ship full_description + posted_at)
  // bucket together so the UI/scorer can treat them uniformly.
  const V2_SOURCES = new Set(["walmart_cxs", "amazon_jobs", "google_v2"]);
  const sourceType: Job["sourceType"] = V2_SOURCES.has(rawSource)
    ? "v2"
    : rawSource.startsWith("playwright")
      ? "playwright"
      : (rawSource as Job["sourceType"]) ?? "other";

  return {
    id:              row.id,
    title:           row.title,
    company:         row.company,
    location:        row.location,
    type:            row.employment_type ?? "Full-time",
    description:     row.description ?? "",
    applyUrl:        row.apply_url ?? "#",
    postedAt:        row.posted_at ?? "",
    postedDate:      ts ? formatPostedDate(ts) : "Recently",
    postedTimestamp: ts,
    source:          rawSource,
    sourceType,
    skills:          [],
    sponsorshipTag:  (row.sponsorship_status as Job["sponsorshipTag"]) ?? "not_mentioned",
    experience:      undefined,
    priorityTier:    getPriorityTier(row.company),
    fortuneRank:     getFortuneTier(row.company),
    positionRank:    row.position_rank ?? undefined,
    fullDescription: row.full_description ?? undefined,
    // Surface only the three fields the UI badge needs. Cast through
    // `unknown` because JobRow.ai_meta is typed as `unknown` (raw JSONB).
    aiMeta:          (row.ai_meta as Job["aiMeta"]) ?? undefined,
  };
}

// ── Scoring + bucket (spec 19) ─────────────────────────────────────────────
function scoreJob(job: Job): Job {
  const { score, bucket } = computeJobScore({
    title:           job.title,
    description:     job.description,
    postedTimestamp: job.postedTimestamp,
    sourceType:      job.sourceType,
    company:         job.company,
  });
  return { ...job, relevanceScore: score, bucket };
}

// ── Date cutoff — computed per-request, never at module level ──────────────
function getDateCutoff(filter: JobFilter): string | null {
  if (filter === "any") return null;
  const MS: Record<string, number> = {
    "24h": 86_400_000,
    "3d":  259_200_000,
    "7d":  604_800_000,
  };
  return new Date(Date.now() - (MS[filter] ?? 0)).toISOString();
}

// ── Sort ───────────────────────────────────────────────────────────────────
// company_desc = top Fortune-ranked companies first (rank 1=best, 9999=unknown)
// company_asc  = alphabetical A→Z by company name
function sortJobs(jobs: Job[], sort: SortOption): Job[] {
  return [...jobs].sort((a, b) => {
    switch (sort) {
      case "date_desc": return (b.postedTimestamp || 0) - (a.postedTimestamp || 0);
      case "date_asc":  return (a.postedTimestamp || 0) - (b.postedTimestamp || 0);
      case "company_desc": {
        // ra - rb: rank 1 (Amazon) sorts before rank 9999 (unknown) ✓
        const ra = getFortuneTier(a.company), rb = getFortuneTier(b.company);
        return ra !== rb ? ra - rb : (b.postedTimestamp || 0) - (a.postedTimestamp || 0);
      }
      case "company_asc": {
        // Alphabetical A → Z
        const cmp = a.company.toLowerCase().localeCompare(b.company.toLowerCase());
        return cmp !== 0 ? cmp : (b.postedTimestamp || 0) - (a.postedTimestamp || 0);
      }
      default: {
        // Best Match: score desc, then recency
        const sd = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        return sd !== 0 ? sd : (b.postedTimestamp || 0) - (a.postedTimestamp || 0);
      }
    }
  });
}

// ── Diversity caps (spec 18) ───────────────────────────────────────────────
function applyDiversityCaps(jobs: Job[]): Job[] {
  const sourceCounts  = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  const MAX_PER_SOURCE  = 1000; // raised from 500: priority-company fixes pushed greenhouse+workday past 500 each
  const MAX_PER_COMPANY = 120; // raised from 100 to match FULL_WORKFLOW_EXTENSION_CAP — Tier A scrapers in extension mode produce up to 120 fresh IC SWE rows when there's a backlog; cap at 100 was hiding ~20 jobs/company
  const COMPANY_CAP_OVERRIDES: Record<string, number> = { walmart: 200, amazon: 200 };
  return jobs.filter(j => {
    const sk = j.sourceType.startsWith("playwright") ? "playwright" : j.sourceType;
    const sc = sourceCounts.get(sk) ?? 0;
    const ck = j.company.toLowerCase();
    const cc = companyCounts.get(ck) ?? 0;
    const companyCapLimit = COMPANY_CAP_OVERRIDES[ck] ?? MAX_PER_COMPANY;
    if (sc >= MAX_PER_SOURCE || cc >= companyCapLimit) return false;
    sourceCounts.set(sk, sc + 1);
    companyCounts.set(ck, cc + 1);
    return true;
  });
}

// ── Main Handler ───────────────────────────────────────────────────────────
// Queries Supabase (service role to bypass RLS). No live source calls.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filter   = (searchParams.get("filter") as JobFilter) || "any";
  const sort     = (searchParams.get("sort")   as SortOption) || "company_desc";
  const page     = 1;
  const pageSize = 3000; // return all, UI handles scrolling (raised from 2000 to accommodate priority-company expansion)

  try {
    // Paginate past PostgREST's 1000-row default cap.
    // With ~1300+ active jobs in DB, a single .limit(5000) call still returns
    // only 1000 rows because PostgREST enforces max-rows server-side. Loop
    // with .range(offset, offset+PAGE-1) until we get a short page.
    const PAGE_SIZE = 1000;
    const MAX_ROWS  = 5000; // hard ceiling to protect memory/latency
    const rows: JobRow[] = [];
    const cutoff = getDateCutoff(filter);
    let offset = 0;

    while (rows.length < MAX_ROWS) {
      let q = supabaseAdmin
        .from("jobs")
        .select("*")
        .eq("is_active", true)
        .order("posted_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (cutoff) q = q.gte("posted_at", cutoff);

      const { data, error } = await q;
      if (error) {
        console.error("[/api/jobs] Supabase error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const page = (data ?? []) as JobRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break; // short page = no more rows
      offset += PAGE_SIZE;
    }

    // Diagnostic: count adzuna rows + batch-2 companies to verify pagination landed
    const adzCount = rows.filter(r => r.source === 'adzuna').length;
    const batch2Companies = ['IBM', 'Cigna Group', 'The Cigna Group', 'UnitedHealth Group', 'ServiceNow', 'UPS', 'Snowflake', 'Visa', 'Mastercard', 'Accenture', 'Cognizant', 'Capgemini', 'Maximus'];
    const batch2Count = rows.filter(r => batch2Companies.includes(r.company)).length;
    console.log(`[/api/jobs] rows=${rows.length} adzuna=${adzCount} batch2=${batch2Count} filter=${filter} sort=${sort}`);

    // Map -> score -> sort -> diversity cap -> paginate
    const jobs      = rows.map(rowToJob);
    const scored    = jobs.map(scoreJob);
    const sorted    = sortJobs(scored, sort);
    const capped    = applyDiversityCaps(sorted);
    const total     = capped.length;
    const paginated = capped.slice((page - 1) * pageSize, page * pageSize);

    // Source breakdown + diagnostics (spec 20)
    const sourceCountMap = new Map<string, number>();
    capped.forEach(j => {
      const key = j.sourceType.startsWith("playwright") ? "playwright" : j.sourceType;
      sourceCountMap.set(key, (sourceCountMap.get(key) ?? 0) + 1);
    });

    const SOURCE_KEYS = ["greenhouse", "workday", "playwright", "jsearch", "adzuna", "jooble", "phenom", "meta"];
    const sources: Record<string, number> = {};
    SOURCE_KEYS.forEach(k => { sources[k] = sourceCountMap.get(k) ?? 0; });

    // Quality bucket counts (spec 19)
    const buckets = { hot: 0, strong: 0, possible: 0 };
    capped.forEach(j => {
      const b = (j.bucket ?? "possible") as keyof typeof buckets;
      buckets[b] = (buckets[b] ?? 0) + 1;
    });

    const sourceDiagnostics: SourceDiagnostic[] = SOURCE_KEYS.map(k => ({
      source:          k,
      called:          (sourceCountMap.get(k) ?? 0) > 0,
      status:          (sourceCountMap.get(k) ?? 0) > 0 ? "success" as const : "skipped" as const,
      rawCount:        sourceCountMap.get(k) ?? 0,
      postFilterCount: sources[k],
      error:           null,
    }));

    return NextResponse.json({
      jobs:            paginated,
      count:           paginated.length,
      total,
      page,
      pageSize,
      totalPages:      Math.ceil(total / pageSize),
      sources,
      sourceDiagnostics,
      buckets,
      storageMode:     "db",
      message:         total === 0
        ? "No jobs in DB yet. Trigger a refresh via POST /api/jobs/refresh."
        : undefined,
    });

  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

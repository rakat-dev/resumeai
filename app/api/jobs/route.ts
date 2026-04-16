import { NextRequest, NextResponse } from "next/server";
import { getFortuneTier, getPriorityTier, formatPostedDate, computeJobScore } from "@/lib/jobUtils";
import type { QualityBucket } from "@/lib/jobUtils";
import { supabaseAdmin } from "@/lib/supabase";
import type { JobRow } from "@/lib/supabase";

export const maxDuration = 60;

// ── Types ──────────────────────────────────────────────────────────────────
export type JobFilter = "24h" | "3d" | "7d" | "any";
export type SortOption = "date_desc" | "date_asc" | "company_desc" | "company_asc";

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
  sourceType: "greenhouse" | "workday" | "jsearch" | "adzuna" | "jooble" | "playwright" | "other";
  skills: string[];
  sponsorshipTag: "mentioned" | "not_mentioned";
  experience?: string;
  priorityTier?: "highest" | "high" | "must_apply";
  fortuneRank?: number;
  relevanceScore?: number;
  bucket?: QualityBucket;
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
  const sourceType: Job["sourceType"] = rawSource.startsWith("playwright")
    ? "playwright"
    : (rawSource as Job["sourceType"]) ?? "other";

  return {
    id:              row.id,
    title:           row.title,
    company:         row.company,
    location:        row.location,
    type:            row.employment_type ?? "Full-time",
    description:     row.description ?? "",
    applyUrl:        row.apply_url,
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
  const MAX_PER_SOURCE  = 500; // raised from 100: was hiding ~309 valid jobs (greenhouse 275→100, playwright 147→100)
  const MAX_PER_COMPANY = 60;  // raised from 30
  return jobs.filter(j => {
    const sk = j.sourceType.startsWith("playwright") ? "playwright" : j.sourceType;
    const sc = sourceCounts.get(sk) ?? 0;
    const cc = companyCounts.get(j.company.toLowerCase()) ?? 0;
    if (sc >= MAX_PER_SOURCE || cc >= MAX_PER_COMPANY) return false;
    sourceCounts.set(sk, sc + 1);
    companyCounts.set(j.company.toLowerCase(), cc + 1);
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
  const pageSize = 2000; // return all, UI handles scrolling

  try {
    // Build query — use service role key to bypass RLS
    let query = supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("is_active", true)
      .order("posted_at", { ascending: false })
      .limit(2000);

    const cutoff = getDateCutoff(filter);
    if (cutoff) query = query.gte("posted_at", cutoff);

    const { data, error } = await query;

    if (error) {
      console.error("[/api/jobs] Supabase error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as JobRow[];
    console.log(`[/api/jobs] rows=${rows.length} filter=${filter} sort=${sort}`);

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

    const SOURCE_KEYS = ["greenhouse", "workday", "playwright", "jsearch", "adzuna", "jooble"];
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

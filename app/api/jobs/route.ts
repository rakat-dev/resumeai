import { NextRequest, NextResponse } from "next/server";
import {
  scoreSponsorshipSignal, scoreTitleRelevance, scoreRecency,
} from "@/lib/queryExpansion";
import { getFortuneTier, getPriorityTier, formatPostedDate } from "@/lib/jobUtils";
import { supabase } from "@/lib/supabase";
import type { JobRow } from "@/lib/supabase";

export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────
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

// ── Map DB row → Job ───────────────────────────────────────────────────────
function rowToJob(row: JobRow): Job {
  const ts = row.posted_at ? Math.floor(new Date(row.posted_at).getTime() / 1000) : 0;
  const sourceType = (row.source as Job["sourceType"]) ?? "other";
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
    source:          row.source,
    sourceType,
    skills:          [],   // not stored in DB; computed at ingest time if needed
    sponsorshipTag:  (row.sponsorship_status as Job["sponsorshipTag"]) ?? "not_mentioned",
    experience:      undefined,
    priorityTier:    getPriorityTier(row.company),
    fortuneRank:     getFortuneTier(row.company),
  };
}

// ── Date filter cutoff ─────────────────────────────────────────────────────
const DATE_CUTOFF: Record<JobFilter, string | null> = {
  "24h": new Date(Date.now() - 86_400_000).toISOString(),
  "3d":  new Date(Date.now() - 259_200_000).toISOString(),
  "7d":  new Date(Date.now() - 604_800_000).toISOString(),
  "any": null,
};

// ── Scoring ────────────────────────────────────────────────────────────────
function computeRelevanceScore(job: Job): number {
  let score = 0;
  score += scoreTitleRelevance(job.title) * 3;
  score += scoreSponsorshipSignal(job.description);
  score += scoreRecency(job.postedTimestamp);
  const tier = job.priorityTier;
  if (tier === "highest")    score += 5;
  else if (tier === "high")  score += 3;
  else if (tier === "must_apply") score += 2;
  if (job.sourceType === "greenhouse" || job.sourceType === "workday") score += 3;
  else if (job.sourceType === "jsearch" || job.sourceType === "adzuna") score += 1;
  return score;
}

// ── Sort (client-side after DB fetch) ─────────────────────────────────────
function sortJobs(jobs: Job[], sort: SortOption): Job[] {
  return [...jobs].sort((a, b) => {
    switch (sort) {
      case "date_desc": return (b.postedTimestamp || 0) - (a.postedTimestamp || 0);
      case "date_asc":  return (a.postedTimestamp || 0) - (b.postedTimestamp || 0);
      case "company_desc": {
        const ra = getFortuneTier(a.company), rb = getFortuneTier(b.company);
        return ra !== rb ? ra - rb : (b.postedTimestamp || 0) - (a.postedTimestamp || 0);
      }
      case "company_asc": {
        const ra = getFortuneTier(a.company), rb = getFortuneTier(b.company);
        return ra !== rb ? rb - ra : (a.postedTimestamp || 0) - (b.postedTimestamp || 0);
      }
      default: return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    }
  });
}

function applyDiversityCaps(jobs: Job[]): Job[] {
  const sourceCounts  = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  const MAX_PER_SOURCE  = 100;
  const MAX_PER_COMPANY = 30;
  return jobs.filter(j => {
    const sc = sourceCounts.get(j.sourceType)  ?? 0;
    const cc = companyCounts.get(j.company.toLowerCase()) ?? 0;
    if (sc >= MAX_PER_SOURCE || cc >= MAX_PER_COMPANY) return false;
    sourceCounts.set(j.sourceType, sc + 1);
    companyCounts.set(j.company.toLowerCase(), cc + 1);
    return true;
  });
}

// ── Main Handler ───────────────────────────────────────────────────────────
// Queries stored jobs from Supabase only. No live source calls.
// Jobs are ingested via POST /api/jobs/refresh.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filter   = (searchParams.get("filter") as JobFilter) || "any";
  const sort     = (searchParams.get("sort")   as SortOption) || "company_desc";
  const page     = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const pageSize = 25;

  try {
    // ── Build Supabase query ─────────────────────────────────────────────
    let query = supabase
      .from("jobs")
      .select("*")
      .eq("is_active", true)
      .order("posted_at", { ascending: false })
      .limit(2000);   // fetch broad set, sort/cap client-side

    const cutoff = DATE_CUTOFF[filter];
    if (cutoff) {
      query = query.gte("posted_at", cutoff);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[/api/jobs] Supabase error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as JobRow[];

    // ── Map → score → sort → cap → paginate ──────────────────────────────
    const jobs   = rows.map(rowToJob);
    const scored = jobs.map(j => ({ ...j, relevanceScore: computeRelevanceScore(j) }));
    const sorted = sortJobs(scored, sort);
    const capped = applyDiversityCaps(sorted);
    const total  = capped.length;
    const paginated = capped.slice((page - 1) * pageSize, page * pageSize);

    // ── Source breakdown ──────────────────────────────────────────────────
    const sources: Record<string, number> = {
      greenhouse: 0, workday: 0, playwright: 0,
      jsearch: 0, adzuna: 0, jooble: 0,
    };
    capped.forEach(j => {
      const k = j.sourceType in sources ? j.sourceType : "other";
      sources[k] = (sources[k] ?? 0) + 1;
    });

    const sourceDiagnostics: SourceDiagnostic[] = Object.entries(sources).map(([k, v]) => ({
      source:           k,
      called:           false,
      status:           v > 0 ? "success" : "skipped",
      rawCount:         v,
      postFilterCount:  v,
      error:            null,
    }));

    return NextResponse.json({
      jobs:             paginated,
      count:            paginated.length,
      total,
      page,
      pageSize,
      totalPages:       Math.ceil(total / pageSize),
      sources,
      sourceDiagnostics,
      storageMode:      "db",
      message:          total === 0
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

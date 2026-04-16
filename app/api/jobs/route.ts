import { NextRequest, NextResponse } from "next/server";
import {
  scoreSponsorshipSignal, scoreTitleRelevance, scoreRecency,
} from "@/lib/queryExpansion";
import { getFortuneTier, getPriorityTier } from "@/lib/jobUtils";

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

// ── Scoring ────────────────────────────────────────────────────────────────
function computeRelevanceScore(job: Job): number {
  let score = 0;
  score += scoreTitleRelevance(job.title) * 3;
  score += scoreSponsorshipSignal(job.description);
  score += scoreRecency(job.postedTimestamp);
  const tier = job.priorityTier;
  if (tier === "highest") score += 5;
  else if (tier === "high") score += 3;
  else if (tier === "must_apply") score += 2;
  if (job.sourceType === "greenhouse" || job.sourceType === "workday") score += 3;
  else if (job.sourceType === "jsearch" || job.sourceType === "adzuna") score += 1;
  return score;
}

// ── Dedup ──────────────────────────────────────────────────────────────────
function deduplicateJobs(jobs: Job[]): Job[] {
  const seenIds = new Set<string>();
  const seenKey = new Set<string>();
  return jobs.filter(job => {
    const key = `${job.title.toLowerCase().trim()}|||${job.company.toLowerCase().trim()}`;
    if (seenIds.has(job.id) || seenKey.has(key)) return false;
    seenIds.add(job.id);
    seenKey.add(key);
    return true;
  });
}

// ── Sort ───────────────────────────────────────────────────────────────────
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

function applyPerCompanyCap(jobs: Job[], cap = 30): Job[] {
  const counts = new Map<string, number>();
  return jobs.filter(j => {
    const co = j.company.toLowerCase().trim();
    const n = counts.get(co) || 0;
    if (n >= cap) return false;
    counts.set(co, n + 1);
    return true;
  });
}

// ── Main Handler ───────────────────────────────────────────────────────────
// Queries stored jobs from DB only. No live source calls here.
// Jobs are ingested via POST /api/jobs/refresh.
// DB (Supabase) is wired in Step 4.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sort     = (searchParams.get("sort") as SortOption) || "company_desc";
  const page     = parseInt(searchParams.get("page") || "1");
  const pageSize = 25;

  // TODO (Step 4): Replace stub with real Supabase query
  const jobs: Job[] = [];

  const scored   = jobs.map(j => ({ ...j, relevanceScore: computeRelevanceScore(j) }));
  const unique   = deduplicateJobs(scored);
  const capped   = applyPerCompanyCap(unique);
  const sorted   = sortJobs(capped, sort);
  const total    = sorted.length;
  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  const sources: Record<string, number> = {
    greenhouse: 0, workday: 0, playwright: 0,
    jsearch: 0, adzuna: 0, jooble: 0,
  };
  paginated.forEach(j => {
    if (j.sourceType in sources) sources[j.sourceType]++;
  });

  const sourceDiagnostics: SourceDiagnostic[] = Object.keys(sources).map(k => ({
    source: k,
    called: false,
    status: "skipped" as const,
    rawCount: 0,
    postFilterCount: sources[k],
    error: "DB not yet wired — run POST /api/jobs/refresh to ingest jobs",
  }));

  return NextResponse.json({
    jobs: paginated,
    count: paginated.length,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    sources,
    sourceDiagnostics,
    storageMode: "db",
    message: total === 0
      ? "No jobs in DB yet. Trigger a refresh via POST /api/jobs/refresh."
      : undefined,
  });
}

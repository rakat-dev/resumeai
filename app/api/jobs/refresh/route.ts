import { NextRequest, NextResponse } from "next/server";
import { expandQuery } from "@/lib/queryExpansion";
import {
  REFRESH_STATE, REFRESH_HISTORY, REFRESH_HISTORY_MAX,
  type RefreshState,
} from "@/app/api/jobs/refresh-store";

// ── /api/jobs/refresh ─────────────────────────────────────────────────────
// Called by Vercel Cron every 15 minutes.
// Scrapes all Tier B Firecrawl companies for a standard query set and
// populates FC_COMPANY_CACHE + REFRESH_STATE so live searches find warm data.
//
// Also callable manually:
//   GET  /api/jobs/refresh            → refresh all Tier B companies
//   GET  /api/jobs/refresh?company=Google  → refresh one specific company
//   GET  /api/jobs/refresh?tier=a     → refresh Tier A instead
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300; // Vercel Pro allows 5 min for cron routes

// Standard query set used by the cron refresh.
// Covers the most common searches Rahul makes.
const CRON_QUERIES = [
  "software engineer",
  "full stack engineer",
  "backend engineer",
];

const CRON_FILTER = "any"; // refresh "any" date filter — most inclusive

// ── Inline copies of Firecrawl structures (avoid circular imports) ─────────
// We duplicate just what we need here rather than importing from route.ts,
// which would pull in the entire pipeline and risk circular dependency issues.

interface FirecrawlTarget {
  company: string;
  careerUrl: string;
  fortuneRank: number;
}

const FC_TIER_A: FirecrawlTarget[] = [
  { company: "Microsoft",     careerUrl: "https://careers.microsoft.com/us/en/search-results?keywords={query}&country=United%20States", fortuneRank: 5  },
  { company: "Apple",         careerUrl: "https://jobs.apple.com/en-us/search?search={query}&sort=newest&location=united-states-USA",    fortuneRank: 3  },
  { company: "JPMorgan Chase",careerUrl: "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword={query}&location=United+States", fortuneRank: 12 },
];

const FC_TIER_B: FirecrawlTarget[] = [
  { company: "Google",         careerUrl: "https://careers.google.com/jobs/results/?q={query}&location=United%20States",                 fortuneRank: 35 },
  { company: "Meta",           careerUrl: "https://www.metacareers.com/jobs?q={query}&offices[0]=United%20States",                        fortuneRank: 14 },
  { company: "IBM",            careerUrl: "https://www.ibm.com/us-en/employment/newhire/jobs/index.html?q={query}&country=US",            fortuneRank: 22 },
  { company: "Oracle",         careerUrl: "https://careers.oracle.com/en/sites/jobsearch/jobs?keyword={query}&location=United+States",   fortuneRank: 25 },
  { company: "Cisco",          careerUrl: "https://jobs.cisco.com/jobs/SearchJobs/{query}?21178=%5B169482%5D&21178_format=6020&listtype=proximity", fortuneRank: 24 },
  { company: "Salesforce",     careerUrl: "https://careers.salesforce.com/en/jobs/?search={query}&region=North+America",                 fortuneRank: 26 },
  { company: "Goldman Sachs",  careerUrl: "https://www.goldmansachs.com/careers/exploring-careers/students/jobs-search/?region=AMER&q={query}", fortuneRank: 53 },
  { company: "Morgan Stanley", careerUrl: "https://www.morganstanley.com/people-opportunities/students-graduates/programs/search/results?q={query}", fortuneRank: 21 },
];

const FC_TIMEOUT_MS = 25000; // 25s per company

// ── Shared company cache (same reference as route.ts uses) ────────────────
// Imported via refresh-store is not enough — we need the actual cache Map.
// We re-declare it as a module-level singleton here. Because Next.js bundles
// both this file and route.ts into the same serverless function for the
// /api/jobs/** route group, they share the same module instance.
// If they end up in different functions (unlikely), the cron still works —
// it just warms its own instance's cache, which serves the next request.
interface FcCompanyCacheEntry { jobs: unknown[]; raw: number; ts: number; filter: string; }
// We import the real cache from route.ts indirectly through a shared key:
// store results in REFRESH_STATE (which IS the shared Map from refresh-store),
// and route.ts reads FC_COMPANY_CACHE. To bridge this, we write to both.
// The FC_COMPANY_CACHE is declared in route.ts — we can't import it directly
// without a circular dep. Instead we expose a setter via refresh-store.
import { setCompanyCache } from "@/app/api/jobs/refresh-store";

// ── Per-company scraper ────────────────────────────────────────────────────
async function scrapeCompany(
  target: FirecrawlTarget,
  query: string,
  filter: string,
  apiKey: string,
  source: RefreshState["source"]
): Promise<{ jobs: unknown[]; raw: number; error: string | null }> {
  const expansion = expandQuery(query);
  const url = target.careerUrl.replace("{query}", encodeURIComponent(expansion.primary));

  // Mark running in shared state
  const startedAt = Date.now();
  const existing = REFRESH_STATE.get(target.company);
  REFRESH_STATE.set(target.company, {
    company:         target.company,
    source,
    status:          "running",
    query:           expansion.primary,
    filter,
    started_at:      startedAt,
    finished_at:     existing?.finished_at ?? null,
    duration_ms:     existing?.duration_ms ?? null,
    raw_count:       existing?.raw_count ?? null,
    kept_count:      existing?.kept_count ?? null,
    error_message:   null,
    last_success_at: existing?.last_success_at ?? null,
    last_attempt_at: startedAt,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FC_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["extract"],
        extract: {
          schema: {
            type: "object",
            properties: {
              jobs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title:          { type: "string" },
                    location:       { type: "string" },
                    url:            { type: "string" },
                    postedDate:     { type: "string" },
                    description:    { type: "string" },
                    employmentType: { type: "string" },
                  },
                },
              },
            },
          },
          prompt: "Extract all software engineering job listings. For each: title, location, apply URL, posted date, brief description, employment type.",
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!res.ok) {
      const err = `HTTP ${res.status}`;
      updateState(target.company, source, expansion.primary, filter, startedAt, 0, 0, err);
      return { jobs: [], raw: 0, error: err };
    }

    const data = await res.json();
    const rawJobs = (data?.data?.extract?.jobs || data?.extract?.jobs || []) as unknown[];
    const finishedAt = Date.now();

    // Store in shared company cache via setter
    setCompanyCache(`${target.company}:${expansion.primary}:${filter}`, {
      jobs: rawJobs,
      raw:  rawJobs.length,
      ts:   finishedAt,
      filter,
    });

    updateState(target.company, source, expansion.primary, filter, startedAt, rawJobs.length, rawJobs.length, null);
    console.log(`[refresh] ${target.company}: ${rawJobs.length} raw`);
    return { jobs: rawJobs, raw: rawJobs.length, error: null };
  } catch (e: unknown) {
    clearTimeout(timer);
    const isAbort = e instanceof Error && e.name === "AbortError";
    const msg = isAbort ? `timeout (${FC_TIMEOUT_MS}ms)` : String(e);
    updateState(target.company, source, expansion.primary, filter, startedAt, 0, 0, msg);
    console.error(`[refresh] ${target.company} FAILED: ${msg}`);
    return { jobs: [], raw: 0, error: msg };
  }
}

function updateState(
  company: string,
  source: RefreshState["source"],
  query: string,
  filter: string,
  startedAt: number,
  raw: number,
  kept: number,
  error: string | null
): void {
  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  const isTimeout  = error?.includes("timeout") ?? false;
  type RS = RefreshState["status"];
  const status: RS =
    error && isTimeout   ? "timeout" :
    error                ? "failed"  :
    kept > 0             ? "success" :
    raw > 0              ? "partial_success" : "failed";

  const prev = REFRESH_STATE.get(company);
  REFRESH_STATE.set(company, {
    company, source, status, query, filter,
    started_at:      startedAt,
    finished_at:     finishedAt,
    duration_ms:     durationMs,
    raw_count:       raw,
    kept_count:      kept,
    error_message:   error,
    last_success_at: (status === "success" || status === "partial_success") ? finishedAt : (prev?.last_success_at ?? null),
    last_attempt_at: startedAt,
  });

  // Append to history
  REFRESH_HISTORY.push({
    run_id:        `${company}-${startedAt}`,
    company, source, status, query, filter,
    started_at:    startedAt,
    finished_at:   finishedAt,
    duration_ms:   durationMs,
    raw_count:     raw,
    kept_count:    kept,
    error_message: error,
  });
  if (REFRESH_HISTORY.length > REFRESH_HISTORY_MAX) {
    REFRESH_HISTORY.splice(0, REFRESH_HISTORY.length - REFRESH_HISTORY_MAX);
  }
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FIRECRAWL_API_KEY not set" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const companyFilter = searchParams.get("company"); // refresh a single company
  const tierFilter    = searchParams.get("tier");    // "a" or "b" (default: "b")
  const queryOverride = searchParams.get("q");       // override default query set

  const queries = queryOverride ? [queryOverride] : CRON_QUERIES;
  const targets = tierFilter === "a" ? FC_TIER_A
                : tierFilter === "b" ? FC_TIER_B
                : FC_TIER_B; // default: Tier B

  const filteredTargets = companyFilter
    ? [...FC_TIER_A, ...FC_TIER_B].filter(t =>
        t.company.toLowerCase().includes(companyFilter.toLowerCase())
      )
    : targets;

  if (filteredTargets.length === 0) {
    return NextResponse.json({
      error: `No company matching "${companyFilter}"`,
      available: [...FC_TIER_A, ...FC_TIER_B].map(t => t.company),
    }, { status: 404 });
  }

  const source: RefreshState["source"] =
    tierFilter === "a" ? "firecrawl_tier_a" : "firecrawl_tier_b";

  console.log(`[refresh] Starting: ${filteredTargets.map(t => t.company).join(", ")} | queries: ${queries.join(", ")}`);
  const refreshStart = Date.now();

  // Mark all as queued upfront
  for (const t of filteredTargets) {
    for (const q of queries) {
      const exp = expandQuery(q);
      const prev = REFRESH_STATE.get(t.company);
      if (!prev || prev.status !== "running") {
        REFRESH_STATE.set(t.company, {
          company:         t.company,
          source,
          status:          "queued",
          query:           exp.primary,
          filter:          CRON_FILTER,
          started_at:      null,
          finished_at:     prev?.finished_at ?? null,
          duration_ms:     prev?.duration_ms ?? null,
          raw_count:       prev?.raw_count ?? null,
          kept_count:      prev?.kept_count ?? null,
          error_message:   null,
          last_success_at: prev?.last_success_at ?? null,
          last_attempt_at: prev?.last_attempt_at ?? null,
        });
      }
    }
  }

  // Run companies 2 at a time (concurrency=2) across all queries
  const results: Array<{
    company: string; query: string; raw: number; error: string | null; duration_ms: number;
  }> = [];

  for (const query of queries) {
    for (let i = 0; i < filteredTargets.length; i += 2) {
      const chunk = filteredTargets.slice(i, i + 2);
      const chunkStart = Date.now();
      console.log(`[refresh] batch: [${chunk.map(t => t.company).join(", ")}] query="${query}"`);

      const settled = await Promise.allSettled(
        chunk.map(t => scrapeCompany(t, query, CRON_FILTER, apiKey, source))
      );

      settled.forEach((r, j) => {
        const t = chunk[j];
        const val = r.status === "fulfilled" ? r.value : { raw: 0, error: "promise rejected" };
        results.push({
          company:     t.company,
          query,
          raw:         val.raw,
          error:       val.error,
          duration_ms: Date.now() - chunkStart,
        });
      });
    }
  }

  const totalMs = Date.now() - refreshStart;
  const succeeded = results.filter(r => !r.error).length;
  const failed    = results.filter(r => !!r.error).length;
  const totalRaw  = results.reduce((a, r) => a + r.raw, 0);

  console.log(`[refresh] Complete: ${succeeded} ok / ${failed} failed | ${totalRaw} raw | ${totalMs}ms`);

  return NextResponse.json({
    ok:          true,
    duration_ms: totalMs,
    summary: {
      companies_refreshed: filteredTargets.length,
      queries_run:         queries.length,
      total_runs:          results.length,
      succeeded,
      failed,
      total_raw:           totalRaw,
    },
    results,
  });
}

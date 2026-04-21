import { NextRequest, NextResponse } from "next/server";
import { persistState, persistRun } from "@/app/api/jobs/refresh-store";
import type { RefreshState, RefreshSource } from "@/app/api/jobs/types";
import { supabaseAdmin } from "@/lib/supabase";
import {
  cleanDescription, classifySponsorship, isUSLocation,
  isRelevantTitleEarly, isWithinEarlyHorizon, EARLY_HORIZON_DAYS_PARTIAL,
  normalizeCompany, shouldIncludeTitle, isBlockedCompany,
} from "@/lib/jobUtils";
import {
  fetchMicrosoftJobs, fetchGoogleJobs, fetchAppleJobs,
  fetchAmazonJobsV2, fetchJPMJobs,
  fetchGoldmanSachsJobs, fetchOpenAIJobs, fetchNetflixJobs,
  fetchWalmartJobs,
  type ScrapedJob,
} from "@/lib/playwrightScrapers";
import { getWorkdayConfigs, getGreenhouseSlugs, isPhenomOnly, isMetaDirect } from "@/lib/companyAtsRegistry";
import { fetchAllPhenomTenants } from "@/lib/scrapers/phenom";
import { fetchMetaSitemapJobs } from "@/lib/scrapers/meta";
import { enrichBatch } from "@/lib/ai/enrich-batch";
import { isAiEnabled } from "@/lib/ai/enrich-job";
import type { JobInputForEnrichment } from "@/lib/ai/enrich-job";

export const maxDuration = 60;

// ── Source health classification (A) ──────────────────────────────────────
type SourceHealth =
  | "success"
  | "partial_success"
  | "empty_but_ok"
  | "rate_limited"
  | "unauthorized"
  | "unsupported_tenant"
  | "bad_request"
  | "timeout"
  | "failed_unknown"
  | "disabled";

function classifyHealth(stored: number, fetched: number, error: string | null): SourceHealth {
  if (error) {
    if (error.includes("rate_limited"))            return "rate_limited";
    if (error.includes("unauthorized") || error.includes("401")) return "unauthorized";
    if (error.includes("422") || error.includes("unsupported_tenant")) return "unsupported_tenant";
    if (error.includes("bad_request") || error.includes("400"))       return "bad_request";
    if (error.includes("timeout"))                 return "timeout";
    if (error.includes("disabled"))                return "disabled";
    return "failed_unknown";
  }
  if (stored === 0)              return "empty_but_ok";
  if (fetched > stored)         return "partial_success";
  return "success";
}

function logSourceSummary(source: string, opts: {
  durationMs: number;
  fetched: number;
  stored: number;
  health: SourceHealth;
  reason?: string;
}): void {
  const { durationMs, fetched, stored, health, reason } = opts;
  const reasonStr = reason ? ` reason="${reason}"` : "";
  console.log(
    `[refresh:summary] source=${source} status=${health} duration=${durationMs}ms fetched=${fetched} stored=${stored}${reasonStr}`
  );
}

// ── Types ──────────────────────────────────────────────────────────────────
interface RawJob {
  id:          string;
  source:      RefreshSource;
  company:     string;
  title:       string;
  location:    string;
  description: string;
  applyUrl:    string;
  postedAt:    string | null;
  type:        string;
  positionRank?: number;  // preserved through pipeline for no-date Tier A scrapers
}

interface NormalizedJob {
  id:                  string;
  source:              string;
  company:             string;
  title:               string;
  location:            string;
  country:             string;
  employment_type:     string;
  posted_at:           string | null;
  description:         string;
  apply_url:           string;
  title_family:        string | null;
  sponsorship_status:  string;
  sponsorship_signals: unknown;
  fetched_at:          string;
  is_active:           boolean;
  position_rank:       number | null;   // 1..120 for no-date Tier A scrapers; NULL otherwise
  full_description:    string | null;   // full cleaned JD (no truncation)
}

// ── Title filter ──────────────────────────────────────────────────────────
// Strict shouldIncludeTitle now lives in lib/jobUtils.ts so it can be shared
// with the Tier A playwright scrapers (otherwise the 80-job per-company cap
// gets wasted on titles the ingest pipeline drops downstream).
// All keyword arrays (INCLUDE_KEYWORDS, INCLUDE_TECH_WORDS, EXCLUDE_SUBSTRINGS,
// EXCLUDE_WHOLE_WORDS) are now defined and exported there too.

function isFullTime(type: string, desc: string): boolean {
  return !/\bcontract(or)?\b|\bpart.?time\b|\bintern(ship)?\b|\bfreelance\b|\btemporary\b|\btemp\b/
    .test((type + " " + desc.slice(0, 300)).toLowerCase());
}

function requiresSecurityClearance(title: string, desc: string): boolean {
  return /\b(security\s+clearance|secret\s+clearance|top\s+secret|ts\/sci|clearance\s+required|dod\s+clearance|polygraph)\b/
    .test((title + " " + desc).toLowerCase());
}

// ── Date parsing ───────────────────────────────────────────────────────────
function parsePostedAt(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(raw).toISOString();
  const now = Date.now();
  const hM = raw.match(/(\d+)\s+hour/i);
  const dM = raw.match(/(\d+)\s+day/i);
  const wM = raw.match(/(\d+)\s+week/i);
  const mM = raw.match(/(\d+)\s+month/i);
  if (/today|just now/i.test(raw)) return new Date(now).toISOString();
  if (hM) return new Date(now - +hM[1] * 3_600_000).toISOString();
  if (dM) return new Date(now - +dM[1] * 86_400_000).toISOString();
  if (wM) return new Date(now - +wM[1] * 604_800_000).toISOString();
  if (mM) return new Date(now - +mM[1] * 2_592_000_000).toISOString();
  const p = new Date(raw);
  return isNaN(p.getTime()) ? null : p.toISOString();
}

const MAX_INGEST_DAYS  = 30;
const INGEST_CUTOFF_MS = MAX_INGEST_DAYS * 86_400_000;

function isWithinIngestHorizon(iso: string | null): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() <= INGEST_CUTOFF_MS;
}

// ── Normalize ──────────────────────────────────────────────────────────────
function normalizeJobs(raw: RawJob[]): NormalizedJob[] {
  const now = new Date().toISOString();
  const results: NormalizedJob[] = [];
  for (const r of raw) {
    // Clean HTML/entities BEFORE sponsorship check — raw description may be HTML
    const cleanJD = cleanDescription(r.description);
    const sponsorStatus = classifySponsorship(cleanJD);

    // DROP jobs that explicitly say no sponsorship — never store or show them
    if (sponsorStatus === "not_supported") continue;

    results.push({
      id:                  r.id,
      source:              r.source,
      company:             normalizeCompany(r.company),
      title:               r.title.trim(),
      location:            r.location || "United States",
      country:             "US",
      employment_type:     r.type || "Full-time",
      posted_at:           parsePostedAt(r.postedAt),
      // description = short preview for card display only (220 chars)
      // full_description = complete JD used by Tailor & Apply + JD modal
      description:         cleanJD.slice(0, 220),
      full_description:    cleanJD,
      apply_url:           r.applyUrl,
      title_family:        null,
      sponsorship_status:  sponsorStatus === "supported" ? "mentioned" : "not_mentioned",
      sponsorship_signals: null,
      fetched_at:          now,
      is_active:           true,
      position_rank:       r.positionRank ?? null,
    });
  }
  return results;
}

// ── Filter with per-filter counts ──────────────────────────────────────────
interface FilterStats {
  input: number; title_removed: number; type_removed: number;
  location_removed: number; clearance_removed: number; horizon_removed: number;
  company_blocked: number; output: number;
}

function filterJobsWithStats(jobs: NormalizedJob[]): { filtered: NormalizedJob[]; stats: FilterStats } {
  let title_removed = 0, type_removed = 0, location_removed = 0, clearance_removed = 0, horizon_removed = 0;
  const filtered = jobs.filter(j => {
    if (!shouldIncludeTitle(j.title))                       { title_removed++;    return false; }
    if (!isFullTime(j.employment_type, j.description))     { type_removed++;     return false; }
    if (!isUSLocation(j.location))                         { location_removed++; return false; }
    if (requiresSecurityClearance(j.title, j.description)) { clearance_removed++;return false; }
    if (!isWithinIngestHorizon(j.posted_at))               { horizon_removed++;  return false; }
    return true;
  });
  return { filtered, stats: { input: jobs.length, title_removed, type_removed,
    location_removed, clearance_removed, horizon_removed: 0, company_blocked: 0, output: filtered.length } };
}

// ── Dedupe by stable external ID only ──────────────────────────────────────
// Previously also deduped on title+company+location, but that collapsed
// genuinely-distinct requisitions at big companies: Microsoft posts ~50
// "Software Engineer II" / "Senior Software Engineer" roles in "Redmond,
// WA, US" at once — each is a separate team with its own requisition ID
// and JD. Walmart hits the same issue with many "(USA) Senior, Software
// Engineer" roles. The TLC dedup was eating 65%+ of Microsoft yield.
// The ID-based dedup below handles the actual "same job twice" concern.
function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const seenIds = new Set<string>();
  return jobs.filter(j => {
    if (seenIds.has(j.id)) return false;
    seenIds.add(j.id);
    return true;
  });
}

// ── Store in batches ───────────────────────────────────────────────────────
async function storeJobs(jobs: NormalizedJob[]): Promise<{ stored: number; error: string | null }> {
  if (jobs.length === 0) return { stored: 0, error: null };
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from("jobs")
      .upsert(jobs.slice(i, i + CHUNK), { onConflict: "id", ignoreDuplicates: false });
    if (error) { console.error("[storeJobs]", error.message); return { stored: total, error: error.message }; }
    total += jobs.slice(i, i + CHUNK).length;
  }
  return { stored: total, error: null };
}

// ── State helpers ──────────────────────────────────────────────────────────
function markRunning(company: string, source: RefreshSource): number {
  const now = Date.now();
  persistState({ company, source, status: "running",
    started_at: now, finished_at: null, duration_ms: null,
    raw_count: null, kept_count: null, error_message: null,
    last_success_at: null, last_attempt_at: now });
  return now;
}

function markDone(company: string, source: RefreshSource,
  startedAt: number, raw: number, kept: number, error: string | null) {
  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  const status: RefreshState["status"] =
    error === "rate_limited"    ? "rate_limited"   :
    error?.includes("timeout") ? "timeout"        :
    error                      ? "failed"          :
    kept > 0                   ? "success"         :
    raw > 0                    ? "partial_success" : "failed";
  persistState({ company, source, status,
    started_at: startedAt, finished_at: finishedAt, duration_ms: durationMs,
    raw_count: raw, kept_count: kept, error_message: error,
    last_success_at: (status === "success" || status === "partial_success") ? finishedAt : null,
    last_attempt_at: startedAt });
  persistRun({ run_id: `${company}-${startedAt}`, company, source, status,
    started_at: startedAt, finished_at: finishedAt, duration_ms: durationMs,
    raw_count: raw, kept_count: kept, error_message: error });
}

// ── Source caps ────────────────────────────────────────────────────────────
const SOURCE_STORE_CAPS: Record<string, number> = {
  greenhouse: 3000, workday: 1500, jsearch: 500,
  adzuna: 1000, jooble: 1000,
  phenom: 800,              // CVS Health alone returns ~215 IT jobs; cap at 800 leaves headroom for future Phenom tenants
  meta: 1000,               // Meta sitemap exposes ~918 jobs, ~711 of those US; after title filter expect 150-250
  playwright_microsoft: 150,
  playwright_google: 150,
  playwright_apple: 100,
  playwright_jpmorgan: 100,
  playwright_goldman: 100,
  playwright_openai: 50,
  walmart_cxs: 400,
  amazon_jobs: 400,         // Amazon v2 pipeline with 10-day date filter + JD fetch + sponsorship filter
};
function applySourceCap(jobs: NormalizedJob[], source: string): NormalizedJob[] {
  return jobs.slice(0, SOURCE_STORE_CAPS[source] ?? 1000);
}

// ── Ingest pipeline ────────────────────────────────────────────────────────
// Per-source horizon overrides: some companies keep reqs open for months.
// Using the global 30-day horizon drops 78%+ of Meta/Tier-A inventory.
const SOURCE_HORIZON_OVERRIDES: Record<string, number> = {
  // meta: removed — Meta adapter now sets postedAt=null (no-date source, like Google/Apple).
  //        null postedAt passes isWithinHorizon unconditionally so no override needed.
  playwright:           180,  // kept for backward compat (returns 400 at route level)
  playwright_microsoft: 180,
  playwright_google:    180,  // no-date source; override is a no-op but consistent
  playwright_apple:     180,
  playwright_jpmorgan:  180,
  playwright_goldman:   180,
  playwright_openai:    180,
  phenom:               180,  // CVS Health Phenom feed is accurate; no reason to drop older reqs
};

async function ingestSource(
  source: RefreshSource,
  fetchFn: () => Promise<{ raw: RawJob[]; fetched: number; error: string | null }>,
  label: string
): Promise<{ raw: number; kept: number; stored: number; error: string | null; filterStats?: FilterStats }> {
  const startedAt = markRunning(label, source);
  // Use per-source horizon if configured; otherwise fall back to global 30-day default.
  const horizonDays = SOURCE_HORIZON_OVERRIDES[source] ?? MAX_INGEST_DAYS;
  const horizonMs   = horizonDays * 86_400_000;
  function isWithinHorizon(iso: string | null): boolean {
    if (!iso) return true;
    return Date.now() - new Date(iso).getTime() <= horizonMs;
  }
  try {
    const { raw: rawJobs, fetched, error: fetchErr } = await fetchFn();
    if (fetchErr) {
      markDone(label, source, startedAt, 0, 0, fetchErr);
      logSourceSummary(label, { durationMs: Date.now() - startedAt, fetched: 0, stored: 0, health: classifyHealth(0, 0, fetchErr), reason: fetchErr });
      return { raw: 0, kept: 0, stored: 0, error: fetchErr };
    }
    const normalized = normalizeJobs(rawJobs);
    // Apply per-source horizon inside the filter pass
    let title_removed = 0, type_removed = 0, location_removed = 0,
        clearance_removed = 0, horizon_removed = 0, company_blocked = 0;
    const filtered = normalized.filter(j => {
      if (isBlockedCompany(j.company))                        { company_blocked++; return false; }
      if (!shouldIncludeTitle(j.title))                       { title_removed++;    return false; }
      if (!isFullTime(j.employment_type, j.description))     { type_removed++;     return false; }
      if (!isUSLocation(j.location))                         { location_removed++; return false; }
      if (requiresSecurityClearance(j.title, j.description)) { clearance_removed++;return false; }
      if (!isWithinHorizon(j.posted_at))                     { horizon_removed++;  return false; }
      return true;
    });
    const stats: FilterStats = { input: normalized.length, title_removed, type_removed,
      location_removed, clearance_removed, horizon_removed, company_blocked, output: filtered.length };
    const deduped             = dedupeJobs(filtered);
    // For no-date positionRank sources (Meta), renumber ranks 1→N after
    // title filtering so the pin badge shows clean sequential numbers.
    if (source === "meta") {
      deduped.forEach((j, idx) => { j.position_rank = idx + 1; });
    }
    const capped              = applySourceCap(deduped, source);
    const { stored, error: storeErr } = await storeJobs(capped);
    // Deactivate previously active rows for this source not in the current live set.
    // Runs after storeJobs so upserted survivors are already marked is_active=true.
    const liveIds = capped.map(j => j.id);
    await deactivateMissingJobsForSource(source, liveIds);
    markDone(label, source, startedAt, fetched, capped.length, storeErr);
    const durationMs = Date.now() - startedAt;
    console.log(`[refresh:${label}] horizonDays=${horizonDays} raw=${fetched} norm=${normalized.length} title_drop=${stats.title_removed} loc_drop=${stats.location_removed} type_drop=${stats.type_removed} clearance_drop=${stats.clearance_removed} horizon_drop=${stats.horizon_removed} filtered=${filtered.length} deduped=${deduped.length} capped=${capped.length} stored=${stored}`);
    logSourceSummary(label, { durationMs, fetched, stored, health: classifyHealth(stored, fetched, storeErr), reason: storeErr ?? undefined });
    return { raw: fetched, kept: capped.length, stored, error: storeErr, filterStats: stats };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    markDone(label, source, startedAt, 0, 0, msg);
    logSourceSummary(label, { durationMs: Date.now() - startedAt, fetched: 0, stored: 0, health: classifyHealth(0, 0, msg), reason: msg });
    return { raw: 0, kept: 0, stored: 0, error: msg };
  }
}

// ── Stale job cleanup ──────────────────────────────────────────────────────
async function deactivateStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - INGEST_CUTOFF_MS).toISOString();
  const { error } = await supabaseAdmin.from("jobs")
    .update({ is_active: false })
    .lt("posted_at", cutoff).eq("is_active", true);
  if (error) console.error("[refresh] deactivateStale:", error.message);
}

// ── Source reconciliation ──────────────────────────────────────────────────
// After storing survivors for a source, deactivate any previously active rows
// from that source that are NOT in the current live set.
// This ensures jobs filtered out by sponsorship logic (or any other reason)
// in this run are immediately hidden — not kept alive until age cutoff.
// Edge case: if liveIds is empty (all filtered), deactivate ALL rows for source.
async function deactivateMissingJobsForSource(source: string, liveIds: string[]): Promise<void> {
  try {
    if (liveIds.length === 0) {
      // Everything was filtered — deactivate all active rows for this source
      const { error } = await supabaseAdmin
        .from("jobs")
        .update({ is_active: false })
        .eq("source", source)
        .eq("is_active", true);
      if (error) console.error(`[deactivateMissing:${source}] all-deactivate failed:`, error.message);
      else console.log(`[deactivateMissing:${source}] all rows deactivated (empty live set)`);
      return;
    }
    // Deactivate active rows for this source whose ID is NOT in the live set.
    // Supabase .not("id", "in", ...) requires a Postgres array literal string.
    const idList = liveIds.map(id => `"${id}"`).join(",");
    const { error } = await supabaseAdmin
      .from("jobs")
      .update({ is_active: false })
      .eq("source", source)
      .eq("is_active", true)
      .not("id", "in", `(${idList})`);
    if (error) console.error(`[deactivateMissing:${source}] failed:`, error.message);
    else console.log(`[deactivateMissing:${source}] reconciliation complete, live=${liveIds.length}`);
  } catch (e: unknown) {
    console.error(`[deactivateMissing:${source}] exception:`, e instanceof Error ? e.message : String(e));
  }
}

// ── 1a. Greenhouse ─────────────────────────────────────────────────────────
// Company list driven by COMPANY_ATS_REGISTRY (ats="greenhouse", enabled=true).
// Edit the registry to add/remove companies — do not hardcode here.
async function fetchGreenhouseSource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  const results: RawJob[] = [];
  let totalFetched = 0;
  const companySlugs = getGreenhouseSlugs(); // registry-driven, returns [{company, slug}]

  await Promise.allSettled(companySlugs.map(async ({ company, slug }) => {
    try {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) return;
      const data = await res.json();
      const jobs = (data.jobs ?? []) as Record<string, unknown>[];
      totalFetched += jobs.length;
      for (const j of jobs) {
        const title = (j.title as string) ?? "";
        if (!title) continue;
        const locObj = j.location as Record<string, unknown> | null;
        results.push({
          id:          `gh-${slug}-${j.id ?? Math.random()}`,
          source:      "greenhouse",
          company,     // exact display name from registry
          title,
          location:    (locObj?.name as string) ?? "Remote",
          description: (j.content as string) ?? "",
          applyUrl:    (j.absolute_url as string) ?? "#",
          postedAt:    (j.updated_at as string) ?? null,
          type:        "Full-time",
        });
      }
    } catch { /* non-fatal per company */ }
  }));

  return { raw: results, fetched: totalFetched, error: null };
}

// ── 1b. Workday ─────────────────────────────────────────────────────────────
// Company list driven by COMPANY_ATS_REGISTRY (ats="workday", enabled=true).
// Goldman Sachs and JPMorgan removed: they use Oracle HCM, not Workday.
const WD_PAGE_SIZE = 20;
const WD_MAX_PAGES = 15;

async function fetchWorkdayCompany(name: string, tenant: string, site: string, server: string): Promise<RawJob[]> {
  const results: RawJob[] = [];
  const baseUrl = `https://${tenant}.${server}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;

  for (let page = 0; page < WD_MAX_PAGES; page++) {
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Accept": "application/json", "Content-Type": "application/json",
          "Accept-Language": "en-US",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        body: JSON.stringify({ appliedFacets: {}, limit: WD_PAGE_SIZE, offset: page * WD_PAGE_SIZE, searchText: "software engineer" }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        if (res.status === 422) {
          console.warn(`[workday] ${name} page=${page} status=422 reason=unsupported_tenant`);
        } else {
          console.warn(`[workday] ${name} page=${page} status=${res.status} reason=unexpected_error`);
        }
        break;
      }
      const data = await res.json();
      const jobs = (data.jobPostings ?? []) as Record<string, unknown>[];
      if (jobs.length === 0) break;

      for (const j of jobs) {
        const title = (j.title as string) ?? "";
        if (!title) continue;
        const rawDesc      = ((j.jobDescription as Record<string, unknown>)?.jobDescription as string) ?? (j.shortDesc as string) ?? "";
        const locText      = (j.locationsText as string) ?? (j.location as string) ?? "United States";
        const externalPath = (j.externalPath as string) ?? "";
        const applyUrl     = externalPath
          ? `https://${tenant}.${server}.myworkdayjobs.com/en-US/${site}/job${externalPath}`
          : `https://${tenant}.${server}.myworkdayjobs.com/en-US/${site}`;
        // Stable ID: externalPath contains unique req slug. Fallback: composite.
        const uid = externalPath
          ? externalPath.replace(/\//g, "-").slice(-48)
          : `${tenant}-${title.toLowerCase().replace(/\s+/g, "-").slice(0, 30)}-${locText.slice(0, 20)}-${page}-${results.length}`;
        results.push({
          id:          `wd-${uid}`,
          source:      "workday",
          company:     name,
          title,
          location:    locText,
          description: rawDesc,
          applyUrl,
          postedAt:    (j.postedOn as string) ?? null,
          type:        "Full-time",
        });
      }
      if (jobs.length < WD_PAGE_SIZE) break;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[workday] ${name} page=${page} exception="${msg}"`);
      break;
    }
  }
  return results;
}

async function fetchWorkdaySource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  const results: RawJob[] = [];
  const companies = getWorkdayConfigs(); // registry-driven
  const BATCH = 12;              // was 4 — more parallelism to stay under Vercel 60s
  const PER_TENANT_MS = 20_000;  // hard cap per tenant (paging can blow past per-call 12s)

  for (let i = 0; i < companies.length; i += BATCH) {
    const settled = await Promise.allSettled(
      companies.slice(i, i + BATCH).map(c =>
        Promise.race<RawJob[]>([
          fetchWorkdayCompany(c.name, c.tenant, c.site, c.server),
          new Promise<RawJob[]>((_, reject) =>
            setTimeout(() => reject(new Error(`per-tenant timeout ${c.name}`)), PER_TENANT_MS)
          ),
        ]).catch(() => {
          console.warn(`[workday] ${c.name} hit ${PER_TENANT_MS}ms per-tenant cap`);
          return [] as RawJob[];
        })
      )
    );
    settled.forEach(r => { if (r.status === "fulfilled") results.push(...r.value); });
  }
  return { raw: results, fetched: results.length, error: null };
}

// ── 1c. JSearch ────────────────────────────────────────────────────────────
async function fetchJSearchSource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return { raw: [], fetched: 0, error: "RAPIDAPI_KEY not set" };
  try {
    const params = new URLSearchParams({
      query: "software engineer", page: "1", num_pages: "2",
      country: "us", remote_jobs_only: "false",
    });
    const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
      headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) { console.warn("[jsearch] status=429 reason=rate_limited"); return { raw: [], fetched: 0, error: "rate_limited" }; }
    if (!res.ok) return { raw: [], fetched: 0, error: `HTTP ${res.status}` };
    const data = await res.json();
    const raw  = (data.data ?? []) as Record<string, unknown>[];
    const jobs: RawJob[] = raw
      .filter(j => j.job_title && j.employer_name)
      .map((j, i) => ({
        id:          (j.job_id as string) ?? `js-${i}`,
        source:      "jsearch" as RefreshSource,
        company:     (j.employer_name as string) ?? "",
        title:       (j.job_title as string) ?? "",
        location:    [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || "Remote",
        description: (j.job_description as string) ?? "",
        applyUrl:    (j.job_apply_link as string) ?? "#",
        postedAt:    (j.job_posted_at_datetime_utc as string) ?? null,
        type:        (j.job_employment_type as string) ?? "Full-time",
      }));
    return { raw: jobs, fetched: raw.length, error: null };
  } catch (e: unknown) {
    return { raw: [], fetched: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── 1d. Adzuna ─────────────────────────────────────────────────────────────
const ADZUNA_MAX_PAGES = 8;

async function fetchAdzunaSource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  const appId  = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { raw: [], fetched: 0, error: "ADZUNA keys not set" };
  const results: RawJob[] = [];
  let totalFetched = 0, hitHorizon = false;
  for (let page = 1; page <= ADZUNA_MAX_PAGES && !hitHorizon; page++) {
    try {
      const params = new URLSearchParams({
        app_id: appId, app_key: appKey, results_per_page: "50",
        what: "software engineer", where: "united states",
        "content-type": "application/json", full_time: "1", sort_by: "date",
      });
      const res = await fetch(`https://api.adzuna.com/v1/api/jobs/us/search/${page}?${params}`,
        { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) break;
      const data = await res.json();
      const raw  = (data.results ?? []) as Record<string, unknown>[];
      if (raw.length === 0) break;
      totalFetched += raw.length;
      for (const j of raw) {
        const locObj    = (j.location as Record<string, unknown>) ?? {};
        const company   = ((j.company as Record<string, unknown>)?.display_name as string) ?? "";
        // Skip companies whose primary source is a direct adapter (Phenom, etc.)
        // — Adzuna's data for them has fanout / broken /land/ad/ links.
        if (isPhenomOnly(company)) continue;
        if (isMetaDirect(company)) continue;
        const createdAt = (j.created as string) ?? null;
        if (createdAt && (Date.now() - new Date(createdAt).getTime()) / 86_400_000 > MAX_INGEST_DAYS) {
          hitHorizon = true; break;
        }
        results.push({
          id: `az-${j.id ?? Math.random()}`, source: "adzuna" as RefreshSource, company,
          title:       (j.title as string) ?? "",
          location:    (locObj.display_name as string) ?? "United States",
          description: (j.description as string) ?? "",
          applyUrl:    (j.redirect_url as string) ?? "#",
          postedAt:    createdAt, type: "Full-time",
        });
      }
      if (raw.length < 50) break;
    } catch { break; }
  }
  return { raw: results, fetched: totalFetched, error: null };
}

// ── 1d-b. Adzuna Targeted (per-company) ────────────────────────────────────
// Fills coverage gaps for major enterprise companies whose direct Workday/ATS
// fetch is blocked by Cloudflare bot protection (Wells Fargo, Capital One,
// Morgan Stanley, Home Depot). One call per company, 50 jobs each, scoped to
// the last 30 days. Jobs land in the DB tagged source="adzuna" — dedupe
// handles any overlap with fetchAdzunaSource.
const ADZUNA_TARGETED_COMPANIES = [
  // Cloudflare-blocked Workday tenants — sourced via Adzuna instead.
  "Wells Fargo",
  "Capital One",
  "Morgan Stanley",
  "Home Depot",
  // Priority companies expanded 2026-04-16 after Adzuna probe confirmed
  // real SWE results indexed under these exact names.
  "IBM",                // 149 jobs on Adzuna
  "Cigna",              //  18 jobs
  "UnitedHealth Group", //  90 jobs — exact name matters; "UnitedHealth" alone returns 400
  "ServiceNow",         //  35 jobs (also in Workday registry but tenant returns 422)
  "UPS",                //   2 jobs — sparse but real
  // Second expansion — Greenhouse slug was 404 for these; Adzuna has them:
  "Snowflake",          //  10 jobs — all real engineering roles
  "Visa",               //  45 jobs
  "Mastercard",         //  45 jobs
  "Accenture",          // 273 jobs — consulting giant, heavy coverage
  "Cognizant",          // 314 jobs
  "Capgemini",          //  94 jobs
  // Third expansion — Meta scraper broken + Target undercovered by Workday:
  // Walmart removed 2026-04-18 — now sourced via direct Workday CXS backend
  // (fetchWalmartJobs in lib/playwrightScrapers.ts). Scoped to 4 Job Profile
  // IDs, returns 265 jobs with real req IDs and careers.walmart.com apply links.
  "Target",             //   4 jobs — small add, but target company on the priority list
  // Fourth expansion (2026-04-16, partial workflow rollout):
  //   Banks / finance that live on Oracle HCM or proprietary sites with
  //   bot-protection — Adzuna indexes all of them reliably.
  "Bank of America",
  "Citigroup",
  "Fidelity Investments",
  "U.S. Bank",
  //   Telecom.
  "T-Mobile",
  "AT&T",
  //   Healthcare giants whose direct ATS fetches are blocked or unreliable.
  "Elevance Health",
  // CVS Health removed 2026-04-17 — now sourced via direct Phenom scrape.
  // Adzuna fanned out a single requisition across 30+ state-capital cities
  // each with a broken /land/ad/ apply URL. Blocked at the per-row level too
  // by isPhenomOnly() in fetchAdzunaSource for safety.
  //   IT consulting (complements Accenture/Cognizant/Capgemini already on list).
  "Infosys",
  "Tata Consultancy Services",
  "Wipro",
  "Deloitte",
  // TODO (next session): direct ATS scrapers for companies Adzuna does NOT index:
  //   - American Express        → Oracle HCM (similar to JPMorgan Chase)
  //   - PayPal                  → Workday (paypal.wd1.myworkdayjobs.com/paypal)
  //   - Verizon Communications  → Workday (mycareer.verizon.com, Workday-backed)
  //   - Costco Wholesale        → custom careers.costco.com scraper
  // Probed 2026-04-16: Adzuna US index returns 0 SWE jobs for all four under
  // every name variant tried (American Express/Amex, PayPal/Paypal,
  // Verizon/Verizon Communications/Verizon Wireless, Costco/Costco Wholesale).
  // Keeping them in this list wastes one API call + rate-limit budget per
  // refresh while never returning data. Removed until direct scrapers are built.
];

// Partial workflow (workflow spec §§3, 5-9) applied inside the per-company
// ingestion loop below: early dedupe, early title filter, early location
// filter, 30-day horizon, MAX_JOBS_PER_COMPANY = 60 cap.
const ADZUNA_TARGETED_MAX_PER_COMPANY = 60;

async function fetchAdzunaTargetedSource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  const appId  = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { raw: [], fetched: 0, error: "ADZUNA keys not set" };

  const results: RawJob[] = [];
  let totalFetched = 0;

  // Sequential with 300ms throttle — 15 parallel calls were tripping Adzuna's
  // rate limit, causing ~80% of companies to return 0 raw. Sequential takes
  // ~6-8s total which is still well inside the 60s refresh budget.
  type CallResult = { companyName: string; raw: Record<string, unknown>[] };
  type FailResult = { companyName: string; httpStatus: number | null; errorMsg: string };
  const fulfilled: CallResult[] = [];
  const failed: FailResult[] = [];

  for (const companyName of ADZUNA_TARGETED_COMPANIES) {
    try {
      const params = new URLSearchParams({
        app_id: appId, app_key: appKey,
        results_per_page: "50", company: companyName,
        what: "software engineer", max_days_old: String(MAX_INGEST_DAYS),
        "content-type": "application/json", sort_by: "date",
      });
      const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) {
        failed.push({ companyName, httpStatus: res.status, errorMsg: `HTTP ${res.status}` });
      } else {
        const data = await res.json();
        const raw = (data.results ?? []) as Record<string, unknown>[];
        fulfilled.push({ companyName, raw });
      }
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      failed.push({ companyName, httpStatus: null, errorMsg: msg });
    }
    // Small throttle between calls to avoid tripping Adzuna's per-IP rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  // Partial workflow: per-company early-filter stats for logging.
  const perCompany: Record<string, {
    raw: number; keptEarly: number;
    dropTitle: number; dropLoc: number; dropDate: number; dropDup: number;
  }> = {};
  const seenIds = new Set<string>();

  for (const { companyName, raw } of fulfilled) {
    totalFetched += raw.length;
    const s = perCompany[companyName] = { raw: raw.length, keptEarly: 0, dropTitle: 0, dropLoc: 0, dropDate: 0, dropDup: 0 };

    let keptForCompany = 0;
    for (const j of raw) {
      if (keptForCompany >= ADZUNA_TARGETED_MAX_PER_COMPANY) break; // MAX_JOBS_PER_COMPANY cap

      const locObj    = (j.location as Record<string, unknown>) ?? {};
      const company   = ((j.company as Record<string, unknown>)?.display_name as string) ?? companyName;
      // Defense in depth: even if a Phenom-only company sneaks back into
      // ADZUNA_TARGETED_COMPANIES, drop the row at ingest time.
      if (isPhenomOnly(company)) continue;
      if (isMetaDirect(company)) continue;
      const createdAt = (j.created as string) ?? null;
      const title     = (j.title as string) ?? "";
      const id        = `azt-${j.id ?? Math.random()}`;

      // EARLY DEDUPE (step 7)
      if (seenIds.has(id)) { s.dropDup += 1; continue; }

      // EARLY TITLE FILTER (step 5) — lightweight, NOT the full filter
      if (!isRelevantTitleEarly(title)) { s.dropTitle += 1; continue; }

      // Build the location string (same logic as before — must pass full
      // isUSLocation downstream)
      const area = Array.isArray(locObj.area) ? (locObj.area as string[]) : [];
      const city   = area[area.length - 1] ?? "";
      const state  = area[1] ?? "";
      const location = [city, state, "United States"].filter(Boolean).join(", ") || (locObj.display_name as string) || "United States";

      // EARLY LOCATION FILTER (step 6)
      if (!isUSLocation(location)) { s.dropLoc += 1; continue; }

      // EARLY DATE FILTER (step 4) — 30-day horizon preserved for partial workflow
      if (!isWithinEarlyHorizon(createdAt, EARLY_HORIZON_DAYS_PARTIAL)) { s.dropDate += 1; continue; }

      seenIds.add(id);
      results.push({
        id, source: "adzuna" as RefreshSource, company,
        title,
        location,
        description: (j.description as string) ?? "",
        applyUrl:    (j.redirect_url as string) ?? "#",
        postedAt:    createdAt, type: "Full-time",
      });
      keptForCompany += 1;
      s.keptEarly += 1;
    }
  }

  // Per-company log line — visibility into the partial workflow funnel.
  for (const [co, s] of Object.entries(perCompany)) {
    console.log(`[adzuna_targeted:${co}] raw=${s.raw} early_title_drop=${s.dropTitle} loc_drop=${s.dropLoc} date_drop=${s.dropDate} dup_drop=${s.dropDup} keptEarly=${s.keptEarly}`);
  }
  for (const f of failed) {
    console.warn(`[adzuna_targeted] company="${f.companyName}" status=failed http=${f.httpStatus ?? "network_error"} error="${f.errorMsg}"`);
  }
  console.log(`[adzuna_targeted] companies_total=${ADZUNA_TARGETED_COMPANIES.length} success=${fulfilled.length} failed=${failed.length} raw=${totalFetched} kept=${results.length} maxPerCompany=${ADZUNA_TARGETED_MAX_PER_COMPANY}`);
  return { raw: results, fetched: totalFetched, error: null };
}

// ── 1e. Jooble ─────────────────────────────────────────────────────────────
const JOOBLE_MAX_PAGES = 6; // increased from 3

async function fetchJoobleSource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return { raw: [], fetched: 0, error: "JOOBLE_API_KEY not set" };
  const results: RawJob[] = [];
  let totalFetched = 0;
  for (let page = 1; page <= JOOBLE_MAX_PAGES; page++) {
    try {
      const res = await fetch(`https://jooble.org/api/${apiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: "software engineer", location: "United States", page }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) break;
      const data = await res.json();
      const raw  = (data.jobs ?? []) as Record<string, unknown>[];
      if (raw.length === 0) break;
      totalFetched += raw.length;
      for (const j of raw) {
        results.push({
          id: `jb-${j.id ?? Math.random()}`, source: "jooble" as RefreshSource,
          company:     (j.company as string) ?? "",
          title:       (j.title as string) ?? "",
          location:    (j.location as string) ?? "United States",
          description: ((j.snippet as string) ?? (j.description as string)) ?? "",
          applyUrl:    (j.link as string) ?? "#",
          postedAt:    (j.updated as string) ?? null, type: "Full-time",
        });
      }
    } catch { break; }
  }
  return { raw: results, fetched: totalFetched, error: null };
}

// ── 1f. Playwright / Custom API Tier A ─────────────────────────────────────
// Companies with no standard ATS — scraped via their career page APIs.
// Each company maps to EXACTLY ONE fetcher. No company appears in Workday/GH too.
// Goldman Sachs: Oracle HCM (not Workday). OpenAI: Ashby. Netflix: Lever.
// 1g. Phenom (CVS Health, others). Direct scrape of Phenom-hosted
// careers sites. CVS Health is the first tenant. The adapter
// (lib/scrapers/phenom.ts) fetches 215 IT jobs (ground truth from CVS's
// own site, vs the 53 Workday SWE-keyword search returns) with real
// Workday apply URLs and no Adzuna geo-fanout. New Phenom tenants are
// added in PHENOM_TENANTS inside the adapter file (no changes here).
async function fetchPhenomSource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  try {
    const scraped = await fetchAllPhenomTenants();
    // Output of fetchAllPhenomTenants already matches RawJob shape
    // (id/source/company/title/location/description/applyUrl/postedAt/type).
    return { raw: scraped, fetched: scraped.length, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { raw: [], fetched: 0, error: msg };
  }
}

// 1h. Meta sitemap+JSON-LD (lib/scrapers/meta.ts).
// Replaces playwright_meta which broke when Meta added per-request anti-replay
// tokens to its GraphQL endpoint. Sitemap exposes ~918 job URLs each with full
// JSON-LD JobPosting; ~78% are US-anchored. Concurrency-limited inside the
// adapter so fetch wall-time stays under the 60s function limit.
async function fetchMetaSource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  try {
    const scraped = await fetchMetaSitemapJobs();
    return { raw: scraped, fetched: scraped.length, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { raw: [], fetched: 0, error: msg };
  }
}

const TIER_A_COMPANIES: Array<{ name: string; source: RefreshSource; fetcher: () => Promise<ScrapedJob[]> }> = [
  { name: "Microsoft",      source: "playwright_microsoft", fetcher: fetchMicrosoftJobs    },
  { name: "Google",         source: "playwright_google",    fetcher: fetchGoogleJobs       },
  { name: "Apple",          source: "playwright_apple",     fetcher: fetchAppleJobs        },
  // Meta removed 2026-04-17 — fetchMetaJobs returns HTTP 400 since Meta added
  // per-request anti-replay tokens to its GraphQL endpoint. Replaced by the
  // sitemap+JSON-LD adapter in lib/scrapers/meta.ts (run via source="meta").
  { name: "Amazon",         source: "amazon_jobs",          fetcher: fetchAmazonJobsV2     },
  { name: "JPMorgan Chase", source: "playwright_jpmorgan",  fetcher: fetchJPMJobs          },
  { name: "Goldman Sachs",  source: "playwright_google",    fetcher: fetchGoldmanSachsJobs }, // Oracle HCM
  { name: "OpenAI",         source: "playwright_microsoft", fetcher: fetchOpenAIJobs       }, // Ashby
  { name: "Netflix",        source: "playwright_apple",     fetcher: fetchNetflixJobs      }, // Lever
  // Walmart: direct Workday CXS backend, scoped to 4 Job Profile IDs.
  // Replaces Adzuna targeted fetch (2026-04-18) — direct source returns 265
  // jobs with real req IDs and careers.walmart.com apply links.
  { name: "Walmart",        source: "walmart_cxs",          fetcher: fetchWalmartJobs      },
];

async function fetchPlaywrightTierA(): Promise<{
  raw: RawJob[]; fetched: number; error: string | null;
  companyResults: Record<string, { raw: number; filtered: number; error: string | null }>;
}> {
  const allRaw: RawJob[] = [];
  const companyResults: Record<string, { raw: number; filtered: number; error: string | null }> = {};

  const settled = await Promise.allSettled(
    TIER_A_COMPANIES.map(async ({ name, source, fetcher }) => {
      const t0 = Date.now();
      persistState({ company: name, source, status: "running",
        started_at: t0, finished_at: null, duration_ms: null,
        raw_count: null, kept_count: null, error_message: null,
        last_success_at: null, last_attempt_at: t0 });
      try {
        const scraped = await fetcher();
        const raw: RawJob[] = scraped.map(s => ({
          id: s.id, source: source as RefreshSource, company: s.company,
          title: s.title, location: s.location, description: s.description,
          applyUrl: s.applyUrl, postedAt: s.postedAt, type: s.type,
          positionRank: s.positionRank,
        }));
        const now = Date.now();
        persistState({ company: name, source, status: "success",
          started_at: t0, finished_at: now, duration_ms: now - t0,
          raw_count: raw.length, kept_count: raw.length, error_message: null,
          last_success_at: now, last_attempt_at: t0 });
        companyResults[name] = { raw: raw.length, filtered: raw.length, error: null };
        console.log(`[playwright:${name}] raw=${raw.length}`);
        return raw;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const now = Date.now();
        persistState({ company: name, source, status: "failed",
          started_at: t0, finished_at: now, duration_ms: now - t0,
          raw_count: 0, kept_count: 0, error_message: msg,
          last_success_at: null, last_attempt_at: t0 });
        companyResults[name] = { raw: 0, filtered: 0, error: msg };
        return [] as RawJob[];
      }
    })
  );

  settled.forEach(r => { if (r.status === "fulfilled") allRaw.push(...r.value); });
  console.log(`[playwright] TierA total raw: ${allRaw.length}`);
  return { raw: allRaw, fetched: allRaw.length, error: null, companyResults };
}

// ── Tier A per-company fetcher adapter ────────────────────────────────────
// Converts a ScrapedJob[] fetcher into the { raw, fetched, error } shape
// expected by ingestSource. Each per-company route calls exactly one fetcher.
function makeTierAFetcher(source: RefreshSource, fetcher: () => Promise<ScrapedJob[]>) {
  return async (): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> => {
    const scraped = await fetcher();
    const raw: RawJob[] = scraped.map(s => ({
      id: s.id, source, company: s.company,
      title: s.title, location: s.location, description: s.description,
      applyUrl: s.applyUrl, postedAt: s.postedAt, type: s.type,
      positionRank: s.positionRank,
    }));
    return { raw, fetched: raw.length, error: null };
  };
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const sourceFilter = (body.source as string) || "all";

  if (sourceFilter === "all") {
    return NextResponse.json({
      ok: false,
      error: "source=all is disabled for UI refresh on Vercel. Use per-source orchestrated refresh.",
    }, { status: 400 });
  }

  if (sourceFilter === "playwright") {
    return NextResponse.json({
      ok: false,
      error: "source=playwright is deprecated; use company-specific playwright sources (playwright_microsoft, playwright_google, playwright_apple, playwright_jpmorgan, playwright_goldman, playwright_openai)",
    }, { status: 400 });
  }

  console.log(`[refresh] triggered source=${sourceFilter}`);
  const startMs = Date.now();
  const results: Record<string, unknown> = {};

  const run   = (s: string) => sourceFilter === "all" || sourceFilter === s;
  const tasks: Promise<void>[] = [];

  if (run("greenhouse")) tasks.push(ingestSource("greenhouse", fetchGreenhouseSource, "greenhouse").then(r => { results.greenhouse = r; }));
  if (run("workday"))    tasks.push(ingestSource("workday",    fetchWorkdaySource,    "workday"   ).then(r => { results.workday    = r; }));
  if (run("jsearch"))    tasks.push(ingestSource("jsearch",    fetchJSearchSource,    "jsearch"   ).then(r => { results.jsearch    = r; }));
  if (run("adzuna"))     tasks.push(ingestSource("adzuna",     fetchAdzunaSource,     "adzuna"    ).then(r => { results.adzuna     = r; }));
  if (run("adzuna"))     tasks.push(ingestSource("adzuna",     fetchAdzunaTargetedSource, "adzuna_targeted").then(r => { results.adzuna_targeted = r; }));
  if (run("jooble"))     tasks.push(ingestSource("jooble",     fetchJoobleSource,     "jooble"    ).then(r => { results.jooble     = r; }));
  if (run("phenom"))     tasks.push(ingestSource("phenom",     fetchPhenomSource,     "phenom"    ).then(r => { results.phenom     = r; }));
  if (run("meta"))       tasks.push(ingestSource("meta",       fetchMetaSource,       "meta"      ).then(r => { results.meta       = r; }));

  // ── Per-company Tier A playwright sources ─────────────────────────────
  if (run("playwright_microsoft")) tasks.push(ingestSource("playwright_microsoft", makeTierAFetcher("playwright_microsoft", fetchMicrosoftJobs),    "playwright_microsoft").then(r => { results.playwright_microsoft = r; }));
  if (run("playwright_google"))    tasks.push(ingestSource("playwright_google",    makeTierAFetcher("playwright_google",    fetchGoogleJobs),       "playwright_google"   ).then(r => { results.playwright_google    = r; }));
  if (run("playwright_apple"))     tasks.push(ingestSource("playwright_apple",     makeTierAFetcher("playwright_apple",     fetchAppleJobs),        "playwright_apple"    ).then(r => { results.playwright_apple     = r; }));
  if (run("playwright_jpmorgan"))  tasks.push(ingestSource("playwright_jpmorgan",  makeTierAFetcher("playwright_jpmorgan",  fetchJPMJobs),          "playwright_jpmorgan" ).then(r => { results.playwright_jpmorgan  = r; }));
  if (run("playwright_goldman"))   tasks.push(ingestSource("playwright_goldman",   makeTierAFetcher("playwright_goldman",   fetchGoldmanSachsJobs), "playwright_goldman"  ).then(r => { results.playwright_goldman   = r; }));
  if (run("playwright_openai"))    tasks.push(ingestSource("playwright_openai",    makeTierAFetcher("playwright_openai",    fetchOpenAIJobs),       "playwright_openai"   ).then(r => { results.playwright_openai    = r; }));
  if (run("walmart_cxs"))          tasks.push(ingestSource("walmart_cxs",          makeTierAFetcher("walmart_cxs",          fetchWalmartJobs),      "walmart_cxs"         ).then(r => { results.walmart_cxs          = r; }));
  if (run("amazon_jobs"))          tasks.push(ingestSource("amazon_jobs",          makeTierAFetcher("amazon_jobs",          fetchAmazonJobsV2),     "amazon_jobs"         ).then(r => { results.amazon_jobs          = r; }));

  await Promise.allSettled(tasks);
  await deactivateStaleJobs();

  // ── AI enrichment (opt-in, non-blocking) ──────────────────────────────────
  if (isAiEnabled()) {
    for (const aiSource of ["walmart_cxs", "amazon_jobs"] as const) {
      if (!run(aiSource)) continue;
      const sourceResult = results[aiSource] as { error?: string | null } | undefined;
      if (sourceResult?.error) continue;
      console.log(`[ai_enrichment] source=${aiSource} started`);
      try {
        const aiStart = Date.now();
        const { data: dbJobsRaw } = await supabaseAdmin
          .from("jobs")
          .select("id, source, company, title, description, full_description, location, apply_url")
          .eq("source", aiSource).eq("is_active", true).limit(200);
        const dbJobs = (dbJobsRaw ?? []) as Array<Record<string, unknown>>;
        console.log(`[ai_enrichment] source=${aiSource} selected=${dbJobs.length}`);
        const jobsForAi: JobInputForEnrichment[] = dbJobs.map(j => ({
          id:          String(j.id ?? ""),
          company:     String(j.company ?? ""),
          title:       String(j.title ?? ""),
          description: String(j.full_description ?? j.description ?? ""),
          location:    String(j.location ?? ""),
          url:         String(j.apply_url ?? ""),
        }));
        console.log(`[ai_enrichment] source=${aiSource} sending_to_batch=${jobsForAi.slice(0, 50).length}`);
        const t0 = Date.now();
        const { results: aiResults, stats } = await enrichBatch(jobsForAi.slice(0, 50));
        console.log(`[ai_enrichment] source=${aiSource} enrichBatch done in ${Date.now() - t0}ms`);
        console.log(`[ai_enrichment] source=${aiSource} batch_results=${aiResults.size} enriched=${stats.enriched} failed=${stats.failed} skipped=${stats.skipped} rate_limited=${stats.rateLimited}`);
        const updates: Array<{ id: string; source: string; title: string; company: string; location: string; ai_enrichment: unknown; ai_meta: unknown | null }> = [];
        let skippedInvalid = 0;
        for (const [key, enriched] of aiResults) {
          if (!key || !enriched?.ai) {
            if (skippedInvalid < 3) {
              const reason = !key ? "missing_key" : "missing_ai";
              console.warn(`[ai_enrichment] skip_invalid reason=${reason} id=${key} source=${aiSource}`);
            }
            skippedInvalid++;
            continue;
          }
          const job = dbJobs.find(j => String(j.id) === key);
          if (!job) {
            if (skippedInvalid < 3) console.warn(`[ai_enrichment] skip_invalid reason=job_not_found id=${key} source=${aiSource}`);
            skippedInvalid++;
            continue;
          }
          updates.push({
            id:           String(job.id),
            source:       String(job.source ?? aiSource),
            title:        String(job.title ?? ""),
            company:      String(job.company ?? ""),
            location:     String(job.location ?? ""),
            ai_enrichment: enriched.ai,
            ai_meta:      enriched.aiMeta ?? null,
          });
        }
        console.log(`[ai_enrichment] source=${aiSource} skipped_invalid=${skippedInvalid} updates=${updates.length}`);
        if (updates.length > 0) {
          console.log(`[ai_enrichment] sample_update:`, JSON.stringify(updates[0], null, 2));
        }
        if (updates.length === 0) {
          console.warn(`[ai_enrichment] source=${aiSource} no valid updates — skipping upsert`);
        } else {
          const { error: upsertErr } = await supabaseAdmin
            .from("jobs")
            .upsert(updates, { onConflict: "id" });
          if (upsertErr) console.error(`[ai_enrichment] source=${aiSource} upsert error: ${upsertErr.message}`);
          if (!upsertErr) console.log(`[ai_enrichment] source=${aiSource} persisted=${updates.length}`);
        }
        console.log(`[ai_enrichment] source=${aiSource} total=${stats.totalJobs} enriched=${stats.enriched} persisted=${updates.length} failed=${stats.failed} rate_limited=${stats.rateLimited} durationMs=${Date.now() - aiStart}`);
      } catch (aiErr: unknown) {
        const msg = aiErr instanceof Error ? aiErr.message : String(aiErr);
        console.error(`[ai_enrichment] source=${aiSource} error="${msg}" — enrichment skipped, refresh continues`);
      }
    }
  }

  // Query DB for actual visible board count after this run
  let boardVisibleTotal = 0;
  try {
    const { count } = await supabaseAdmin
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);
    boardVisibleTotal = count ?? 0;
  } catch { /* non-fatal */ }

  const jobsUpsertedThisRun = Object.values(results).reduce<number>(
    (sum, r) => sum + ((r as { stored?: number }).stored ?? 0), 0
  );
  const durationMs = Date.now() - startMs;
  console.log(`[refresh] done in ${durationMs}ms upserted=${jobsUpsertedThisRun} board_total=${boardVisibleTotal}`);

  return NextResponse.json({
    ok:                    true,
    duration_ms:           durationMs,
    sources_run:           Object.keys(results),
    // Upserted = rows inserted OR updated in DB this run (not the board visible total)
    jobs_upserted_this_run: jobsUpsertedThisRun,
    // Board total = active rows in DB (what the Jobs page will show before diversity caps)
    board_db_total:        boardVisibleTotal,
    note:                  `${jobsUpsertedThisRun} rows upserted this run. Board shows ${boardVisibleTotal} active rows in DB (diversity caps may reduce visible count further).`,
    results,
  });
  } catch (outerErr: unknown) {
    // Belt-and-suspenders: ensure the refresh route ALWAYS returns JSON.
    // Without this, an unexpected throw returns a non-JSON HTML error page
    // which breaks the UI's res.json() call.
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    console.error("[refresh] uncaught outer error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return POST(req); }

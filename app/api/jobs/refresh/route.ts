import { NextRequest, NextResponse } from "next/server";
import { persistState, persistRun } from "@/app/api/jobs/refresh-store";
import type { RefreshState, RefreshSource } from "@/app/api/jobs/types";
import { supabaseAdmin } from "@/lib/supabase";
import { cleanDescription, detectSponsorship, isUSLocation } from "@/lib/jobUtils";
import {
  fetchMicrosoftJobs, fetchGoogleJobs, fetchAppleJobs,
  fetchMetaJobs, fetchAmazonJobs, fetchJPMJobs,
  fetchGoldmanSachsJobs, fetchOpenAIJobs, fetchNetflixJobs,
  type ScrapedJob,
} from "@/lib/playwrightScrapers";
import { getWorkdayConfigs, getGreenhouseSlugs } from "@/lib/companyAtsRegistry";

export const maxDuration = 60;

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
}

// ── Title filter ───────────────────────────────────────────────────────────
// INCLUDE: must contain at least one keyword or phrase
const INCLUDE_KEYWORDS = [
  "software engineer", "software developer",
  "backend engineer", "backend developer",
  "frontend engineer", "frontend developer",
  "full stack", "fullstack",
  "cloud engineer", "devops engineer", "platform engineer",
  "site reliability", "sre",
  "distributed systems",
  "application engineer", "application developer",
  "python developer", "java developer",
  "ui engineer", "ui developer",
  "api engineer", "integration engineer",
  "web developer", "product engineer",
];

// EXCLUDE: hard reject if title contains any of these (substring match — checked
// BEFORE include keywords, so these always win regardless of SWE context)
const EXCLUDE_SUBSTRINGS = [
  // Seniority levels we do not want in the board
  "principal",   // kills "Principal Software Engineer"
  "staff",       // kills "Staff Software Engineer"
  "lead",        // kills "Lead Software Engineer", "Tech Lead"
  "architect",   // kills "Solutions Architect", "Software Architect"
  // Management / non-IC
  "manager", "director", "vice president", "head of", "chief",
  "intern", "internship",
  // Language-specific we don't target
  ".net developer", "dotnet", "c# developer",
  // Research / clearance
  "research scientist",
  // Non-SWE tech
  "security engineer", "cybersecurity", "network engineer",
  // Business / process
  "business analyst", "scrum master", "project manager",
  "recruiter", "marketing engineer",
  // Junk roles from retail / ops / physical
  "technician", "mechanic", "electrician", "machinist",
  "warehouse", "retail associate", "store associate",
  "robotics engineer", "controls engineer", "automation engineer",
  "mechanical engineer", "electrical engineer", "civil engineer",
  "nurse", "pharmacist", "physician", "therapist",
  "sales representative", "account executive", "account manager",
  "data center technician", "field technician", "field service",
  "customer service", "customer support",
];

// EXCLUDE whole-word only — must not match "mls", "vpn", etc.
const EXCLUDE_WHOLE_WORDS = ["ml", "vp"];

function shouldIncludeTitle(title: string): boolean {
  const tl = title.toLowerCase();

  // Hard excludes always win — checked before include keywords
  for (const kw of EXCLUDE_SUBSTRINGS)  { if (tl.includes(kw))                     return false; }
  for (const kw of EXCLUDE_WHOLE_WORDS) { if (new RegExp(`\\b${kw}\\b`).test(tl)) return false; }

  // Must match at least one SWE keyword
  if (INCLUDE_KEYWORDS.some(kw => tl.includes(kw))) return true;

  // Bare "Engineer" / "Developer" with no qualifying keyword → exclude
  const stripped = tl
    .replace(/\b(senior|sr\.?|ii|iii|iv|2|3|4|junior|jr\.?)\b/gi, "")
    .trim();
  if (stripped === "engineer" || stripped === "developer") return false;

  return false;
}

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
  return raw.map(r => ({
    id:                  r.id,
    source:              r.source,
    company:             r.company.trim(),
    title:               r.title.trim(),
    location:            r.location || "United States",
    country:             "US",
    employment_type:     r.type || "Full-time",
    posted_at:           parsePostedAt(r.postedAt),
    description:         cleanDescription(r.description).slice(0, 1200),
    apply_url:           r.applyUrl,
    title_family:        null,
    sponsorship_status:  detectSponsorship(r.description),
    sponsorship_signals: null,
    fetched_at:          now,
    is_active:           true,
  }));
}

// ── Filter with per-filter counts ──────────────────────────────────────────
interface FilterStats {
  input: number; title_removed: number; type_removed: number;
  location_removed: number; clearance_removed: number; horizon_removed: number; output: number;
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
    location_removed, clearance_removed, horizon_removed, output: filtered.length } };
}

// ── Dedupe: ID first, then title+company+location ──────────────────────────
// Uses stable external job IDs as primary key.
// Cross-source dedup: title+company+location prevents same job from two APIs.
// Does NOT collapse same-company different-location/role jobs (that was the old bug).
function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const seenIds    = new Set<string>();
  const seenTLCKey = new Set<string>();
  return jobs.filter(j => {
    if (seenIds.has(j.id)) return false;
    seenIds.add(j.id);
    const key = `${j.title.toLowerCase().trim()}|||${j.company.toLowerCase().trim()}|||${j.location.toLowerCase().trim()}`;
    if (seenTLCKey.has(key)) return false;
    seenTLCKey.add(key);
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
  adzuna: 1000, jooble: 1000, playwright: 1500,
};
function applySourceCap(jobs: NormalizedJob[], source: string): NormalizedJob[] {
  return jobs.slice(0, SOURCE_STORE_CAPS[source] ?? 1000);
}

// ── Ingest pipeline ────────────────────────────────────────────────────────
async function ingestSource(
  source: RefreshSource,
  fetchFn: () => Promise<{ raw: RawJob[]; fetched: number; error: string | null }>,
  label: string
): Promise<{ raw: number; kept: number; stored: number; error: string | null; filterStats?: FilterStats }> {
  const startedAt = markRunning(label, source);
  try {
    const { raw: rawJobs, fetched, error: fetchErr } = await fetchFn();
    if (fetchErr) {
      markDone(label, source, startedAt, 0, 0, fetchErr);
      return { raw: 0, kept: 0, stored: 0, error: fetchErr };
    }
    const normalized          = normalizeJobs(rawJobs);
    const { filtered, stats } = filterJobsWithStats(normalized);
    const deduped             = dedupeJobs(filtered);
    const capped              = applySourceCap(deduped, source);
    const { stored, error: storeErr } = await storeJobs(capped);
    markDone(label, source, startedAt, fetched, capped.length, storeErr);
    console.log(`[refresh:${label}] raw=${fetched} norm=${normalized.length} title_drop=${stats.title_removed} loc_drop=${stats.location_removed} type_drop=${stats.type_removed} clearance_drop=${stats.clearance_removed} horizon_drop=${stats.horizon_removed} filtered=${filtered.length} deduped=${deduped.length} capped=${capped.length} stored=${stored}`);
    return { raw: fetched, kept: capped.length, stored, error: storeErr, filterStats: stats };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    markDone(label, source, startedAt, 0, 0, msg);
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
      if (!res.ok) break;
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
    } catch { break; }
  }
  return results;
}

async function fetchWorkdaySource(): Promise<{ raw: RawJob[]; fetched: number; error: string | null }> {
  const results: RawJob[] = [];
  const companies = getWorkdayConfigs(); // registry-driven
  const BATCH = 4;
  for (let i = 0; i < companies.length; i += BATCH) {
    const settled = await Promise.allSettled(
      companies.slice(i, i + BATCH).map(c => fetchWorkdayCompany(c.name, c.tenant, c.site, c.server))
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
    if (res.status === 429) { console.warn("[refresh] JSearch 429 rate_limited"); return { raw: [], fetched: 0, error: "rate_limited" }; }
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
const TIER_A_COMPANIES: Array<{ name: string; source: RefreshSource; fetcher: () => Promise<ScrapedJob[]> }> = [
  { name: "Microsoft",      source: "playwright_microsoft", fetcher: fetchMicrosoftJobs    },
  { name: "Google",         source: "playwright_google",    fetcher: fetchGoogleJobs       },
  { name: "Apple",          source: "playwright_apple",     fetcher: fetchAppleJobs        },
  { name: "Meta",           source: "playwright_meta",      fetcher: fetchMetaJobs         },
  { name: "Amazon",         source: "playwright_amazon",    fetcher: fetchAmazonJobs       },
  { name: "JPMorgan Chase", source: "playwright_jpmorgan",  fetcher: fetchJPMJobs          },
  { name: "Goldman Sachs",  source: "playwright_google",    fetcher: fetchGoldmanSachsJobs }, // Oracle HCM
  { name: "OpenAI",         source: "playwright_microsoft", fetcher: fetchOpenAIJobs       }, // Ashby
  { name: "Netflix",        source: "playwright_apple",     fetcher: fetchNetflixJobs      }, // Lever
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

// ── Route handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sourceFilter = (body.source as string) || "all";

  console.log(`[refresh] triggered source=${sourceFilter}`);
  const startMs = Date.now();
  const results: Record<string, unknown> = {};

  const run   = (s: string) => sourceFilter === "all" || sourceFilter === s;
  const tasks: Promise<void>[] = [];

  if (run("greenhouse")) tasks.push(ingestSource("greenhouse", fetchGreenhouseSource, "greenhouse").then(r => { results.greenhouse = r; }));
  if (run("workday"))    tasks.push(ingestSource("workday",    fetchWorkdaySource,    "workday"   ).then(r => { results.workday    = r; }));
  if (run("jsearch"))    tasks.push(ingestSource("jsearch",    fetchJSearchSource,    "jsearch"   ).then(r => { results.jsearch    = r; }));
  if (run("adzuna"))     tasks.push(ingestSource("adzuna",     fetchAdzunaSource,     "adzuna"    ).then(r => { results.adzuna     = r; }));
  if (run("jooble"))     tasks.push(ingestSource("jooble",     fetchJoobleSource,     "jooble"    ).then(r => { results.jooble     = r; }));

  if (run("playwright")) {
    tasks.push((async () => {
      const startedAt = markRunning("playwright_tier_a", "playwright_microsoft");
      try {
        const { raw, fetched, companyResults } = await fetchPlaywrightTierA();
        const normalized          = normalizeJobs(raw);
        const { filtered, stats } = filterJobsWithStats(normalized);
        const deduped             = dedupeJobs(filtered);
        const capped              = applySourceCap(deduped, "playwright");
        const { stored, error: storeErr } = await storeJobs(capped);
        markDone("playwright_tier_a", "playwright_microsoft", startedAt, fetched, capped.length, storeErr);
        console.log(`[refresh:playwright] raw=${fetched} title_drop=${stats.title_removed} loc_drop=${stats.location_removed} filtered=${filtered.length} deduped=${deduped.length} stored=${stored}`);
        results.playwright = { raw: fetched, kept: capped.length, stored, error: storeErr, companies: companyResults };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        markDone("playwright_tier_a", "playwright_microsoft", startedAt, 0, 0, msg);
        results.playwright = { raw: 0, kept: 0, stored: 0, error: msg };
      }
    })());
  }

  await Promise.allSettled(tasks);
  await deactivateStaleJobs();

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
}

export async function GET(req: NextRequest) { return POST(req); }

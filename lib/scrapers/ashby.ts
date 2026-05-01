// Ashby v2 — public posting-api job-board adapter, hardcoded tenant scope.
// Calls https://api.ashbyhq.com/posting-api/job-board/{slug}
// per tenant (sequentially), filters per-job, and dedupes globally by Ashby
// job UUID (which is globally unique across boards).
//
// API shape:
//   GET only — POST returns 401.
//   No pagination — one GET returns the full board.
//   Each job has: id (UUID), title, location (raw string),
//   descriptionPlain, descriptionHtml, jobPostingUrl, publishedAt.
//
// Filter parity with greenhouse.ts: shouldIncludeTitle + isUSLocation come
// from lib/jobUtils so the adapter and the downstream pipeline agree on what
// counts as a SWE-IC role and what counts as a US location. Pass the raw
// `location` string straight through — the spec forbids any preprocessing,
// and structured country fields (address.postalAddress.addressCountry) are
// explicitly not used.

import { shouldIncludeTitle, isUSLocation } from "../jobUtils";
import { type AdapterDropCounts, type RejectedJobSample, pushSample } from "../diagnostics";

export interface AshbyAdapterResult {
  jobs:        ParsedAshbyJob[];
  diagnostics: AdapterDropCounts;
  http_errors: { tenant: string; status: number; message: string }[];
}

export interface ParsedAshbyJob {
  /** Stable adapter-prefixed ID. Format: `ashby-{slug}-{jobId}`. */
  id:          string;
  source:      "ashby";
  title:       string;
  company:     string;
  location:    string;
  /** Cleaned plain-text JD (descriptionPlain preferred; HTML stripped as fallback). */
  description: string;
  /** Public Ashby job URL. */
  apply_url:   string;
  /** ISO 8601 string from publishedAt — most reliable date field on Ashby. */
  posted_at:   string;
}

// ── Tunables ─────────────────────────────────────────────────────────────

// Confirmed-200 slugs probed prior to landing this adapter.
// Known dead tenant: `supabase` — its `location` strings are opaque region
// labels ("AMER", "Europe", "Remote") and its address fields are empty, so
// every job fails isUSLocation. Do not re-add without first confirming that
// at least one job's `location` survives the pipeline's location filter.
export const ASHBY_TENANTS = [
  "ramp",
  "benchling",
  "quora",
] as const;

const ASHBY_DISPLAY_NAMES: Record<string, string> = {
  ramp:      "Ramp",
  benchling: "Benchling",
  quora:     "Quora",
};

const ASHBY_MAX_AGE_DAYS    = 14;
const ASHBY_MIN_DESC_CHARS  = 200;
const ASHBY_REQUEST_TIMEOUT = 15_000;

// ── HTML → text helper ───────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Top-level fetcher ────────────────────────────────────────────────────

interface AshbyRawJob {
  id?:               string;
  title?:            string;
  location?:         string;
  descriptionPlain?: string;
  descriptionHtml?:  string;
  jobPostingUrl?:    string;
  publishedAt?:      string;
}

interface AshbyBoardResponse {
  jobs?: AshbyRawJob[];
}

export async function fetchAshbyJobs(): Promise<AshbyAdapterResult> {
  const out: ParsedAshbyJob[] = [];
  const seenJobIds = new Set<string>();
  const now = Date.now();
  const maxAgeMs = ASHBY_MAX_AGE_DAYS * 86_400_000;

  let tenants_attempted = 0;
  let tenants_ok        = 0;
  let tenants_failed    = 0;
  let total_fetched     = 0;
  let total_kept        = 0;
  let dropped_old       = 0;
  let dropped_no_date   = 0;
  let dropped_location  = 0;
  let dropped_title     = 0;
  let dropped_no_desc   = 0;
  let dropped_duplicate = 0;

  const adapterSamples: RejectedJobSample[] = [];
  const sampleCounts: Record<string, number> = {};
  const httpErrors: { tenant: string; status: number; message: string }[] = [];

  // Sequential — keeps log lines ordered and avoids surprising the upstream API.
  for (const tenant of ASHBY_TENANTS) {
    tenants_attempted++;
    const company = ASHBY_DISPLAY_NAMES[tenant] ?? tenant;
    let tenantFetched = 0;
    let tenantKept    = 0;
    let tenantDate    = 0;
    let tenantLoc     = 0;
    let tenantTitle   = 0;
    let tenantNoDesc  = 0;

    try {
      const res = await fetch(
        `https://api.ashbyhq.com/posting-api/job-board/${tenant}`,
        { signal: AbortSignal.timeout(ASHBY_REQUEST_TIMEOUT) },
      );
      if (!res.ok) {
        tenants_failed++;
        const msg = `HTTP ${res.status}`;
        console.log(`[ashby:${tenant}] ERROR: ${msg}`);
        httpErrors.push({ tenant, status: res.status, message: msg });
        continue;
      }
      const data = (await res.json()) as AshbyBoardResponse;
      const jobs = data.jobs ?? [];
      tenantFetched = jobs.length;
      total_fetched += tenantFetched;

      for (const j of jobs) {
        const jobIdStr = j.id ? String(j.id) : "";
        const title    = j.title ?? "";
        const locName  = j.location ?? "";
        const applyUrl = j.jobPostingUrl ?? "#";
        const publishedRaw = j.publishedAt ?? null;

        // (a) Date — publishedAt is the canonical Ashby timestamp.
        if (!publishedRaw) {
          dropped_no_date++; tenantDate++;
          pushSample(adapterSamples, sampleCounts, { title, company, location: locName, source: "ashby", reason: "date", stage: "adapter", url: applyUrl });
          continue;
        }
        const publishedTs = Date.parse(publishedRaw);
        if (!Number.isFinite(publishedTs)) {
          dropped_no_date++; tenantDate++;
          pushSample(adapterSamples, sampleCounts, { title, company, location: locName, source: "ashby", reason: "date", stage: "adapter", url: applyUrl });
          continue;
        }
        if (now - publishedTs > maxAgeMs) {
          dropped_old++; tenantDate++;
          pushSample(adapterSamples, sampleCounts, { title, company, location: locName, posted_at: publishedRaw, source: "ashby", reason: "date", stage: "adapter", url: applyUrl });
          continue;
        }

        // (b) Location — pass raw string. No structured country field allowed,
        // no recovery of "Remote - Multiple Locations" style placeholders.
        if (!isUSLocation(locName)) {
          dropped_location++; tenantLoc++;
          pushSample(adapterSamples, sampleCounts, { title, company, location: locName, source: "ashby", reason: "location", stage: "adapter", url: applyUrl });
          continue;
        }

        // (c) Title — same shouldIncludeTitle the pipeline uses.
        if (!shouldIncludeTitle(title)) {
          dropped_title++; tenantTitle++;
          pushSample(adapterSamples, sampleCounts, { title, company, location: locName, source: "ashby", reason: "title", stage: "adapter", url: applyUrl });
          continue;
        }

        // (d) Description — prefer descriptionPlain; fall back to stripping
        // descriptionHtml when plain is empty.
        let cleaned = (j.descriptionPlain ?? "").replace(/\s+/g, " ").trim();
        if (!cleaned) cleaned = stripHtml(j.descriptionHtml ?? "");
        if (cleaned.length < ASHBY_MIN_DESC_CHARS) {
          dropped_no_desc++; tenantNoDesc++;
          pushSample(adapterSamples, sampleCounts, { title, company, location: locName, source: "ashby", reason: "mapping", stage: "adapter", snippet: `desc_len=${cleaned.length}`, url: applyUrl });
          continue;
        }

        // (e) Global dedupe by Ashby job UUID.
        if (jobIdStr && seenJobIds.has(jobIdStr)) {
          dropped_duplicate++;
          pushSample(adapterSamples, sampleCounts, { title, company, location: locName, source: "ashby", reason: "duplicate", stage: "adapter", url: applyUrl });
          continue;
        }
        if (jobIdStr) seenJobIds.add(jobIdStr);

        out.push({
          id:          `ashby-${tenant}-${jobIdStr || Math.random().toString(36).slice(2)}`,
          source:      "ashby",
          title,
          company,
          location:    locName,
          description: cleaned,
          apply_url:   applyUrl,
          posted_at:   new Date(publishedTs).toISOString(),
        });
        tenantKept++;
        total_kept++;
      }
      tenants_ok++;
    } catch (e: unknown) {
      tenants_failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[ashby:${tenant}] ERROR: ${msg}`);
      continue;
    }

    console.log(
      `[ashby:${tenant}] fetched=${tenantFetched} ` +
      `dropped_date=${tenantDate} dropped_location=${tenantLoc} ` +
      `dropped_title=${tenantTitle} dropped_no_desc=${tenantNoDesc} kept=${tenantKept}`,
    );
  }

  console.log(`[ashby:summary] ${JSON.stringify({
    tenants_attempted, tenants_ok, tenants_failed,
    total_fetched, total_kept,
    dropped_old, dropped_no_date, dropped_location,
    dropped_title, dropped_no_desc, dropped_duplicate,
  })}`);

  const diagnostics: AdapterDropCounts = {
    fetched_from_api:       total_fetched,
    dropped_by_date:        dropped_old + dropped_no_date,
    dropped_by_location:    dropped_location,
    dropped_by_title:       dropped_title,
    dropped_by_sponsorship: 0,
    dropped_by_duplicate:   dropped_duplicate,
    dropped_by_mapping:     dropped_no_desc,
    samples:                adapterSamples,
  };
  return { jobs: out, diagnostics, http_errors: httpErrors };
}

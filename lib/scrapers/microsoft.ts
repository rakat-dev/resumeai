// Microsoft Careers — direct hit against the public PCSx search API +
// per-job Eightfold detail API for fresh requisitions. Replaces the legacy
// Playwright-based fetcher in lib/playwrightScrapers.ts which shipped empty
// descriptions.
//
// Endpoint reality vs. spec:
//   The spec (and Microsoft's user-facing docs) point at
//   `https://jobs.careers.microsoft.com/global/en/search?...` for the listing.
//   That URL returns HTTP 301 → `apply.careers.microsoft.com/?...` (the SPA
//   shell, not JSON). The actual JSON listing endpoint is at
//   `apply.careers.microsoft.com/api/pcsx/search`. Detail data is served by
//   `apply.careers.microsoft.com/api/apply/v2/jobs/{id}`. The spec's filter
//   rules / priority tiers / diagnostics still apply — only the URL host and
//   field names differ. The user-facing apply URL we store is still the
//   canonical `https://jobs.careers.microsoft.com/global/en/job/{displayId}`.
//
// Source name is intentionally "microsoft_v2" — the dispatch slot
// downstream stays put even though we no longer use Playwright. Keeping the
// name avoids a database migration for existing rows that already carry
// source="microsoft_v2".

import { shouldIncludeTitle, isUSLocation } from "../jobUtils";
import { type AdapterDropCounts, type RejectedJobSample, pushSample, SAMPLE_LIMIT } from "../diagnostics";

export interface MicrosoftAdapterResult {
  jobs:        ParsedMicrosoftJob[];
  diagnostics: AdapterDropCounts;
}

export type MicrosoftPriority = "high" | "medium" | "low" | "date_missing";

export interface ParsedMicrosoftJob {
  /** Stable adapter-prefixed ID. Format: `microsoft_v2-{numericId}`. */
  id:               string;
  source:           "microsoft_v2";
  title:            string;
  company:          string;          // always "Microsoft"
  location:         string;          // first US-anchored location, or "United States"
  /** First 500 chars of cleaned full JD — preview for card display. */
  description:      string;
  /** Full cleaned JD text (HTML stripped, whitespace normalised). */
  full_description: string;
  /** Public Microsoft Careers detail URL. */
  apply_url:        string;
  /** ISO 8601 string from postedTs; null when missing. */
  posted_at:        string | null;
  /** Freshness tier — drives detail-fetch eligibility and downstream sort. */
  priority:         MicrosoftPriority;
}

// ── Tunables ──────────────────────────────────────────────────────────────

const MS_QUERIES = [
  "software engineer",
  "backend engineer",
  "full stack engineer",
  "platform engineer",
  "cloud engineer",
  "devops engineer",
];

const MS_MAX_PAGES                = 5;
const MS_PAGE_SIZE                = 20;       // pcsx returns ~10/page; we still loop until cutoff
const MS_MAX_AGE_DAYS             = 14;
const MS_MAX_AGE_MS               = MS_MAX_AGE_DAYS * 86_400_000;
const MS_HIGH_PRIORITY_DAYS       = 3;
const MS_MEDIUM_PRIORITY_DAYS     = 7;
const MS_DETAIL_PRIORITY_DAYS     = 7;          // detail fetch only for HIGH+MEDIUM (≤7d)
const MS_SEARCH_REQUEST_TIMEOUT   = 15_000;
const MS_DETAIL_REQUEST_TIMEOUT   = 8_000;
const MS_DETAIL_CONCURRENCY       = 8;
const MS_TOTAL_RUN_BUDGET_MS      = 45_000;     // hard ceiling for the entire adapter
const MS_DESCRIPTION_PREVIEW_CHARS = 500;
const MS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36";
const MS_LISTING_URL    = "https://apply.careers.microsoft.com/api/pcsx/search";
const MS_DETAIL_API_URL = "https://apply.careers.microsoft.com/api/apply/v2/jobs";
// Apply URL base — used as fallback only. The canonical
// jobs.careers.microsoft.com/global/en/job/{id} URL 301s to apply.careers.microsoft.com/
// (the SPA root, not the job page) regardless of which numeric ID we plug in.
// The actual public job page is on apply.careers.microsoft.com under the
// `positionUrl` path returned by the search API. Always prefer that when present.
const MS_APPLY_HOST     = "https://apply.careers.microsoft.com";
const MS_APPLY_URL_BASE = "https://jobs.careers.microsoft.com/global/en/job";

// ── Listing response types ───────────────────────────────────────────────

interface MsListingPosition {
  id?:                    number;          // long numeric job ID (used in positionUrl)
  displayJobId?:          string;          // short atsJobId surfaced in URL bar
  name?:                  string;          // title
  locations?:             string[];        // verbose, e.g. "United States, Washington, Redmond"
  standardizedLocations?: string[];        // shortform, e.g. "Redmond, WA, US"
  postedTs?:              number;          // unix seconds
  positionUrl?:           string;          // path on apply.careers.microsoft.com — e.g. "/careers/job/1970393556753151"
}

interface MsListingResponse {
  status?: number;
  data?:   { positions?: MsListingPosition[] };
}

interface MsDetailResponse {
  id?:              number;
  job_description?: string;          // HTML
  posting_name?:    string;
  name?:            string;
  display_job_id?:  string;
  t_create?:        number;          // unix seconds
  t_update?:        number;          // unix seconds
}

// Title + location filters delegated to lib/jobUtils.ts (single source of
// truth — same shouldIncludeTitle / isUSLocation the pipeline runs).

function pickUSLocation(p: MsListingPosition): string | null {
  // Prefer the cleaner standardized location ("City, ST, US"); fall back
  // to the verbose locations[] entries.
  const candidates: string[] = [
    ...(p.standardizedLocations ?? []),
    ...(p.locations ?? []),
  ];
  for (const l of candidates) if (isUSLocation(l)) return l;
  return null;
}

// ── HTML → text helpers ──────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Listing-page fetcher ─────────────────────────────────────────────────

function buildSearchUrl(query: string, start: number): string {
  const params = new URLSearchParams({
    domain:   "microsoft.com",
    location: "United States",
    query,
    start:    String(start),
    sort_by:  "timestamp",
  });
  return `${MS_LISTING_URL}?${params}`;
}

async function fetchSearchPage(query: string, page: number): Promise<MsListingPosition[]> {
  try {
    const start = page * MS_PAGE_SIZE;
    const res = await fetch(buildSearchUrl(query, start), {
      headers: {
        "User-Agent": MS_USER_AGENT,
        "Accept":     "application/json",
      },
      signal: AbortSignal.timeout(MS_SEARCH_REQUEST_TIMEOUT),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as MsListingResponse;
    return data.data?.positions ?? [];
  } catch {
    return [];
  }
}

// ── Detail fetcher ───────────────────────────────────────────────────────

async function fetchJobDetail(jobId: string): Promise<MsDetailResponse | null> {
  try {
    const url = `${MS_DETAIL_API_URL}/${jobId}?domain=microsoft.com&pid=${jobId}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": MS_USER_AGENT,
        "Accept":     "application/json",
      },
      signal: AbortSignal.timeout(MS_DETAIL_REQUEST_TIMEOUT),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) return null;
    return (await res.json()) as MsDetailResponse;
  } catch {
    return null;
  }
}

// ── Concurrency helper with elapsed-time abort ───────────────────────────

async function detailMapWithBudget<T, U>(
  items: T[],
  limit: number,
  deadlineEpochMs: number,
  fn: (item: T) => Promise<U>,
): Promise<Array<U | undefined>> {
  const out: Array<U | undefined> = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (Date.now() > deadlineEpochMs) return;
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

// ── Priority assignment ──────────────────────────────────────────────────

function priorityForAge(ageDays: number | null): MicrosoftPriority {
  if (ageDays === null) return "date_missing";
  if (ageDays <= MS_HIGH_PRIORITY_DAYS)   return "high";
  if (ageDays <= MS_MEDIUM_PRIORITY_DAYS) return "medium";
  return "low";
}

// ── Top-level fetcher ────────────────────────────────────────────────────

export async function fetchMicrosoftJobs(): Promise<MicrosoftAdapterResult> {
  const startMs   = Date.now();
  const deadline  = startMs + MS_TOTAL_RUN_BUDGET_MS;
  const seenIds   = new Set<string>();
  const candidates: MsListingPosition[] = [];
  let totalFetched = 0;
  // Adapter-level diagnostics — populated at every drop site so the UI
  // can render full sample cards (title/company/location/url/posted_at).
  const adapterSamples: RejectedJobSample[] = [];
  const sampleCounts: Record<string, number> = {};
  let discarded_duplicate = 0;

  // Apply-URL builder shared by Phase 1 (duplicate samples) and Phase 4
  // (final ParsedMicrosoftJob assembly) so duplicate-drop sample cards
  // carry a real link.
  const buildApplyUrl = (p: MsListingPosition): string => {
    if (p.positionUrl) return `${MS_APPLY_HOST}${p.positionUrl}`;
    const idStr = String(p.id ?? "");
    return `${MS_APPLY_URL_BASE}/${p.displayJobId ?? idStr}`;
  };
  // Sample-friendly location: prefer the standardized "City, ST, US" form,
  // fall back to the verbose listing string. Used only for reject samples,
  // never for surviving rows (those go through pickUSLocation).
  const sampleLocation = (p: MsListingPosition): string =>
    p.standardizedLocations?.[0] ?? p.locations?.[0] ?? "United States";

  // ── Phase 1: paginated search across all queries ────────────────────
  for (const query of MS_QUERIES) {
    if (Date.now() > deadline) break;
    for (let page = 0; page < MS_MAX_PAGES; page++) {
      if (Date.now() > deadline) break;
      const positions = await fetchSearchPage(query, page);
      if (positions.length === 0) break;
      totalFetched += positions.length;
      let allOld = true;
      for (const p of positions) {
        if (typeof p.postedTs === "number") {
          const age = Date.now() - p.postedTs * 1000;
          if (age <= MS_MAX_AGE_MS) allOld = false;
        } else {
          // missing date — keep alive until later filter pass; do not let
          // it mark the page as "all old" since we have no signal.
          allOld = false;
        }
        const id = String(p.id ?? "");
        if (!id || seenIds.has(id)) {
          discarded_duplicate++;
          pushSample(adapterSamples, sampleCounts, {
            title: p.name ?? "",
            company: "Microsoft",
            location: sampleLocation(p),
            source: "microsoft_v2",
            reason: "duplicate",
            stage: "adapter",
            url: buildApplyUrl(p),
          });
          continue;
        }
        seenIds.add(id);
        candidates.push(p);
      }
      if (allOld) break;
    }
  }

  // ── Phase 2: filter candidates ──────────────────────────────────────
  // Per spec: missing posting date → KEEP with date_missing flag (low priority).
  // Old (>14d) → DISCARD.
  // Otherwise → KEEP, priority by age.
  let date_missing      = 0;
  let rejected_old      = 0;
  let rejected_title    = 0;
  let rejected_location = 0;

  interface Survivor {
    pos:      MsListingPosition;
    location: string;
    ageDays:  number | null;
    priority: MicrosoftPriority;
  }
  const survivors: Survivor[] = [];

  for (const p of candidates) {
    const title     = p.name ?? "";
    const company   = "Microsoft";
    const sampleLoc = sampleLocation(p);
    const apply_url = buildApplyUrl(p);
    let ageDays: number | null = null;
    if (typeof p.postedTs === "number") {
      ageDays = (Date.now() - p.postedTs * 1000) / 86_400_000;
    }
    const posted_at = typeof p.postedTs === "number"
      ? new Date(p.postedTs * 1000).toISOString()
      : undefined;
    if (ageDays !== null && ageDays > MS_MAX_AGE_DAYS) {
      rejected_old++;
      pushSample(adapterSamples, sampleCounts, {
        title, company, location: sampleLoc, posted_at,
        source: "microsoft_v2", reason: "date", stage: "adapter",
        url: apply_url,
      });
      continue;
    }
    if (!shouldIncludeTitle(title)) {
      rejected_title++;
      pushSample(adapterSamples, sampleCounts, {
        title, company, location: sampleLoc, posted_at,
        source: "microsoft_v2", reason: "title", stage: "adapter",
        url: apply_url,
      });
      continue;
    }
    const loc = pickUSLocation(p);
    if (!loc) {
      rejected_location++;
      pushSample(adapterSamples, sampleCounts, {
        title, company, location: sampleLoc, posted_at,
        source: "microsoft_v2", reason: "location", stage: "adapter",
        url: apply_url,
      });
      continue;
    }
    if (ageDays === null) date_missing++;
    survivors.push({
      pos:      p,
      location: loc,
      ageDays,
      priority: priorityForAge(ageDays),
    });
  }

  // ── Phase 3: detail fetch for HIGH + MEDIUM only (≤7d) ───────────────
  const detailEligible = survivors.filter(s =>
    s.ageDays !== null && s.ageDays <= MS_DETAIL_PRIORITY_DAYS,
  );
  let detail_attempted = 0;
  let detail_success   = 0;
  let detail_fail      = 0;
  const fullText = new Map<string, string>();   // numeric id → cleaned JD

  await detailMapWithBudget(detailEligible, MS_DETAIL_CONCURRENCY, deadline, async (s) => {
    detail_attempted++;
    const idStr = String(s.pos.id);
    const det   = await fetchJobDetail(idStr);
    if (!det || !det.job_description) { detail_fail++; return; }
    const text = htmlToText(det.job_description);
    if (text.length > 100) {
      detail_success++;
      fullText.set(idStr, text);
    } else {
      detail_fail++;
    }
  });

  // ── Phase 4: assemble ParsedMicrosoftJob[] ──────────────────────────
  const enriched: ParsedMicrosoftJob[] = survivors.map(s => {
    const numericId  = String(s.pos.id);
    const displayId  = s.pos.displayJobId ?? numericId;
    const fetched    = fullText.get(numericId);
    const fullJd     = fetched ?? "";
    // Prefer the API's positionUrl (a path like "/careers/job/197039...") on
    // apply.careers.microsoft.com — that's the public job page that actually
    // resolves. The /global/en/job/<id> form on jobs.careers.microsoft.com
    // 301s to the SPA root, which is the bug the user reported.
    const applyUrl = s.pos.positionUrl
      ? `${MS_APPLY_HOST}${s.pos.positionUrl}`
      : `${MS_APPLY_URL_BASE}/${displayId}`;
    return {
      id:               `microsoft_v2-${numericId}`,
      source:           "microsoft_v2",
      title:            s.pos.name ?? "",
      company:          "Microsoft",
      location:         s.location,
      description:      fullJd.slice(0, MS_DESCRIPTION_PREVIEW_CHARS),
      full_description: fullJd,
      apply_url:        applyUrl,
      posted_at:        typeof s.pos.postedTs === "number"
                          ? new Date(s.pos.postedTs * 1000).toISOString()
                          : null,
      priority:         s.priority,
    };
  });

  // ── Diagnostics log ─────────────────────────────────────────────────
  const tierCounts = enriched.reduce((acc, j) => {
    acc[j.priority] = (acc[j.priority] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(
    `[microsoft_v2] fetched=${totalFetched} deduped=${candidates.length} ` +
    `rejected_no_date=0 date_missing=${date_missing} ` +
    `rejected_old=${rejected_old} rejected_title=${rejected_title} ` +
    `rejected_location=${rejected_location} ` +
    `detail_attempted=${detail_attempted} detail_success=${detail_success} ` +
    `detail_fail=${detail_fail} kept=${enriched.length} ` +
    `tier_high=${tierCounts.high ?? 0} tier_medium=${tierCounts.medium ?? 0} ` +
    `tier_low=${tierCounts.low ?? 0} tier_date_missing=${tierCounts.date_missing ?? 0} ` +
    `elapsed_ms=${Date.now() - startMs}`,
  );

  const diagnostics: AdapterDropCounts = {
    fetched_from_api:       totalFetched,
    dropped_by_date:        rejected_old,
    dropped_by_location:    rejected_location,
    dropped_by_title:       rejected_title,
    dropped_by_sponsorship: 0,
    dropped_by_duplicate:   discarded_duplicate,
    dropped_by_mapping:     0,
    samples:                adapterSamples,
  };
  return { jobs: enriched, diagnostics };
}

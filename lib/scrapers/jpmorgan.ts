// JPMorgan Chase v2 — Oracle HCM REST API adapter
// (jpmc.fa.oraclecloud.com). Listing rows include just ShortDescriptionStr
// (~120 chars); the real JD body lives in ExternalDescriptionStr on the
// per-job DETAIL endpoint at:
//   /recruitingCEJobRequisitionDetails?finder=ById;Id={id},siteNumber=CX_1001
//
// US filter is mandatory inside the adapter — the listing's
// locationId=300000000149325 (US) is leaky; Singapore / India / UK rows
// surface even with the filter applied. The country fast-path uses Oracle
// HCM's PrimaryLocationCountry (ISO-2) before delegating to jobUtils for
// the location-string canonical parse.

import { shouldIncludeTitle, isUSLocation } from "../jobUtils";
import { type AdapterDropCounts } from "../diagnostics";

export interface JpmorganAdapterResult {
  jobs:        ParsedJpmorganJob[];
  diagnostics: AdapterDropCounts;
}

export type JpmPriority = "high" | "medium" | "low" | "date_missing";

export interface ParsedJpmorganJob {
  id:               string;             // `jpmorgan_v2-${reqId}`
  source:           "jpmorgan_v2";
  title:            string;
  company:          string;             // always "JPMorgan Chase"
  location:         string;
  description:      string;             // first 500 chars of full_description
  full_description: string;
  apply_url:        string;             // canonical Oracle HCM candidate URL
  posted_at:        string | null;      // ISO; null when missing
  priority:         JpmPriority;
}

// ── Tunables ─────────────────────────────────────────────────────────────

const MAX_QUERIES                = 5;
const MAX_PAGES_PER_QUERY        = 10;
const JPM_PAGE_SIZE              = 25;
const JPM_TIME_BUDGET_MS         = 45_000;
const JPM_MAX_AGE_DAYS           = 14;
const JPM_HIGH_PRIORITY_DAYS     = 3;
const JPM_MEDIUM_PRIORITY_DAYS   = 7;
const SEARCH_TIMEOUT_MS          = 12_000;
const DETAIL_TIMEOUT_MS          = 8_000;
const DETAIL_CONCURRENCY         = 6;
// Listing on average produces ~130 US-anchored survivors per refresh; cap at
// 200 so every survivor gets detail-fetched within the 45s elapsed budget.
// At concurrency 6 × ~400ms per call, 200 detail fetches finish in ~14s.
const MAX_DETAIL_FETCHES         = 200;
const DESCRIPTION_PREVIEW_CHARS  = 500;
const REJECT_SAMPLE_LIMIT        = 5;
const PAGE_FRESHNESS_STOP_RATIO  = 0.5;

const JPM_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36";

const JPM_SITE_NUMBER         = "CX_1001";
const JPM_US_LOCATION_ID      = "300000000149325";
const JPM_LISTING_BASE        = "https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions";
const JPM_DETAIL_BASE         = "https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails";
const JPM_APPLY_URL_BASE      = "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job";

const JPM_QUERIES = [
  "software development engineer",
  "software engineer",
  "backend engineer",
  "full stack engineer",
  "cloud engineer",
];

// Title filter delegated to jobUtils.shouldIncludeTitle (single source of
// truth — same canonical filter the pipeline runs).

// ── Location filter ──────────────────────────────────────────────────────

// Country fast-path: Oracle HCM's PrimaryLocationCountry is ISO-2 reliable.
// `country === "US"` short-circuits acceptance; any non-US country
// short-circuits rejection. Only when country is missing do we fall through
// to the canonical jobUtils.isUSLocation parse on the location string.
function isUSLocationJpm(loc: string, country: string | undefined): boolean {
  if (country === "US") return true;
  if (country && country !== "US") return false;
  if (!loc) return false;
  return isUSLocation(loc);
}

// ── Listing types ────────────────────────────────────────────────────────

interface JpmListingReq {
  Id?:                   string;
  Title?:                string;
  PostedDate?:           string;     // "2026-04-28" (date-only)
  PrimaryLocation?:      string;
  PrimaryLocationCountry?: string;
}

interface JpmListingResponse {
  items?: Array<{ requisitionList?: JpmListingReq[] }>;
}

interface JpmDetailResponse {
  items?: Array<{
    Id?:                          string;
    Title?:                       string;
    ExternalDescriptionStr?:      string;     // HTML
    ExternalResponsibilitiesStr?: string;
    ExternalQualificationsStr?:   string;
    CorporateDescriptionStr?:     string;
    OrganizationDescriptionStr?:  string;
    PostedDate?:                  string;
    ExternalPostedStartDate?:     string;
    PrimaryLocation?:             string;
    PrimaryLocationCountry?:      string;
  }>;
}

// ── Listing fetcher ──────────────────────────────────────────────────────

function buildListingUrl(query: string, offset: number): string {
  const finder =
    `findReqs;siteNumber=${JPM_SITE_NUMBER},` +
    "facetsList=LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS," +
    `limit=${JPM_PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC,` +
    `keyword=${encodeURIComponent(query)},locationId=${JPM_US_LOCATION_ID}`;
  return `${JPM_LISTING_BASE}?onlyData=true&expand=requisitionList.secondaryLocations,flexFieldsFacet.values&finder=${finder}`;
}

async function fetchListingPage(query: string, page: number): Promise<JpmListingReq[]> {
  try {
    const offset = page * JPM_PAGE_SIZE;
    const res = await fetch(buildListingUrl(query, offset), {
      headers: {
        "Accept":     "application/json",
        "User-Agent": JPM_USER_AGENT,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as JpmListingResponse;
    const items = data.items ?? [];
    return items.flatMap(i => i.requisitionList ?? []);
  } catch {
    return [];
  }
}

// ── Detail fetcher ───────────────────────────────────────────────────────

function buildDetailUrl(reqId: string): string {
  // Oracle HCM finder syntax: `?finder=ById;Id=<id>,siteNumber=<site>`
  return `${JPM_DETAIL_BASE}?finder=ById;Id=${encodeURIComponent(reqId)},siteNumber=${JPM_SITE_NUMBER}&expand=all`;
}

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

interface JpmDetailExtract {
  description: string;            // cleaned plain text JD
  postedAt:    string | null;     // ISO from ExternalPostedStartDate or PostedDate
}

async function fetchJobDetail(reqId: string): Promise<JpmDetailExtract | null> {
  try {
    const res = await fetch(buildDetailUrl(reqId), {
      headers: {
        "Accept":     "application/json",
        "User-Agent": JPM_USER_AGENT,
      },
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) return null;
    const data = (await res.json()) as JpmDetailResponse;
    const item = data.items?.[0];
    if (!item) return null;
    // Compose JD from External* fields, dropping the corporate boilerplate.
    const parts: string[] = [];
    if (item.ExternalDescriptionStr)      parts.push(htmlToText(item.ExternalDescriptionStr));
    if (item.ExternalResponsibilitiesStr) parts.push(htmlToText(item.ExternalResponsibilitiesStr));
    if (item.ExternalQualificationsStr)   parts.push(htmlToText(item.ExternalQualificationsStr));
    const description = parts.filter(s => s.length > 0).join("\n\n").trim();
    // Prefer ExternalPostedStartDate (ISO) when present; fall back to PostedDate.
    const dateRaw = item.ExternalPostedStartDate ?? item.PostedDate ?? null;
    const postedAt = dateRaw ? toIso(dateRaw) : null;
    return { description, postedAt };
  } catch {
    return null;
  }
}

function toIso(raw: string): string | null {
  // Oracle ships either "2026-04-28" or full ISO. Both Date.parse cleanly.
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function priorityForAge(ageDays: number | null): JpmPriority {
  if (ageDays === null) return "date_missing";
  if (ageDays <= JPM_HIGH_PRIORITY_DAYS)   return "high";
  if (ageDays <= JPM_MEDIUM_PRIORITY_DAYS) return "medium";
  return "low";
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

// ── Top-level fetcher ────────────────────────────────────────────────────

export async function fetchJpmorganJobs(): Promise<JpmorganAdapterResult> {
  const startMs   = Date.now();
  const deadline  = startMs + JPM_TIME_BUDGET_MS;

  type Survivor = {
    raw:       JpmListingReq;
    location:  string;
    listingTs: number | null;
    ageDays:   number | null;
    priority:  JpmPriority;
  };

  const seen      = new Set<string>();
  const survivors: Survivor[] = [];
  let totalFetched          = 0;
  let pages_scanned         = 0;
  let queries_used          = 0;
  let discarded_old_date    = 0;
  let discarded_no_date     = 0;
  let discarded_title       = 0;
  let discarded_location    = 0;
  let discarded_duplicate   = 0;
  let stoppedReason: "normal" | "budget_exceeded" = "normal";
  const rejectSamples: Record<string, Array<{ title: string; reason: string }>> = {
    discarded_old_date:  [],
    discarded_no_date:   [],
    discarded_title:     [],
    discarded_location:  [],
  };
  const pushSample = (bucket: string, title: string, reason: string) => {
    const arr = rejectSamples[bucket];
    if (arr && arr.length < REJECT_SAMPLE_LIMIT) arr.push({ title, reason });
  };

  // ── Phase 1: paginated listing across all queries ───────────────────
  queryLoop: for (const query of JPM_QUERIES.slice(0, MAX_QUERIES)) {
    if (Date.now() > deadline) { stoppedReason = "budget_exceeded"; break; }
    queries_used++;
    for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
      if (Date.now() > deadline) { stoppedReason = "budget_exceeded"; break queryLoop; }
      const rawPage = await fetchListingPage(query, page);
      if (rawPage.length === 0) break;
      pages_scanned++;
      totalFetched += rawPage.length;
      let pageOutOfWindow = 0;

      for (const r of rawPage) {
        const reqId = r.Id;
        if (!reqId) { discarded_duplicate++; continue; }
        if (seen.has(reqId)) { discarded_duplicate++; continue; }
        const title = r.Title ?? "";
        const listingTs = r.PostedDate ? Date.parse(r.PostedDate) : NaN;
        const ageDays = Number.isFinite(listingTs)
          ? (Date.now() - listingTs) / 86_400_000
          : null;
        // Reject jobs with no parseable PostedDate up front (matches refresh
        // route's null-date filter — meta is the only allowed exception).
        if (ageDays === null) {
          discarded_no_date++;
          pushSample("discarded_no_date", title, `raw="${r.PostedDate ?? ""}"`);
          pageOutOfWindow++;
          continue;
        }
        if (ageDays > JPM_MAX_AGE_DAYS) {
          discarded_old_date++;
          pushSample("discarded_old_date", title, `age=${ageDays.toFixed(1)}d`);
          pageOutOfWindow++;
          continue;
        }
        if (!shouldIncludeTitle(title)) {
          discarded_title++;
          pushSample("discarded_title", title, "title rejected");
          continue;
        }
        const loc = r.PrimaryLocation ?? "United States";
        if (!isUSLocationJpm(loc, r.PrimaryLocationCountry)) {
          discarded_location++;
          pushSample("discarded_location", title, `loc="${loc}" country=${r.PrimaryLocationCountry ?? ""}`);
          continue;
        }
        seen.add(reqId);
        survivors.push({
          raw:       r,
          location:  loc,
          listingTs: Number.isFinite(listingTs) ? listingTs : null,
          ageDays,
          priority:  priorityForAge(ageDays),
        });
      }

      // Listing is sorted POSTING_DATES_DESC — once a majority of the page
      // is outside the window, deeper pages will be older. Stop this query.
      if (rawPage.length > 0 && pageOutOfWindow / rawPage.length >= PAGE_FRESHNESS_STOP_RATIO) break;
      if (rawPage.length < JPM_PAGE_SIZE) break;
    }
  }

  // ── Phase 2: detail fetch for ALL survivors ─────────────────────────
  // Listing payload only ships ShortDescriptionStr (~120 chars) — the full
  // ExternalDescriptionStr lives only on the detail endpoint, so detail
  // fetch is mandatory regardless of priority. Cap at MAX_DETAIL_FETCHES,
  // sorted by ageDays asc so the freshest jobs win the budget.
  const detailEligible = survivors
    .slice()
    .sort((a, b) => (a.ageDays ?? 999) - (b.ageDays ?? 999))
    .slice(0, MAX_DETAIL_FETCHES);

  let detail_attempted = 0;
  let detail_success   = 0;
  let detail_fail      = 0;
  const fullText = new Map<string, string>();          // reqId → cleaned JD
  const detailDate = new Map<string, string>();        // reqId → ISO from detail (preferred)

  await detailMapWithBudget(detailEligible, DETAIL_CONCURRENCY, deadline, async (s) => {
    detail_attempted++;
    const reqId = s.raw.Id!;
    const det = await fetchJobDetail(reqId);
    if (!det || det.description.length < 200) { detail_fail++; return; }
    detail_success++;
    fullText.set(reqId, det.description);
    if (det.postedAt) detailDate.set(reqId, det.postedAt);
  });
  if (Date.now() > deadline) stoppedReason = "budget_exceeded";

  // ── Phase 3: assemble output ────────────────────────────────────────
  const out: ParsedJpmorganJob[] = survivors.map(s => {
    const reqId = s.raw.Id!;
    const fullJd = fullText.get(reqId) ?? "";
    // Prefer the detail's ExternalPostedStartDate (more reliable) over the
    // listing's PostedDate; fall back to listing if detail didn't ship a date.
    const postedAt = detailDate.get(reqId)
      ?? (s.listingTs !== null ? new Date(s.listingTs).toISOString() : null);
    return {
      id:               `jpmorgan_v2-${reqId}`,
      source:           "jpmorgan_v2",
      title:            s.raw.Title ?? "",
      company:          "JPMorgan Chase",
      location:         s.location,
      description:      fullJd.slice(0, DESCRIPTION_PREVIEW_CHARS),
      full_description: fullJd,
      apply_url:        `${JPM_APPLY_URL_BASE}/${reqId}`,
      posted_at:        postedAt,
      priority:         s.priority,
    };
  });

  // ── Diagnostics log ────────────────────────────────────────────────
  const tierCounts = out.reduce((acc, j) => {
    acc[j.priority] = (acc[j.priority] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(
    `[jpmorgan_v2] queries=${queries_used} pages_scanned=${pages_scanned} ` +
    `totalFetched=${totalFetched} ` +
    `discarded_old_date=${discarded_old_date} discarded_no_date=${discarded_no_date} ` +
    `discarded_title=${discarded_title} discarded_location=${discarded_location} ` +
    `discarded_duplicate=${discarded_duplicate} ` +
    `detail_attempted=${detail_attempted} detail_success=${detail_success} detail_fail=${detail_fail} ` +
    `kept=${out.length} ` +
    `tier_high=${tierCounts.high ?? 0} tier_medium=${tierCounts.medium ?? 0} ` +
    `tier_low=${tierCounts.low ?? 0} tier_date_missing=${tierCounts.date_missing ?? 0} ` +
    `elapsed_ms=${Date.now() - startMs} stoppedReason=${stoppedReason}`,
  );
  for (const [bucket, samples] of Object.entries(rejectSamples)) {
    if (samples.length === 0) continue;
    for (const s of samples) {
      console.log(`[jpmorgan_v2:${bucket}] title="${s.title}" reason="${s.reason}"`);
    }
  }

  const diagnostics: AdapterDropCounts = {
    fetched_from_api:       totalFetched,
    dropped_by_date:        discarded_old_date + discarded_no_date,
    dropped_by_location:    discarded_location,
    dropped_by_title:       discarded_title,
    dropped_by_sponsorship: 0,
    dropped_by_duplicate:   discarded_duplicate,
    dropped_by_mapping:     0,
    samples: [
      ...rejectSamples.discarded_old_date.map(s => ({
        title: s.title, source: "jpmorgan_v2" as const, reason: "date" as const, stage: "adapter" as const, snippet: s.reason,
      })),
      ...rejectSamples.discarded_no_date.map(s => ({
        title: s.title, source: "jpmorgan_v2" as const, reason: "date" as const, stage: "adapter" as const,
      })),
      ...rejectSamples.discarded_title.map(s => ({
        title: s.title, source: "jpmorgan_v2" as const, reason: "title" as const, stage: "adapter" as const,
      })),
      ...rejectSamples.discarded_location.map(s => ({
        title: s.title, source: "jpmorgan_v2" as const, reason: "location" as const, stage: "adapter" as const, snippet: s.reason,
      })),
    ],
  };
  return { jobs: out, diagnostics };
}

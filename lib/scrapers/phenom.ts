// ── Phenom People careers adapter ──────────────────────────────────────────
// Direct scrape of Phenom-hosted careers sites (e.g. jobs.cvshealth.com).
// One adapter, parameterized per tenant. Returns ground-truth-accurate counts
// and real Workday/ATS apply URLs — no Adzuna geo-fanout, no broken /land/ad/
// links, no duplicates from third-party feed re-scrapes.
//
// API contract captured live 2026-04-17 from jobs.cvshealth.com:
//   POST https://{hostname}/widgets
//   body: { refNum, ddoKey:"refineSearch", selected_fields:{country,category},
//           sort:{order:"desc",field:"postedDate"}, size, from, ... }
//   resp: { refineSearch: { totalHits, hits, data: { jobs: [...] } } }
//
// Shape of a single job (relevant fields only):
//   { title, reqId, jobSeqNo, city, state, country, multi_location,
//     postedDate (ISO), applyUrl (real cvshealth.wd1.myworkdayjobs.com URL),
//     descriptionTeaser, type, remote, category, subCategory }
//
// IMPORTANT: We pass selected_fields.category (e.g. "Innovation and Technology")
// instead of relying on the `keywords` field. Phenom's keyword search is
// narrower than category browse — for CVS, "software engineer" returns 67
// jobs but the IT category contains 215. Rahul's strict shouldIncludeTitle
// filter (in lib/jobUtils.ts) is then applied downstream by the refresh
// pipeline, so we don't need to pre-filter here.

import type { RefreshSource } from "@/app/api/jobs/types";

export interface PhenomTenantConfig {
  /** Display name to use in the `company` field of stored rows */
  company:  string;
  /** Phenom internal tenant code (e.g. "CVSCHLUS") — visible in widgets POST body */
  refNum:   string;
  /** Public hostname (e.g. "jobs.cvshealth.com") */
  hostname: string;
  /** Category facet to filter by (e.g. "Innovation and Technology") */
  category: string;
  /** Optional subcategory list (most tenants don't need this) */
  subCategories?: string[];
}

/** Raw shape returned from Phenom widgets endpoint */
interface PhenomJob {
  title?:           string;
  reqId?:           string;
  jobSeqNo?:        string;
  city?:            string;
  state?:           string;
  country?:         string;
  cityStateCountry?: string;
  location?:        string;
  multi_location?:  string[];
  postedDate?:      string;       // ISO format
  dateCreated?:     string;
  applyUrl?:        string;       // Real ATS apply URL (Workday, etc.)
  descriptionTeaser?: string;
  type?:            string;
  remote?:          string;
  category?:        string;
  subCategory?:     string;
}

/** Output shape — matches the RawJob interface in app/api/jobs/refresh/route.ts */
export interface PhenomScrapedJob {
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

const PAGE_SIZE   = 50;          // Phenom widgets max we observed cleanly
const MAX_PAGES   = 10;          // Hard cap = 500 jobs per tenant — plenty for CVS's 215
const FETCH_TIMEOUT_MS = 12_000;

/**
 * Fetch a single page from a Phenom tenant.
 * Throws on HTTP error so the caller can decide whether to retry / skip.
 */
async function fetchPhenomPage(
  config: PhenomTenantConfig,
  from:   number,
): Promise<{ jobs: PhenomJob[]; totalHits: number }> {
  const body = {
    sortBy:           "Most recent",
    subsearch:        "",
    from,
    jobs:             true,
    counts:           true,
    all_fields:       ["category", "subCategory", "country", "state", "city", "type", "remote", "businessUnit"],
    pageName:         "search-results",
    size:             PAGE_SIZE,
    clearAll:         false,
    jdsource:         "facets",
    isSliderEnable:   true,
    pageId:           "page10",
    siteType:         "external",
    keywords:         "",                                      // empty — we filter by category
    global:           true,
    selected_fields:  {
      country:  ["United States"],
      category: [config.category],
      ...(config.subCategories ? { subCategory: config.subCategories } : {}),
    },
    sort:             { order: "desc", field: "postedDate" },  // newest first
    locationData:     { sliderRadius: 50, aboveMaxRadius: true, LocationUnit: "miles" },
    s:                "1",
    lang:             "en_us",
    deviceType:       "desktop",
    country:          "us",
    refNum:           config.refNum,
    ddoKey:           "refineSearch",
  };

  const res = await fetch(`https://${config.hostname}/widgets`, {
    method:  "POST",
    headers: {
      "Content-Type":   "application/json",
      "Accept":         "application/json",
      "Accept-Language":"en-US",
      "User-Agent":     "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Both keys exist in the wild — refineSearch on direct calls,
  // eagerLoadRefineSearch on the initial page-load fetch.
  const root = data.refineSearch ?? data.eagerLoadRefineSearch ?? {};
  const jobs: PhenomJob[] = root?.data?.jobs ?? [];
  const totalHits: number = root?.totalHits ?? 0;
  return { jobs, totalHits };
}

/**
 * Build the location string from a Phenom job.
 * For multi-location postings, append "(+N more)" so the user sees the row
 * isn't tied to one geography. This is informational — the actual list of
 * locations is preserved in the source data, we just don't render it all.
 */
function buildLocation(j: PhenomJob): string {
  const parts: string[] = [];
  if (j.city)    parts.push(j.city);
  if (j.state)   parts.push(j.state);
  // Only append country if we have city/state to anchor it
  if (j.country && parts.length > 0) parts.push(j.country);
  let base = parts.join(", ") || j.cityStateCountry || j.location || "United States";

  // If multi-location, indicate it inline so the user knows
  const multiCount = j.multi_location?.length ?? 1;
  if (multiCount > 1) {
    base = `${base} (+${multiCount - 1} more)`;
  }
  return base;
}

/**
 * Stable ID for a Phenom job. Prefers reqId (Workday requisition number,
 * shape "R0843852") which is Phenom's most stable identifier across refreshes.
 * Falls back to jobSeqNo (longer composite key like "CVSCHLUSR0843852EXTERNALENUS").
 * Last resort: hash of (company + title + city + posted).
 */
function buildId(j: PhenomJob, company: string): string {
  if (j.reqId)    return `ph-${company.toLowerCase().replace(/\s+/g, "-")}-${j.reqId}`;
  if (j.jobSeqNo) return `ph-${j.jobSeqNo.toLowerCase().slice(0, 60)}`;
  const fingerprint = [company, j.title, j.city, j.postedDate].join("|").slice(0, 80);
  return `ph-${fingerprint.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * Main entry point — fetch all relevant jobs from a Phenom tenant.
 * Paginates until we hit totalHits OR MAX_PAGES, whichever comes first.
 * No title filtering here — that happens in the refresh route's
 * filterJobsWithStats so the same shouldIncludeTitle rules apply
 * uniformly across every source.
 */
export async function fetchPhenomTenant(
  config: PhenomTenantConfig,
): Promise<PhenomScrapedJob[]> {
  const all: PhenomJob[] = [];
  let totalHits: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    try {
      const { jobs, totalHits: tH } = await fetchPhenomPage(config, from);
      if (totalHits === null) totalHits = tH;
      if (jobs.length === 0) break;
      all.push(...jobs);
      if (totalHits !== null && all.length >= totalHits) break;
    } catch (e) {
      // Mid-pagination failure: keep what we have rather than dropping the
      // entire tenant. Caller logs raw_count so partial results are visible.
      console.warn(`[phenom:${config.company}] page ${page} failed: ${(e as Error).message}`);
      break;
    }
  }

  console.log(
    `[phenom:${config.company}] fetched=${all.length} totalHits=${totalHits ?? "unknown"} ` +
    `category="${config.category}"`,
  );

  return all
    .filter(j => j.title)              // drop malformed rows
    .map(j => ({
      id:          buildId(j, config.company),
      source:      "phenom" as RefreshSource,
      company:     config.company,
      title:       j.title!,
      location:    buildLocation(j),
      description: j.descriptionTeaser ?? "",
      applyUrl:    j.applyUrl ?? `https://${config.hostname}`,
      postedAt:    j.postedDate ?? j.dateCreated ?? null,
      type:        j.type ?? "Full-time",
    }));
}

// ── Tenant registry ────────────────────────────────────────────────────────
// Add new Phenom-hosted companies here. Confirmed live 2026-04-17:
//   CVS Health → 215 IT jobs in US, real cvshealth.wd1.myworkdayjobs.com URLs
//
// To add another tenant, find its widgets POST body in DevTools and copy
// `refNum`. Common Phenom tenants to investigate next: T-Mobile (TMUS),
// AT&T (ATTUS), some healthcare giants. Each must be verified before enabling.
export const PHENOM_TENANTS: PhenomTenantConfig[] = [
  {
    company:  "CVS Health",
    refNum:   "CVSCHLUS",
    hostname: "jobs.cvshealth.com",
    category: "Innovation and Technology",
  },
];

/**
 * Convenience wrapper: fetch every enabled Phenom tenant in parallel.
 * Failures are isolated per tenant.
 */
export async function fetchAllPhenomTenants(): Promise<PhenomScrapedJob[]> {
  const settled = await Promise.allSettled(
    PHENOM_TENANTS.map(c => fetchPhenomTenant(c)),
  );
  const all: PhenomScrapedJob[] = [];
  settled.forEach(r => { if (r.status === "fulfilled") all.push(...r.value); });
  return all;
}

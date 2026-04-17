// ── Meta careers adapter (sitemap + JSON-LD) ───────────────────────────────
// Direct scrape of metacareers.com via the public sitemap and per-job
// schema.org JobPosting JSON-LD blocks. Replaces the broken playwright_meta
// scraper (HTTP 400) and the 89%-duplicate Adzuna fallback.
//
// Why this approach (not GraphQL):
//   Meta's www.metacareers.com/graphql endpoint requires a per-request
//   anti-replay token (jazoest, fb_dtsg, __req, rotating __hs* fields)
//   that can't be replayed server-side. Even an exact replay of a captured
//   POST body fails with `noncoercible_variable_value`. Captured 2026-04-17.
//
// Why this approach works:
//   1. https://www.metacareers.com/jobs/sitemap.xml lists every public
//      job posting URL (918 total observed 2026-04-17), no auth needed.
//   2. Each /profile/job_details/<id> page exposes a complete JobPosting
//      JSON-LD <script type="application/ld+json"> block: title, description,
//      responsibilities, qualifications, datePosted, validThrough,
//      employmentType, hiringOrganization, jobLocation (city/region/country),
//      directApply.
//
// Sitemap caveat:
//   Sitemap <lastmod> is regenerated daily for ALL entries — it does NOT
//   reflect the actual job postedDate. Cannot be used for early-stop or
//   freshness filtering. Real datePosted lives only in the JSON-LD inside
//   the per-job page. Therefore we MUST fetch every page in the sitemap
//   (or a reasonable cap) and filter downstream.
//
// Performance:
//   80 parallel fetches measured at ~1.0s total wall-time, ~500ms avg per
//   fetch (browser-side benchmark). At 30-wide concurrency from Vercel,
//   918 fetches should complete in 15-25s — comfortably inside the 60s
//   serverless function limit.
//
// Yield:
//   Sample of 80 jobs showed 78% US-based → est ~711 US jobs in the full
//   918. After shouldIncludeTitle filter (applied downstream by the refresh
//   pipeline), expected SWE-relevant yield: 150-250 jobs.

import type { RefreshSource } from "@/app/api/jobs/types";

/** Output shape — matches the RawJob interface in app/api/jobs/refresh/route.ts */
export interface MetaScrapedJob {
  id:            string;
  source:        RefreshSource;
  company:       string;
  title:         string;
  location:      string;
  description:   string;
  applyUrl:      string;
  postedAt:      null;           // Meta shows no date in their UI — treated as no-date source
  type:          string;
  positionRank:  number;         // 1-based sitemap order (relevance-ranked by Meta)
}

const SITEMAP_URL    = "https://www.metacareers.com/jobs/sitemap.xml";
const COMPANY_NAME   = "Meta";
const PAGE_TIMEOUT_MS = 15_000;
// Concurrency: 30 chosen empirically. Browser benchmark hit 80 parallel
// without rate-limiting from Meta's CDN; we go conservative on Vercel
// to avoid spurious 429s and to leave headroom for other refresh sources
// running in parallel.
const CONCURRENCY    = 30;
// Hard cap on jobs to fetch from sitemap. Sitemap has 918 entries; at 30-wide
// concurrency that's ~15-25s. If sitemap balloons (Meta hiring spree),
// this bounds the function execution time.
const MAX_SITEMAP_JOBS = 1200;

/** Raw shape of the JSON-LD JobPosting block on a Meta job page */
interface MetaJobPosting {
  title?:        string;
  description?:  string;
  responsibilities?: string;
  qualifications?:   string;
  datePosted?:   string;
  validThrough?: string;
  employmentType?: string;
  jobLocation?:  Array<{
    "@type"?: string;
    name?:    string;
    address?: {
      addressLocality?: string;
      addressRegion?:   string;
      addressCountry?:  string | string[] | { name?: string | string[] };
    };
  }>;
  directApply?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Recursively flatten Meta's quirky addressCountry shape.
 * Observed shapes: "USA" | ["USA"] | { name: "USA" } | { name: ["USA","USA","USA"] }
 * The duplicate-array shape is a Meta JSON-LD bug we work around.
 */
function extractCountries(addressCountry: unknown): string[] {
  if (!addressCountry) return [];
  if (typeof addressCountry === "string") return [addressCountry];
  if (Array.isArray(addressCountry)) return addressCountry.flatMap(extractCountries);
  if (typeof addressCountry === "object" && "name" in (addressCountry as Record<string, unknown>)) {
    return extractCountries((addressCountry as { name: unknown }).name);
  }
  return [];
}

function isUSCountry(c: string): boolean {
  return c === "USA" || c === "US" || c === "United States" || c === "United States of America";
}

/**
 * Build a single "City, State, US" string for the location field.
 * Meta jobs often have multi_location (e.g. "Sunnyvale, CA / Seattle, WA / NYC").
 * We pick the first US location for the primary string and append "(+N more)"
 * to indicate the role is available elsewhere too — matches the Phenom adapter
 * pattern. Filtering by isUSLocation downstream needs this string format.
 */
function buildLocation(jp: MetaJobPosting): string {
  const locs = jp.jobLocation ?? [];
  // Find first US-anchored location
  const usLocs = locs.filter(l => extractCountries(l?.address?.addressCountry).some(isUSCountry));
  const primary = usLocs[0] ?? locs[0];
  if (!primary) return "United States";

  const city  = primary.address?.addressLocality ?? "";
  const state = primary.address?.addressRegion ?? "";
  const parts = [city, state, "United States"].filter(Boolean);
  let base = parts.join(", ");

  // multi-location annotation
  const totalCount = locs.length;
  if (totalCount > 1) {
    base = `${base} (+${totalCount - 1} more)`;
  }
  return base || "United States";
}

/**
 * Stable per-job ID. Meta's job_id (numeric) is in the URL path and is
 * Meta's own canonical identifier — most stable across refreshes.
 * URL pattern: https://www.metacareers.com/profile/job_details/<JOB_ID>
 */
function extractJobId(url: string): string | null {
  const m = url.match(/\/job_details\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Extract the JSON-LD JobPosting block from a job detail page's HTML.
 * Returns null if missing or malformed (most pages have exactly one).
 */
function parseJobPostingJsonLd(html: string): MetaJobPosting | null {
  const m = html.match(/<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    // Some pages may wrap in @graph or be an array; tolerate both
    if (Array.isArray(parsed)) {
      return parsed.find(p => p?.["@type"] === "JobPosting") ?? null;
    }
    if (parsed?.["@type"] === "JobPosting") return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a MetaScrapedJob from a successfully-fetched job page.
 * Returns null if the job is non-US (we only ingest US jobs).
 */
function buildScrapedJob(url: string, jp: MetaJobPosting, rank: number): MetaScrapedJob | null {
  if (!jp.title) return null;

  // US filter — early. Saves DB writes downstream.
  const allCountries = (jp.jobLocation ?? []).flatMap(l => extractCountries(l?.address?.addressCountry));
  if (!allCountries.some(isUSCountry)) return null;

  const id = extractJobId(url);
  if (!id) return null;

  // Combine description + responsibilities + qualifications into one
  // descriptive blob. Each is plain text in Meta's JSON-LD.
  const descParts = [jp.description, jp.responsibilities, jp.qualifications].filter(Boolean) as string[];
  const description = descParts.join("\n\n");

  return {
    id:           `meta-${id}`,
    source:       "meta" as RefreshSource,
    company:      COMPANY_NAME,
    title:        jp.title,
    location:     buildLocation(jp),
    description,
    applyUrl:     url,                 // page IS the apply URL (directApply: true)
    postedAt:     null,                // Meta shows no date in UI — treated as no-date source
    type:         jp.employmentType ?? "Full-time",
    positionRank: rank,                // 1-based sitemap order
  };
}

/** Fetch + parse a single job detail page. Returns null on any failure. */
async function fetchAndParseJob(url: string, rank: number): Promise<MetaScrapedJob | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "Accept":         "text/html",
        "Accept-Language":"en-US",
        "User-Agent":     "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const jp = parseJobPostingJsonLd(html);
    if (!jp) return null;
    return buildScrapedJob(url, jp, rank);
  } catch {
    return null;
  }
}

/**
 * Fetch the sitemap and return all <loc> URLs.
 * Meta's sitemap is a flat <urlset> (not a sitemap-index). Single GET.
 */
async function fetchSitemapUrls(): Promise<string[]> {
  const res = await fetch(SITEMAP_URL, {
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    headers: { "Accept": "application/xml,text/xml,*/*" },
  });
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const xml = await res.text();
  const urls: string[] = [];
  const re = /<loc>(.*?)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const u = m[1].trim();
    // Defense: only accept job_details URLs. Sitemap is currently 100%
    // job_details, but this guards against Meta adding other entries.
    if (u.includes("/profile/job_details/")) urls.push(u);
  }
  return urls;
}

/**
 * Bounded-concurrency parallel map. We don't want a 3rd-party library
 * dependency — this 15-line implementation is enough.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Fetch all US Meta jobs from the public sitemap.
 *
 * No title filtering here — that happens in the refresh route's
 * filterJobsWithStats so the same shouldIncludeTitle rules apply uniformly
 * across every source. We only filter by country (US/non-US) to avoid
 * persisting 200 international jobs we're going to discard at filter time
 * anyway.
 */
export async function fetchMetaSitemapJobs(): Promise<MetaScrapedJob[]> {
  const t0 = Date.now();
  let urls: string[];
  try {
    urls = await fetchSitemapUrls();
  } catch (e) {
    console.warn(`[meta] sitemap fetch failed: ${(e as Error).message}`);
    return [];
  }

  const sitemapTotal = urls.length;
  if (urls.length > MAX_SITEMAP_JOBS) urls = urls.slice(0, MAX_SITEMAP_JOBS);

  const t1 = Date.now();
  const fetched = await mapWithConcurrency(
    urls.map((url, i) => ({ url, rank: i + 1 })),
    CONCURRENCY,
    ({ url, rank }) => fetchAndParseJob(url, rank),
  );
  const t2 = Date.now();

  const jobs = fetched.filter((j): j is MetaScrapedJob => j !== null);
  const fetchSucceeded = fetched.filter(j => j !== null).length;
  const fetchFailedOrNonUS = fetched.length - fetchSucceeded;

  console.log(
    `[meta] sitemap=${sitemapTotal} processed=${urls.length} ` +
    `kept_us=${jobs.length} dropped=${fetchFailedOrNonUS} ` +
    `(sitemap_ms=${t1 - t0} fetch_ms=${t2 - t1})`,
  );

  return jobs;
}

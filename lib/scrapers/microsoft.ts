// Microsoft Careers v2 adapter — direct hit against the public search API on
// jobs.careers.microsoft.com plus a per-job detail fetch to extract
// full_description from the SSR'd __NEXT_DATA__ blob. Replaces the legacy
// playwright_microsoft scraper which shipped empty descriptions and frequently
// timed out under Vercel's 60s function limit.

export interface ParsedMicrosoftJob {
  /** Stable adapter-prefixed ID. Format: `msv2-{numericId}`. */
  id:               string;
  /** Always "microsoft_v2". */
  source:           "microsoft_v2";
  /** Job title as posted by Microsoft. */
  title:            string;
  /** Always "Microsoft". */
  company:          string;
  /** First US location string from properties.locations. */
  location:         string;
  /** First 600 chars of cleaned full JD — used for card preview. */
  description:      string;
  /** Full cleaned JD text (HTML stripped, whitespace normalised). */
  full_description: string;
  /** Public Microsoft Careers detail URL. */
  apply_url:        string;
  /** ISO 8601 string parsed from the search-API postingDate field. */
  posted_at:        string;
}

const MICROSOFT_V2_QUERIES = [
  "software engineer",
  "backend engineer",
  "full stack engineer",
  "cloud engineer",
  "platform engineer",
];
const MICROSOFT_V2_MAX_PAGES        = 5;
const MICROSOFT_V2_PAGE_SIZE        = 20;
const MICROSOFT_V2_MAX_AGE_DAYS     = 14;
const MICROSOFT_V2_AGE_MS           = MICROSOFT_V2_MAX_AGE_DAYS * 86_400_000;
const MICROSOFT_V2_REQUEST_TIMEOUT  = 15_000;
const MICROSOFT_V2_DETAIL_TIMEOUT   = 12_000;
const MICROSOFT_V2_DETAIL_CONCURRENCY = 6;
const MICROSOFT_V2_DESCRIPTION_PREVIEW_CHARS = 600;
const MICROSOFT_V2_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36";
const MICROSOFT_V2_SEARCH_URL = "https://jobs.careers.microsoft.com/global/en/search";
const MICROSOFT_V2_DETAIL_URL = "https://jobs.careers.microsoft.com/global/en/job";

interface MicrosoftSearchJobItem {
  jobId:        number | string;
  title?:       string;
  postingDate?: string;
  properties?:  { locations?: string[] };
}

interface MicrosoftSearchResponse {
  operationResult?: {
    result?: {
      jobs?:      MicrosoftSearchJobItem[];
      totalJobs?: number;
    };
  };
}

function isEngineeringTitle(title: string): boolean {
  if (!title) return false;
  const tl = title.toLowerCase();
  if (/\b(manager|director|recruiter|hr|finance|legal|sales|marketing)\b/.test(tl)) return false;
  // Reject "principal" unless it's "principal engineer/developer/etc."
  if (/\bprincipal\b/.test(tl) && !/\bprincipal\s+(engineer|developer|architect|scientist|swe)\b/.test(tl)) return false;
  return /\b(engineer|developer|swe|architect|scientist)\b/.test(tl);
}

function isUSLocationToken(loc: string): boolean {
  if (!loc) return false;
  if (/united states|\bremote\b|\bus\b/i.test(loc)) return true;
  // State abbreviation pattern: ", XX" where XX is two uppercase letters.
  return /,\s*[A-Z]{2}\b/.test(loc);
}

function pickUSLocation(locs: string[] | undefined): string | null {
  if (!locs || locs.length === 0) return null;
  for (const l of locs) {
    if (isUSLocationToken(l)) return l;
  }
  return null;
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

function buildSearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    q:         query,
    l:         "en_us",
    pg:        String(page),
    pgSz:      String(MICROSOFT_V2_PAGE_SIZE),
    o:         "PostDate",
    "flt.lc":  "0x400D101",
  });
  return `${MICROSOFT_V2_SEARCH_URL}?${params}`;
}

async function fetchSearchPage(query: string, page: number): Promise<MicrosoftSearchJobItem[]> {
  try {
    const res = await fetch(buildSearchUrl(query, page), {
      headers: {
        "User-Agent": MICROSOFT_V2_USER_AGENT,
        "Accept":     "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(MICROSOFT_V2_REQUEST_TIMEOUT),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as MicrosoftSearchResponse;
    return data.operationResult?.result?.jobs ?? [];
  } catch {
    return [];
  }
}

function findDescriptionInNextData(payload: unknown): string | null {
  // BFS through __NEXT_DATA__ JSON looking for a job-description-shaped string.
  // Microsoft has changed the exact path between releases (jobDetails.description,
  // jobDescription, description, etc.) so probe broadly rather than hardcoding.
  const queue: unknown[] = [payload];
  const KEYS = ["description", "jobDescription", "responsibilities", "qualifications"];
  let bestLength = 0;
  let bestText: string | null = null;
  let visited = 0;
  while (queue.length > 0 && visited < 5000) {
    const node = queue.shift();
    visited++;
    if (!node || typeof node !== "object") continue;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "string" && KEYS.includes(k) && v.length > 80) {
        const text = htmlToText(v);
        if (text.length > bestLength) {
          bestLength = text.length;
          bestText = text;
        }
      } else if (v && typeof v === "object") {
        queue.push(v);
      }
    }
  }
  return bestText;
}

function findDescriptionInHtml(html: string): string | null {
  // Try a few well-known selectors first via regex; fall back to the largest
  // <div class="..."> block whose text content looks like a JD.
  const REGEXES: RegExp[] = [
    /<div[^>]*data-ph-at-id=["']job-description-text["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*job-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*id=["']job-description["'][^>]*>([\s\S]*?)<\/section>/i,
  ];
  for (const re of REGEXES) {
    const m = html.match(re);
    if (m && m[1]) {
      const text = htmlToText(m[1]);
      if (text.length > 200) return text;
    }
  }
  return null;
}

async function fetchJobDescription(jobId: string): Promise<string> {
  try {
    const res = await fetch(`${MICROSOFT_V2_DETAIL_URL}/${jobId}`, {
      headers: { "User-Agent": MICROSOFT_V2_USER_AGENT },
      signal:  AbortSignal.timeout(MICROSOFT_V2_DETAIL_TIMEOUT),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
    if (m && m[1]) {
      try {
        const json = JSON.parse(m[1]);
        const fromNext = findDescriptionInNextData(json);
        if (fromNext && fromNext.length > 200) return fromNext;
      } catch {
        // fall through to HTML extraction
      }
    }
    return findDescriptionInHtml(html) ?? "";
  } catch {
    return "";
  }
}

async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export async function fetchMicrosoftV2Jobs(): Promise<ParsedMicrosoftJob[]> {
  const seenIds = new Set<string>();
  const candidates: MicrosoftSearchJobItem[] = [];
  let totalFetched = 0;

  // 1. Search across queries, paginate until cutoff or page cap.
  for (const query of MICROSOFT_V2_QUERIES) {
    for (let page = 1; page <= MICROSOFT_V2_MAX_PAGES; page++) {
      const jobs = await fetchSearchPage(query, page);
      if (jobs.length === 0) break;
      totalFetched += jobs.length;
      let allOld = true;
      for (const j of jobs) {
        if (j.postingDate) {
          const age = Date.now() - new Date(j.postingDate).getTime();
          if (age <= MICROSOFT_V2_AGE_MS) allOld = false;
        }
        const id = String(j.jobId ?? "");
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        candidates.push(j);
      }
      if (allOld) break;
    }
  }

  // 2. Pre-detail filter: drop on missing date, age, title, location.
  let rejected_no_date  = 0;
  let rejected_old      = 0;
  let rejected_title    = 0;
  let rejected_location = 0;
  const survivors: Array<{ item: MicrosoftSearchJobItem; location: string }> = [];
  for (const j of candidates) {
    if (!j.postingDate) { rejected_no_date++; continue; }
    const age = Date.now() - new Date(j.postingDate).getTime();
    if (age > MICROSOFT_V2_AGE_MS) { rejected_old++; continue; }
    if (!j.title || !isEngineeringTitle(j.title)) { rejected_title++; continue; }
    const loc = pickUSLocation(j.properties?.locations);
    if (!loc) { rejected_location++; continue; }
    survivors.push({ item: j, location: loc });
  }

  // 3. Detail fetch for each survivor (concurrency-limited).
  let detail_fail = 0;
  const enriched = await mapWithConcurrency(survivors, MICROSOFT_V2_DETAIL_CONCURRENCY, async ({ item, location }) => {
    const jobId = String(item.jobId);
    const fullDescription = await fetchJobDescription(jobId);
    if (!fullDescription) detail_fail++;
    const parsed: ParsedMicrosoftJob = {
      id:               `msv2-${jobId}`,
      source:           "microsoft_v2",
      title:            item.title ?? "",
      company:          "Microsoft",
      location,
      description:      fullDescription.slice(0, MICROSOFT_V2_DESCRIPTION_PREVIEW_CHARS),
      full_description: fullDescription,
      apply_url:        `${MICROSOFT_V2_DETAIL_URL}/${jobId}`,
      posted_at:        new Date(item.postingDate as string).toISOString(),
    };
    return parsed;
  });

  console.log(
    `[microsoft_v2] fetched=${totalFetched} deduped=${candidates.length} ` +
    `rejected_no_date=${rejected_no_date} rejected_old=${rejected_old} ` +
    `rejected_title=${rejected_title} rejected_location=${rejected_location} ` +
    `detail_fail=${detail_fail} kept=${enriched.length}`,
  );
  return enriched;
}

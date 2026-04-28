// Amazon Careers v2 — direct API adapter against www.amazon.jobs/en/search.json
// (listing) plus per-job HTML detail fetch for the JD body. Replaces the legacy
// fetchAmazonJobsV2 in lib/playwrightScrapers.ts which had no global elapsed
// budget and was tripping Vercel's 60s function timeout.
//
// Strict limits (per refresh):
//   MAX_QUERIES                = 5
//   MAX_PAGES_PER_QUERY        = 10
//   AMAZON_TIME_BUDGET_MS      = 45_000  (full adapter)
//   MAX_DETAIL_FETCHES         = 60      (only the freshest jobs get JD)
//   DETAIL_CONCURRENCY         = 5
//   DETAIL_TIMEOUT_MS          = 5_000
//
// Freshness rule:
//   A job is VALID if posted_age ≤ 14d  OR  updated_age ≤ 14d.
//   Ranking uses the most-recent of (posted, updated).
//   Older than the 14-day window → discarded.
//   Priority tiers (most-recent age in days):
//     0–3   → HIGH
//     4–7   → MEDIUM
//     8–14  → LOW
//   Detail fetch only for HIGH+MEDIUM (≤7d).

export type AmazonPriority = "high" | "medium" | "low";

export interface ParsedAmazonJob {
  id:               string;             // `amazon_v2-${id_icims}`
  source:           "amazon_v2";
  title:            string;
  company:          string;             // always "Amazon"
  location:         string;
  description:      string;             // first 500 chars of full_description
  full_description: string;
  apply_url:        string;             // canonical https://www.amazon.jobs/en/jobs/{id}
  posted_at:        string;             // ISO of the most-recent of posted/updated
  priority:         AmazonPriority;
}

// ── Tunables ─────────────────────────────────────────────────────────────

const MAX_QUERIES                = 5;
const MAX_PAGES_PER_QUERY        = 10;
const AMAZON_PAGE_SIZE           = 10;
const AMAZON_TIME_BUDGET_MS      = 45_000;
const MAX_DETAIL_FETCHES         = 60;
const DETAIL_CONCURRENCY         = 5;
const DETAIL_TIMEOUT_MS          = 5_000;
const SEARCH_TIMEOUT_MS          = 12_000;
const AMAZON_MAX_AGE_DAYS        = 14;
const AMAZON_HIGH_PRIORITY_DAYS  = 3;
const AMAZON_MEDIUM_PRIORITY_DAYS = 7;
const DESCRIPTION_PREVIEW_CHARS  = 500;
const REJECT_SAMPLE_LIMIT        = 5;
const PAGE_FRESHNESS_STOP_RATIO  = 0.5;   // ≥50% of page outside window → stop paging this query
const AMAZON_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36";

const AMAZON_QUERIES = [
  "software development engineer",
  "software engineer",
  "backend engineer",
  "full stack engineer",
  "cloud engineer",
];

// Title filter — keep engineer/developer/swe/devops/sre + reject managers,
// directors, principals, interns etc. Same shape as Microsoft adapter.
const REJECT_TITLE_KEYWORDS = [
  "manager", "director", "principal", "staff engineer", "distinguished",
  "fellow", "intern", "apprentice", "data analyst", "data scientist",
  "product manager", "ux", "designer", "sales", "marketing", "finance",
  "recruiter", "support", "consultant", "attorney", "legal",
  "program manager", "project manager",
];
const KEEP_TITLE_KEYWORDS = [
  "engineer", "developer", "swe", "devops", "sre", "reliability",
];

function passesTitleFilter(title: string): boolean {
  if (!title) return false;
  const tl = title.toLowerCase();
  for (const r of REJECT_TITLE_KEYWORDS) if (tl.includes(r)) return false;
  for (const k of KEEP_TITLE_KEYWORDS) if (tl.includes(k)) return true;
  return false;
}

// Locations — Amazon's search is already scoped to the US via loc_query, so
// this is mostly defensive against the occasional non-US row Amazon mixes in.
const US_STATE_NAMES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
  "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
  "washington", "west virginia", "wisconsin", "wyoming",
  "district of columbia",
];
function isUSLocationToken(loc: string): boolean {
  if (!loc) return false;
  const ll = loc.toLowerCase();
  if (ll.includes("united states")) return true;
  if (ll.includes("remote")) return true;
  if (/,\s*[A-Z]{2}(,|$)/.test(loc)) return true;
  for (const s of US_STATE_NAMES) if (ll.includes(s)) return true;
  return false;
}

// ── Listing types ────────────────────────────────────────────────────────

interface AmznListingJob {
  id_icims?:            string;
  title?:               string;
  normalized_location?: string;
  city?:                string;
  description?:         string;
  description_short?:   string;
  posted_date?:         string;        // e.g. "April 27, 2026"
  updated_time?:        string;        // e.g. "about 2 hours" — relative
  job_schedule_type?:   string;
  employment_type?:     string;
}

interface AmznListingResponse {
  jobs?: AmznListingJob[];
}

// ── Date parsing ─────────────────────────────────────────────────────────
// Amazon ships posted_date as a parseable absolute string ("April 27, 2026")
// and updated_time as a relative string ("about 2 hours", "5 days",
// "3 weeks", "2 months"). We need both: the freshness rule says a job is
// valid if either is within the 14-day window.

function parsePostedDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function parseUpdatedTime(raw: string | undefined, now: number): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/just now|moments? ago|today/.test(s)) return now;
  const num = (re: RegExp): number | null => {
    const m = s.match(re);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  };
  const minutes = num(/(\d+)\s*minute/);
  if (minutes !== null) return now - minutes * 60_000;
  const hours = num(/(\d+)\s*hour/);
  if (hours !== null) return now - hours * 3_600_000;
  // "about 2 hours" / "an hour" / "about an hour" — treat as ~1 hour
  if (/about\s+an\s+hour|^an\s+hour/.test(s)) return now - 3_600_000;
  const days = num(/(\d+)\s*day/);
  if (days !== null) return now - days * 86_400_000;
  if (/yesterday/.test(s)) return now - 86_400_000;
  const weeks = num(/(\d+)\s*week/);
  if (weeks !== null) return now - weeks * 7 * 86_400_000;
  const months = num(/(\d+)\s*month/);
  if (months !== null) return now - months * 30 * 86_400_000;
  return null;
}

function priorityForAge(ageDays: number): AmazonPriority {
  if (ageDays <= AMAZON_HIGH_PRIORITY_DAYS)   return "high";
  if (ageDays <= AMAZON_MEDIUM_PRIORITY_DAYS) return "medium";
  return "low";
}

// ── Listing fetcher ──────────────────────────────────────────────────────

async function fetchListingPage(query: string, page: number): Promise<AmznListingJob[]> {
  const params = new URLSearchParams({
    base_query:   query,
    loc_query:    "United States",
    type:         "FULL_TIME",
    sort:         "recent",
    offset:       String(page * AMAZON_PAGE_SIZE),
    result_limit: String(AMAZON_PAGE_SIZE),
    format:       "json",
  });
  try {
    const res = await fetch(
      `https://www.amazon.jobs/en/search.json?${params}`,
      {
        headers: {
          "Accept":     "application/json",
          "User-Agent": AMAZON_USER_AGENT,
        },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as AmznListingResponse;
    return data.jobs ?? [];
  } catch {
    return [];
  }
}

// ── Detail fetcher (HTML scrape + clean) ─────────────────────────────────

const SIMILAR_JOBS_MARKERS = [
  "similar jobs", "similar job", "related jobs",
  "jobs you may like", "recommended jobs", "you might also like",
];
function trimAtSimilarJobs(text: string): string {
  const lower = text.toLowerCase();
  let cut = lower.length;
  for (const marker of SIMILAR_JOBS_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  return text.slice(0, cut).trim();
}

function buildAmazonCanonicalUrl(jobId: string): string {
  return `https://www.amazon.jobs/en/jobs/${jobId}`;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
          .replace(/&#?\w+;/g, " ");
}

function cleanAmazonJD(rawText: string): string {
  const text = rawText
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return trimAtSimilarJobs(text);
}

async function fetchAmazonDetail(jobId: string): Promise<string | null> {
  const url = buildAmazonCanonicalUrl(jobId);
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "Accept":     "text/html,application/xhtml+xml",
        "User-Agent": AMAZON_USER_AGENT,
      },
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  // Real JD lives inside <div id="job-detail-body"><div class="content">...</div></div>.
  // Picking the page-level "description" meta or first <p> grabs page chrome.
  const bodyIdx = html.indexOf('id="job-detail-body"');
  if (bodyIdx === -1) return null;
  const contentStart = html.indexOf('<div class="content">', bodyIdx);
  if (contentStart === -1) return null;
  let contentEnd = html.indexOf('addCriticalFeatureMarker', contentStart);
  if (contentEnd === -1 || contentEnd - contentStart > 30000) {
    contentEnd = contentStart + 30000;
  }
  const contentHtml = html.slice(contentStart, contentEnd);
  const sectionRe = /<div class="section"[^>]*>\s*<h2[^>]*>([^<]+)<\/h2>([\s\S]*?)<\/div>(?=\s*<div|\s*<\/div>|\s*<script>)/gi;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(contentHtml)) !== null) {
    const heading = decodeEntities(m[1].trim());
    const body = decodeEntities(
      m[2].replace(/<br\s*\/?>/gi, " ").replace(/<\/p>\s*<p[^>]*>/gi, " ").replace(/<[^>]+>/g, " "),
    ).replace(/\s+/g, " ").trim();
    if (body.length < 20) continue;
    parts.push(`${heading}\n${body}`);
  }
  if (parts.length === 0) return null;
  const combined = parts.join("\n\n").trim();
  return combined.length >= 200 ? combined : null;
}

// ── Sponsorship classifier (kept verbatim from legacy adapter) ───────────

function classifyAmazonSponsorship(cleanedJD: string): "not_supported" | "supported" | "unknown" {
  const text = cleanedJD.toLowerCase();
  const noSponsorPhrases = [
    "will not sponsor", "unable to sponsor", "cannot sponsor", "does not sponsor",
    "not able to sponsor", "sponsorship is not available", "sponsorship not available",
    "no sponsorship", "not provide sponsorship", "not offer sponsorship",
    "not support visa", "will not provide immigration", "not provide immigration",
  ];
  for (const phrase of noSponsorPhrases) if (text.includes(phrase)) return "not_supported";
  const yesSponsorPhrases = [
    "will sponsor", "able to sponsor", "visa sponsorship available",
    "sponsorship available", "sponsorship provided", "we sponsor",
    "offers sponsorship", "provide sponsorship", "immigration assistance",
  ];
  for (const phrase of yesSponsorPhrases) if (text.includes(phrase)) return "supported";
  return "unknown";
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

export async function fetchAmazonJobs(): Promise<ParsedAmazonJob[]> {
  const startMs  = Date.now();
  const deadline = startMs + AMAZON_TIME_BUDGET_MS;

  type Survivor = {
    raw:      AmznListingJob;
    location: string;
    bestTs:   number;             // most-recent of posted/updated, ms epoch
    ageDays:  number;
    priority: AmazonPriority;
  };

  const seen      = new Set<string>();
  const survivors: Survivor[] = [];
  let pages_scanned         = 0;
  let candidates_count      = 0;
  let rejected_old          = 0;
  let rejected_title        = 0;
  let rejected_location     = 0;
  let rejected_duplicate    = 0;
  let queries_used          = 0;
  let stoppedReason: "normal" | "budget_exceeded" = "normal";
  const rejectSamples: Record<string, Array<{ title: string; reason: string }>> = {
    rejected_old:      [],
    rejected_title:    [],
    rejected_location: [],
  };
  const pushSample = (bucket: string, title: string, reason: string) => {
    const arr = rejectSamples[bucket];
    if (arr && arr.length < REJECT_SAMPLE_LIMIT) arr.push({ title, reason });
  };

  // Phase 1 — collect survivors via paginated search.
  queryLoop: for (const query of AMAZON_QUERIES.slice(0, MAX_QUERIES)) {
    if (Date.now() > deadline) { stoppedReason = "budget_exceeded"; break; }
    queries_used++;
    for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
      if (Date.now() > deadline) { stoppedReason = "budget_exceeded"; break queryLoop; }
      const rawPage = await fetchListingPage(query, page);
      if (rawPage.length === 0) break;
      pages_scanned++;
      let pageOutOfWindow = 0;

      for (const raw of rawPage) {
        candidates_count++;
        const id = raw.id_icims;
        if (!id) { rejected_duplicate++; continue; }
        if (seen.has(id)) { rejected_duplicate++; continue; }
        const title = raw.title ?? "";
        const now = Date.now();
        const postedTs  = parsePostedDate(raw.posted_date);
        const updatedTs = parseUpdatedTime(raw.updated_time, now);
        const bestTs    = (postedTs !== null && updatedTs !== null)
          ? Math.max(postedTs, updatedTs)
          : (postedTs ?? updatedTs);
        // Discard if neither date parses (defensive — Amazon usually ships posted_date)
        // OR if the most-recent date is outside the 14-day window.
        if (bestTs === null) {
          rejected_old++;
          pushSample("rejected_old", title, "no_parseable_date");
          pageOutOfWindow++;
          continue;
        }
        const ageDays = (now - bestTs) / 86_400_000;
        if (ageDays > AMAZON_MAX_AGE_DAYS) {
          rejected_old++;
          pushSample("rejected_old", title, `age=${ageDays.toFixed(1)}d`);
          pageOutOfWindow++;
          continue;
        }
        if (!passesTitleFilter(title)) {
          rejected_title++;
          pushSample("rejected_title", title, "title rejected");
          continue;
        }
        const loc = raw.normalized_location ?? raw.city ?? "United States";
        if (!isUSLocationToken(loc)) {
          rejected_location++;
          pushSample("rejected_location", title, `loc="${loc}"`);
          continue;
        }
        seen.add(id);
        survivors.push({
          raw,
          location: loc,
          bestTs,
          ageDays,
          priority: priorityForAge(ageDays),
        });
      }

      // Amazon sorts by 'recent' — once a majority of the page is outside
      // the window, deeper pages will also be older. Stop this query.
      if (rawPage.length > 0 && pageOutOfWindow / rawPage.length >= PAGE_FRESHNESS_STOP_RATIO) break;
      if (rawPage.length < AMAZON_PAGE_SIZE) break;
    }
  }

  // Phase 2 — detail fetch for ≤7d (HIGH+MEDIUM) up to MAX_DETAIL_FETCHES.
  // Sorted by ageDays ascending so freshest jobs win the budget.
  const detailEligible = survivors
    .filter(s => s.ageDays <= AMAZON_MEDIUM_PRIORITY_DAYS)
    .sort((a, b) => a.ageDays - b.ageDays)
    .slice(0, MAX_DETAIL_FETCHES);

  let detail_attempted = 0;
  let detail_success   = 0;
  let detail_fail      = 0;
  let rejected_sponsorship = 0;
  const fullText = new Map<string, string>();         // id → cleaned JD

  await detailMapWithBudget(detailEligible, DETAIL_CONCURRENCY, deadline, async (s) => {
    detail_attempted++;
    const id = s.raw.id_icims!;
    const raw = await fetchAmazonDetail(id);
    if (!raw) { detail_fail++; return; }
    const cleaned = cleanAmazonJD(raw);
    if (cleaned.length < 200) { detail_fail++; return; }
    if (classifyAmazonSponsorship(cleaned) === "not_supported") {
      rejected_sponsorship++;
      return;
    }
    detail_success++;
    fullText.set(id, cleaned);
  });
  if (Date.now() > deadline) stoppedReason = "budget_exceeded";

  // Phase 3 — assemble output. Survivors without a detail-fetched JD ship
  // with the listing snippet (description / description_short) as a fallback.
  const out: ParsedAmazonJob[] = survivors.map(s => {
    const id = s.raw.id_icims!;
    const fetched = fullText.get(id);
    const fullJd  = fetched ?? cleanAmazonJD(s.raw.description ?? s.raw.description_short ?? "");
    return {
      id:               `amazon_v2-${id}`,
      source:           "amazon_v2",
      title:            s.raw.title ?? "",
      company:          "Amazon",
      location:         s.location,
      description:      fullJd.slice(0, DESCRIPTION_PREVIEW_CHARS),
      full_description: fullJd,
      apply_url:        buildAmazonCanonicalUrl(id),
      posted_at:        new Date(s.bestTs).toISOString(),
      priority:         s.priority,
    };
  });

  // ── Diagnostics log ────────────────────────────────────────────────
  const tierCounts = out.reduce((acc, j) => {
    acc[j.priority] = (acc[j.priority] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(
    `[amazon_v2] queries=${queries_used} pages_scanned=${pages_scanned} ` +
    `candidates=${candidates_count} ` +
    `rejected_old=${rejected_old} rejected_title=${rejected_title} ` +
    `rejected_location=${rejected_location} rejected_duplicate=${rejected_duplicate} ` +
    `detail_attempted=${detail_attempted} detail_success=${detail_success} ` +
    `detail_fail=${detail_fail} rejected_sponsorship=${rejected_sponsorship} ` +
    `kept=${out.length} ` +
    `tier_high=${tierCounts.high ?? 0} tier_medium=${tierCounts.medium ?? 0} ` +
    `tier_low=${tierCounts.low ?? 0} ` +
    `elapsed_ms=${Date.now() - startMs} stoppedReason=${stoppedReason}`,
  );
  for (const [bucket, samples] of Object.entries(rejectSamples)) {
    if (samples.length === 0) continue;
    for (const s of samples) {
      console.log(`[amazon_v2:${bucket}] title="${s.title}" reason="${s.reason}"`);
    }
  }

  return out;
}

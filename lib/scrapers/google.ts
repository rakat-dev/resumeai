// ── Google Careers v2 adapter ─────────────────────────────────────────────
// Direct scrape of www.google.com/about/careers/applications/jobs/results/.
// Replaces lib/playwrightScrapers.ts:fetchGoogleJobs which only reads the
// rendered DOM (titles + locations + URLs) and stores empty descriptions
// with no posted date — by also reading the AF_initDataCallback hydration
// payload that the same SSR page already embeds.
//
// Wiring into refresh/UI/AI is intentionally NOT done in this file (Step 1
// only); the source-tag wiring, ID-prefix migration, and configs land in
// a follow-up.
//
// ── Approach ──────────────────────────────────────────────────────────────
// 1. GET .../jobs/results/?q=…&location=United+States&sort_by=date&page=N
//    using a normal browser User-Agent. SSR HTML, 20 cards per page.
// 2. Find every `AF_initDataCallback(<arg>);` call by bracket-balancing
//    parens (string-aware so quoted parens don't truncate). The largest
//    arg (~120 KB, key='ds:1') carries the per-job data.
// 3. The arg is a JS object literal with UNQUOTED keys
//    ({key:'ds:1', hash:'1', data:[...], sideChannel:{}}) so JSON.parse
//    on the whole arg fails. We extract the `data:` value alone — it's
//    a pure JSON array — by bracket-balancing forward from the colon.
// 4. Walk the parsed object recursively to find the per-job tuple list.
//    Identification heuristic: array of arrays where each inner array has
//    a 16-18-digit numeric ID at index 0 and a string title at index 1.
//    No reliance on a hard-coded path; survives Google reordering wrappers.
// 5. Per tuple, read positional fields:
//      [ 0] numericId            (string, 18 digits)
//      [ 1] title                (string)
//      [ 2] applyUrl             (signed signin link with ?jobId=…)
//      [ 3] [null, responsibilitiesHtml]
//      [ 4] [null, qualificationsHtml]   // contains <h3>Minimum…</h3><h3>Preferred…</h3>
//      [ 5] tenant id            (string)
//      [ 6] null
//      [ 7] employer             ("Google")
//      [ 8] locale               ("en-US")
//      [ 9] [[locDisplay, addressLines[], city, postal, state, countryCode], …]
//      [10] [null, aboutHtml]    // main JD body + salary range
//      [11] [n, n, n]            // unknown small ints
//      [12] [createdSec, createdNs]
//      [13] [updatedASec, updatedANs]
//      [14] [updatedBSec, updatedBNs]
//      [15] [null, extraSalaryHtml]
//      …
// 6. Compose responsibilities + minimum quals + preferred quals + about/salary
//    HTML, then run the shared lib/ai/clean-job-description.ts cleaner over
//    it (same code path the AI enrich pipeline uses) so what we hand back
//    is already plain-text, deduped of EEO boilerplate, etc.
//
// ── Defensive fallback ────────────────────────────────────────────────────
// If the hydration parse fails for a page (no callback, missing data: value,
// JSON parse error, no tuple list found), the adapter logs
//   `[google_v2] page=N hydration_parse_failed reason=<msg>`
// and falls back to the legacy DOM regex parsers (titles, locations, hrefs).
// Fallback rows ship with description="" / full_description="" / posted_at=null
// so the failure is observable downstream rather than silently faked.

import { cleanJobDescription } from "@/lib/ai/clean-job-description";

// ── Public types ──────────────────────────────────────────────────────────

export interface ParsedGoogleJob {
  /** Stable adapter-prefixed ID. Format: `googv2-{numericId}`. */
  id:               string;
  /** Job title as posted by Google. */
  title:            string;
  /** Always "Google". */
  company:          string;
  /** Display string for the primary US location, e.g. "Sunnyvale, CA, USA". */
  location:         string;
  /** First 220 chars of the cleaned full JD — used for card preview. */
  description:      string;
  /** Full cleaned JD text (responsibilities + quals + about + salary). */
  full_description: string;
  /** Public Google Careers detail URL OR the embedded signin/apply URL. */
  apply_url:        string;
  /** ISO 8601 string from the hydration created timestamp; null if unknown. */
  posted_at:        string | null;
  /** Always undefined for v2 — we have real timestamps so no rank synthesis. */
  position_rank:    number | undefined;
  /** Raw 18-digit Google numeric job ID (without the `googv2-` prefix). */
  source_id:        string;
}

/** What `parseGoogleListingPage` returns. */
export interface ListingPageParseResult {
  jobs:               ParsedGoogleJob[];
  parseMethod:        "hydration" | "fallback";
  hydrationJobCount:  number;
}

// ── Tunables ──────────────────────────────────────────────────────────────

const GOOGLE_V2_DEFAULT_QUERIES = [
  "software engineer",
  "backend engineer",
  "frontend engineer",
];
const GOOGLE_V2_DEFAULT_MAX_PAGES = 15;
const GOOGLE_V2_PAGE_SIZE = 20;
const GOOGLE_V2_REQUEST_TIMEOUT_MS = 15_000;
const GOOGLE_V2_BASE = "https://www.google.com/about/careers/applications/jobs/results/";
const GOOGLE_V2_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36";
const GOOGLE_V2_DESCRIPTION_PREVIEW_CHARS = 220;

// ── Top-level fetcher ─────────────────────────────────────────────────────

export async function fetchGoogleV2Jobs(
  queries: string[] = GOOGLE_V2_DEFAULT_QUERIES,
  maxPages: number = GOOGLE_V2_DEFAULT_MAX_PAGES,
): Promise<ParsedGoogleJob[]> {
  const out: ParsedGoogleJob[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;
  let hydrationOk = 0;
  let hydrationFailed = 0;
  let fallbackJobCount = 0;
  let dupDropped = 0;
  let stopReason: "page_limit" | "no_results" | "fetch_error" = "page_limit";

  queryLoop: for (const query of queries) {
    for (let page = 1; page <= maxPages; page++) {
      const url = buildPageUrl(query, page);
      let html: string;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent":      GOOGLE_V2_USER_AGENT,
            "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(GOOGLE_V2_REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          console.warn(`[google_v2] q="${query}" page=${page} HTTP ${res.status} — stopping`);
          stopReason = "fetch_error";
          break queryLoop;
        }
        html = await res.text();
      } catch (e) {
        console.warn(`[google_v2] q="${query}" page=${page} fetch_error: ${(e as Error).message}`);
        stopReason = "fetch_error";
        break queryLoop;
      }

      pagesFetched += 1;
      const result = parseGoogleListingPage(html, page);
      if (result.parseMethod === "hydration") hydrationOk += 1;
      else { hydrationFailed += 1; fallbackJobCount += result.jobs.length; }

      let pageNew = 0;
      for (const j of result.jobs) {
        if (seenIds.has(j.id)) { dupDropped += 1; continue; }
        seenIds.add(j.id);
        out.push(j);
        pageNew += 1;
      }

      if (result.jobs.length === 0) {
        // Google paginates server-side — an empty page means the result set
        // is exhausted for this query.
        stopReason = "no_results";
        break;
      }
      if (result.jobs.length < GOOGLE_V2_PAGE_SIZE && pageNew === 0) {
        // Short page with no new jobs → no point paging further on this query.
        stopReason = "no_results";
        break;
      }
    }
  }

  console.log(
    `[google_v2] queries=${queries.length} pages=${pagesFetched} hydration_ok=${hydrationOk}` +
    ` hydration_failed=${hydrationFailed} fallback_jobs=${fallbackJobCount} dup_dropped=${dupDropped}` +
    ` total=${out.length} stop=${stopReason}`,
  );
  return out;
}

function buildPageUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    q:        query,
    location: "United States",
    sort_by:  "date",
    page:     String(page),
  });
  return `${GOOGLE_V2_BASE}?${params}`;
}

// ── Per-page parser (testable in isolation) ───────────────────────────────

export function parseGoogleListingPage(
  html: string,
  pageForLogging?: number,
): ListingPageParseResult {
  const hydration = parseHydration(html);
  if (hydration.ok) {
    const tuples = hydration.tuples;
    const jobs = tuples
      .map(tupleToParsedJob)
      .filter((j): j is ParsedGoogleJob => j !== null);
    return { jobs, parseMethod: "hydration", hydrationJobCount: tuples.length };
  }

  // Hydration parse failed — log loudly, then fall back to legacy DOM regex.
  const tag = pageForLogging !== undefined ? `page=${pageForLogging} ` : "";
  console.warn(`[google_v2] ${tag}hydration_parse_failed reason="${hydration.reason}"`);

  const fallbackJobs = parseRegexFallback(html);
  return { jobs: fallbackJobs, parseMethod: "fallback", hydrationJobCount: 0 };
}

// ── Hydration parser ──────────────────────────────────────────────────────

type HydrationResult =
  | { ok: true;  tuples: GoogleJobTuple[] }
  | { ok: false; reason: string };

type GoogleJobTuple = unknown[];

function parseHydration(html: string): HydrationResult {
  const calls = extractAfInitDataCalls(html);
  if (calls.length === 0) {
    return { ok: false, reason: "no_AF_initDataCallback" };
  }

  // Largest call carries the per-job data (the smaller call holds metadata).
  let largest = calls[0];
  for (const a of calls) if (a.length > largest.length) largest = a;
  if (largest.length < 50_000) {
    return { ok: false, reason: `largest_call_too_small_${largest.length}b` };
  }

  const dataJson = extractDataValue(largest);
  if (!dataJson) {
    return { ok: false, reason: "data_value_not_found" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataJson);
  } catch (e) {
    return { ok: false, reason: `data_json_parse: ${(e as Error).message}` };
  }

  const tuples = findJobTupleList(parsed);
  if (!tuples) {
    return { ok: false, reason: "tuple_list_not_found" };
  }
  return { ok: true, tuples };
}

/**
 * Extract every `AF_initDataCallback(<arg>)` call's inner arg from the page.
 * Bracket-balancing is string-aware so quoted parens don't truncate.
 */
function extractAfInitDataCalls(html: string): string[] {
  const out: string[] = [];
  const marker = "AF_initDataCallback(";
  let i = 0;
  while (true) {
    const p = html.indexOf(marker, i);
    if (p === -1) return out;
    const start = p + marker.length;
    let j = start;
    let depth = 0;
    let inStr: string | null = null;
    while (j < html.length) {
      const c = html[j];
      if (inStr !== null) {
        if (c === "\\" && j + 1 < html.length) { j += 2; continue; }
        if (c === inStr) inStr = null;
        j += 1; continue;
      }
      if (c === '"' || c === "'") { inStr = c; j += 1; continue; }
      if (c === "(") { depth += 1; j += 1; continue; }
      if (c === ")") {
        if (depth === 0) break;
        depth -= 1; j += 1; continue;
      }
      j += 1;
    }
    out.push(html.slice(start, j));
    i = j + 1;
  }
}

/**
 * Inside an `AF_initDataCallback` arg, find `data:` and slice out its
 * bracket-balanced array literal as a JSON string.
 */
function extractDataValue(arg: string): string | null {
  const idx = arg.indexOf("data:");
  if (idx === -1) return null;
  let v = idx + "data:".length;
  while (v < arg.length && (arg[v] === " " || arg[v] === "\t" || arg[v] === "\n")) v += 1;
  if (arg[v] !== "[") return null;
  const start = v;
  let depth = 0;
  let inStr: string | null = null;
  while (v < arg.length) {
    const c = arg[v];
    if (inStr !== null) {
      if (c === "\\" && v + 1 < arg.length) { v += 2; continue; }
      if (c === inStr) inStr = null;
      v += 1; continue;
    }
    if (c === '"') { inStr = c; v += 1; continue; }
    if (c === "[") { depth += 1; v += 1; continue; }
    if (c === "]") {
      depth -= 1;
      if (depth === 0) return arg.slice(start, v + 1);
      v += 1; continue;
    }
    v += 1;
  }
  return null;
}

/**
 * Walk the parsed `data` JSON to find the per-job tuple list. Heuristic:
 * an array of arrays where each inner array has a 16-18-digit numeric ID
 * at index 0 and a string title at index 1.
 */
function findJobTupleList(node: unknown): GoogleJobTuple[] | null {
  if (Array.isArray(node)) {
    if (node.length > 0 && node.every(isLikelyJobTuple)) return node;
    for (const child of node) {
      const found = findJobTupleList(child);
      if (found) return found;
    }
  }
  return null;
}

function isLikelyJobTuple(x: unknown): boolean {
  if (!Array.isArray(x) || x.length < 6) return false;
  const id    = x[0];
  const title = x[1];
  if (typeof id !== "string" || typeof title !== "string") return false;
  return /^\d{16,18}$/.test(id);
}

// ── Per-tuple → ParsedGoogleJob mapper ────────────────────────────────────

function tupleToParsedJob(t: GoogleJobTuple): ParsedGoogleJob | null {
  const numericId = stringAt(t, 0);
  const title     = stringAt(t, 1);
  if (!numericId || !title) return null;

  const applySigninUrl = stringAt(t, 2) ?? "";
  const respHtml       = nestedSecondString(t, 3);
  const qualsHtml      = nestedSecondString(t, 4);
  const aboutHtml      = nestedSecondString(t, 10);
  const extraHtml      = nestedSecondString(t, 15);

  const locations = readLocations(t, 9);
  const primary   = pickPrimaryLocation(locations);

  // [12] is the created timestamp; [14]/[13] are updates. Posted = created.
  const createdAt = readTimestamp(t, 12);

  // Direct detail URL — derived from numericId + slugified title to match
  // Google's own URL shape and the legacy scraper's link format.
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const detailUrl = `${GOOGLE_V2_BASE}${numericId}-${slug}`;

  const full_description = buildFullDescription(respHtml, qualsHtml, aboutHtml, extraHtml);

  return {
    id:               `googv2-${numericId}`,
    title,
    company:          "Google",
    location:         primary,
    description:      full_description.slice(0, GOOGLE_V2_DESCRIPTION_PREVIEW_CHARS),
    full_description,
    // Prefer the embedded signin/apply URL — that's what Google's "Apply"
    // button uses and it carries the encoded jobId. Falls back to the
    // public detail URL if signin link is missing.
    apply_url:        applySigninUrl || detailUrl,
    posted_at:        createdAt ? createdAt.toISOString() : null,
    position_rank:    undefined,
    source_id:        numericId,
  };
}

/**
 * Compose responsibilities + minimum quals + preferred quals + about/salary
 * HTML in priority order. Cleaning is delegated to lib/ai/clean-job-description
 * so the output already matches what the AI enrich pipeline expects.
 */
function buildFullDescription(
  resp:    string | null,
  quals:   string | null,
  about:   string | null,
  extra:   string | null,
): string {
  const parts: string[] = [];
  // Order: responsibilities → min quals → preferred quals → about/salary.
  // Quals already contain their own <h3>Minimum…</h3><h3>Preferred…</h3>
  // headers; we still emit explicit section labels for the others so the
  // downstream parseJobSections can recognise them via header markers.
  if (resp  && resp.trim().length  > 0) parts.push(`<h3>Responsibilities</h3>${resp}`);
  if (quals && quals.trim().length > 0) parts.push(quals);
  if (about && about.trim().length > 0) parts.push(`<h3>About the role</h3>${about}`);
  if (extra && extra.trim().length > 0) parts.push(extra);
  return cleanJobDescription(parts.join("\n\n"));
}

// ── Tuple field accessors ─────────────────────────────────────────────────

function stringAt(t: GoogleJobTuple, idx: number): string | null {
  const v = t[idx];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function nestedSecondString(t: GoogleJobTuple, idx: number): string | null {
  // Many fields use the shape [null, "<html>"]; pick the first non-empty
  // string element regardless of position.
  const v = t[idx];
  if (!Array.isArray(v)) return null;
  for (const x of v) {
    if (typeof x === "string" && x.length > 0) return x;
  }
  return null;
}

interface GoogleLocation {
  display:     string;
  countryCode: string | null;
}

function readLocations(t: GoogleJobTuple, idx: number): GoogleLocation[] {
  const arr = t[idx];
  if (!Array.isArray(arr)) return [];
  const out: GoogleLocation[] = [];
  for (const loc of arr) {
    if (!Array.isArray(loc) || loc.length === 0) continue;
    const display     = typeof loc[0] === "string" ? loc[0] : "";
    const countryCode = typeof loc[5] === "string" ? loc[5] : null;
    if (!display) continue;
    out.push({ display, countryCode });
  }
  return out;
}

function pickPrimaryLocation(locs: GoogleLocation[]): string {
  // Prefer first US-flagged location, then first listed, then a US default
  // so downstream isUSLocation can still pass on at-large postings that
  // happen to omit the country code.
  for (const l of locs) {
    if (l.countryCode === "US") return l.display;
  }
  if (locs.length > 0) return locs[0].display;
  return "United States";
}

function readTimestamp(t: GoogleJobTuple, idx: number): Date | null {
  const v = t[idx];
  if (!Array.isArray(v) || v.length === 0) return null;
  const sec = v[0];
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  return new Date(sec * 1000);
}

// ── Regex fallback ────────────────────────────────────────────────────────
// Mirrors the legacy parser in lib/playwrightScrapers.ts:fetchGoogleJobs.
// Used only when hydration parsing fails so a single bad page doesn't kill
// the run. Rows shipped here have description="" / full_description="" /
// posted_at=null — the caller logs `[google_v2] hydration_parse_failed` so
// the failure remains visible.

const FALLBACK_TITLE_RE    = /<h3\s+class="QJPWVe[^"]*">([^<]+)<\/h3>/g;
const FALLBACK_LOCATION_RE = /<span\s+class="r0wTof[^"]*">([^<]+)<\/span>/g;
const FALLBACK_HREF_RE     = /href="jobs\/results\/(\d+)-([a-z0-9-]+)/g;

function parseRegexFallback(html: string): ParsedGoogleJob[] {
  const titles    = [...html.matchAll(FALLBACK_TITLE_RE)].map(m => m[1].trim());
  const locations = [...html.matchAll(FALLBACK_LOCATION_RE)].map(m => m[1].trim());
  const seenHref = new Set<string>();
  const hrefs: Array<{ id: string; slug: string }> = [];
  for (const m of html.matchAll(FALLBACK_HREF_RE)) {
    const k = `${m[1]}-${m[2]}`;
    if (seenHref.has(k)) continue;
    seenHref.add(k);
    hrefs.push({ id: m[1], slug: m[2] });
  }
  const cardCount = Math.min(titles.length, hrefs.length);
  const out: ParsedGoogleJob[] = [];
  for (let i = 0; i < cardCount; i++) {
    const id   = hrefs[i].id;
    const slug = hrefs[i].slug;
    out.push({
      id:               `googv2-${id}`,
      title:            titles[i],
      company:          "Google",
      location:         locations[i] ?? "United States",
      description:      "",
      full_description: "",
      apply_url:        `${GOOGLE_V2_BASE}${id}-${slug}`,
      posted_at:        null,
      position_rank:    undefined,
      source_id:        id,
    });
  }
  return out;
}

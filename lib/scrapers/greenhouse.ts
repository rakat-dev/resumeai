// Greenhouse v2 — public boards-api adapter, hardcoded 10-tenant scope.
// Calls https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
// per tenant (sequentially, to avoid rate-limiting), filters per-job, and
// dedupes globally by Greenhouse job ID (which is globally unique across
// tenants).
//
// Title filter intentionally calls shouldIncludeTitle() from lib/jobUtils
// so the adapter and the downstream pipeline agree on what counts as a
// SWE-IC role. Previously the adapter's 4-keyword reject list was much
// weaker than the pipeline's shouldIncludeTitle, causing 89% of the
// 427 → 48 funnel loss to happen at the pipeline stage instead of inside
// the adapter where the per-tenant diagnostics could surface it.

import { shouldIncludeTitle, isUSLocation } from "../jobUtils";

export interface ParsedGreenhouseJob {
  /** Stable adapter-prefixed ID. Format: `gh-{slug}-{jobId}`. */
  id:               string;
  source:           "greenhouse";
  title:            string;
  company:          string;
  location:         string;
  /** Cleaned plain-text JD (HTML stripped, whitespace normalised). */
  description:      string;
  /** Public Greenhouse job URL. */
  apply_url:        string;
  /** ISO 8601 string from the most-recent of updated_at / first_published. */
  posted_at:        string;
}

// ── Tunables ─────────────────────────────────────────────────────────────

export const GREENHOUSE_TENANTS = [
  "stripe", "airbnb", "robinhood", "coinbase", "datadog",
  "plaid", "notion", "figma", "affirm", "flexport",
] as const;

const GREENHOUSE_DISPLAY_NAMES: Record<string, string> = {
  stripe:    "Stripe",
  airbnb:    "Airbnb",
  robinhood: "Robinhood",
  coinbase:  "Coinbase",
  datadog:   "Datadog",
  plaid:     "Plaid",
  notion:    "Notion",
  figma:     "Figma",
  affirm:    "Affirm",
  flexport:  "Flexport",
};

const GREENHOUSE_MAX_AGE_DAYS    = 14;
const GREENHOUSE_MIN_DESC_CHARS  = 200;
const GREENHOUSE_REQUEST_TIMEOUT = 15_000;

// ── isFullTime rejection logging (P5 audit, no behavior change) ──────────
// Mirrors isFullTime in app/api/jobs/refresh/route.ts so we can flag
// adapter-survivors that the pipeline's P5 filter will catch downstream.
// Logging only — these jobs still return from the adapter normally; the
// pipeline drops them. The point is to surface which Greenhouse JD
// preambles trip the contract/intern keyword check.
const FULL_TIME_REJECT_RE = /\bcontract(or)?\b|\bpart.?time\b|\bintern(ship)?\b|\bfreelance\b|\btemporary\b|\btemp\b/;

function wouldBeRejectedByPipelineIsFullTime(employmentType: string, descriptionPreview: string): boolean {
  // Pipeline call shape: isFullTime(employment_type, description) where
  // description is the 220-char preview slice produced by normalizeJobs.
  // The pipeline regex slices its input to 300 chars internally; with our
  // 220-char preview that's a no-op, so test against the full preview.
  return FULL_TIME_REJECT_RE.test((employmentType + " " + descriptionPreview.slice(0, 300)).toLowerCase());
}

function findContractSnippet(description: string): string {
  const text = description.slice(0, 300);
  const match = text.toLowerCase().match(FULL_TIME_REJECT_RE);
  if (!match || match.index === undefined) return "";
  const start = Math.max(0, match.index - 60);
  const end = Math.min(text.length, match.index + 120);
  return text.slice(start, end).replace(/\s+/g, " ").replace(/"/g, "'").trim();
}

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

interface GhRawJob {
  id?:              number | string;
  title?:           string;
  content?:         string;
  absolute_url?:    string;
  updated_at?:      string;
  first_published?: string;
  location?:        { name?: string } | null;
}

interface GhBoardResponse {
  jobs?: GhRawJob[];
}

export async function fetchGreenhouseJobs(): Promise<ParsedGreenhouseJob[]> {
  const out: ParsedGreenhouseJob[] = [];
  const seenJobIds = new Set<string>();
  const now = Date.now();
  const maxAgeMs = GREENHOUSE_MAX_AGE_DAYS * 86_400_000;

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

  // Sequential — don't trigger Greenhouse rate-limiting.
  for (const tenant of GREENHOUSE_TENANTS) {
    tenants_attempted++;
    const company = GREENHOUSE_DISPLAY_NAMES[tenant] ?? tenant;
    let tenantFetched = 0;
    let tenantKept    = 0;
    let tenantDate    = 0;
    let tenantLoc     = 0;
    let tenantTitle   = 0;
    let tenantNoDesc  = 0;

    try {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${tenant}/jobs?content=true`,
        { signal: AbortSignal.timeout(GREENHOUSE_REQUEST_TIMEOUT) },
      );
      if (!res.ok) {
        tenants_failed++;
        console.log(`[greenhouse:${tenant}] ERROR: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as GhBoardResponse;
      const jobs = data.jobs ?? [];
      tenantFetched = jobs.length;
      total_fetched += tenantFetched;

      for (const j of jobs) {
        const jobIdRaw = j.id;
        const jobIdStr = jobIdRaw != null ? String(jobIdRaw) : "";

        // (a) Date: effective_date = updated_at ?? first_published
        const updatedAt      = j.updated_at      ?? null;
        const firstPublished = j.first_published ?? null;
        const effectiveRaw   = updatedAt ?? firstPublished;
        if (!effectiveRaw) {
          dropped_no_date++; tenantDate++;
          continue;
        }
        const effectiveTs = Date.parse(effectiveRaw);
        if (!Number.isFinite(effectiveTs)) {
          dropped_no_date++; tenantDate++;
          continue;
        }
        if (now - effectiveTs > maxAgeMs) {
          dropped_old++; tenantDate++;
          continue;
        }

        // (b) Location — use the same isUSLocation the pipeline uses (single
        // source of truth, same shape as the title alignment with
        // shouldIncludeTitle).
        const locName = j.location?.name ?? "";
        if (!isUSLocation(locName)) {
          dropped_location++; tenantLoc++;
          continue;
        }

        // (c) Title — same function the pipeline uses, single source of truth.
        const title = j.title ?? "";
        if (!shouldIncludeTitle(title)) {
          dropped_title++; tenantTitle++;
          continue;
        }

        // (d) Description length on stripped text
        const cleaned = stripHtml(j.content ?? "");
        if (cleaned.length < GREENHOUSE_MIN_DESC_CHARS) {
          dropped_no_desc++; tenantNoDesc++;
          continue;
        }

        // (e) Global dedupe by Greenhouse job ID
        if (jobIdStr && seenJobIds.has(jobIdStr)) {
          dropped_duplicate++;
          continue;
        }
        if (jobIdStr) seenJobIds.add(jobIdStr);

        out.push({
          id:          `gh-${tenant}-${jobIdStr || Math.random().toString(36).slice(2)}`,
          source:      "greenhouse",
          title,
          company,
          location:    locName,
          description: cleaned,
          apply_url:   j.absolute_url ?? "#",
          posted_at:   new Date(effectiveTs).toISOString(),
        });
        tenantKept++;
        total_kept++;
      }
      tenants_ok++;
    } catch (e: unknown) {
      tenants_failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[greenhouse:${tenant}] ERROR: ${msg}`);
      continue;
    }

    console.log(
      `[greenhouse:${tenant}] fetched=${tenantFetched} ` +
      `dropped_date=${tenantDate} dropped_location=${tenantLoc} ` +
      `dropped_title=${tenantTitle} dropped_no_desc=${tenantNoDesc} kept=${tenantKept}`,
    );
  }

  // Logging-only audit pass for pipeline P5 (isFullTime). Surfaces adapter
  // survivors whose 220-char description preview will be rejected by the
  // pipeline's contract/intern keyword regex. Adapter does NOT drop these —
  // they're returned normally; the pipeline catches them downstream.
  let isFullTimeFlagged = 0;
  for (const j of out) {
    const preview = j.description.slice(0, 220);
    if (wouldBeRejectedByPipelineIsFullTime("Full-time", preview)) {
      isFullTimeFlagged++;
      const snippet = findContractSnippet(j.description);
      console.log(
        `[greenhouse:isFullTime_rejected] ` +
        `title="${j.title}" company="${j.company}" location="${j.location}" ` +
        `snippet="${snippet}"`,
      );
    }
  }

  console.log(`[greenhouse:summary] ${JSON.stringify({
    tenants_attempted, tenants_ok, tenants_failed,
    total_fetched, total_kept,
    dropped_old, dropped_no_date, dropped_location,
    dropped_title, dropped_no_desc, dropped_duplicate,
    isFullTime_flagged_for_pipeline: isFullTimeFlagged,
  })}`);

  return out;
}

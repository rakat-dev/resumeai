// ── Firecrawl refresh state store ────────────────────────────────────────
// Shared module — route.ts, refresh/route.ts, and refresh-status/route.ts
// all import from here. Because Next.js compiles all /api/jobs/** routes into
// the same serverless function bundle, they share the same module instance
// and therefore the same Map references at runtime.

export type RefreshStatus =
  | "never_run"       // no attempt yet this instance lifetime
  | "queued"          // scheduled, not yet started
  | "running"         // currently in-flight
  | "success"         // raw > 0 and kept > 0
  | "partial_success" // raw > 0 but kept == 0 (all filtered out)
  | "failed"          // HTTP error or network failure
  | "timeout"         // aborted by AbortController
  | "skipped";        // FIRECRAWL_API_KEY not set

export interface RefreshState {
  company:         string;
  source:          "firecrawl_tier_a" | "firecrawl_tier_b";
  status:          RefreshStatus;
  query:           string;
  filter:          string;
  started_at:      number | null;   // ms epoch
  finished_at:     number | null;
  duration_ms:     number | null;
  raw_count:       number | null;
  kept_count:      number | null;
  error_message:   string | null;
  last_success_at: number | null;
  last_attempt_at: number | null;
}

export interface RefreshRun {
  run_id:        string;
  company:       string;
  source:        "firecrawl_tier_a" | "firecrawl_tier_b";
  status:        RefreshStatus;
  query:         string;
  filter:        string;
  started_at:    number;
  finished_at:   number | null;
  duration_ms:   number | null;
  raw_count:     number | null;
  kept_count:    number | null;
  error_message: string | null;
}

// ── Shared Maps ────────────────────────────────────────────────────────────
// Single source of truth for all refresh state, shared across all imports.
export const REFRESH_STATE   = new Map<string, RefreshState>();
export const REFRESH_HISTORY: RefreshRun[] = [];
export const REFRESH_HISTORY_MAX = 200;

// ── Shared Firecrawl company job cache ────────────────────────────────────
// Keyed by `company:query:filter`.
// route.ts reads from this; refresh/route.ts writes to it via setCompanyCache.
export interface FcCacheEntry {
  jobs:   unknown[];
  raw:    number;
  ts:     number;
  filter: string;
}

export const FC_COMPANY_CACHE_STORE = new Map<string, FcCacheEntry>();

/** Called by the cron refresh endpoint to warm the cache for live searches. */
export function setCompanyCache(key: string, entry: FcCacheEntry): void {
  FC_COMPANY_CACHE_STORE.set(key, entry);
}

/** Called by route.ts to read the cache (replaces its local FC_COMPANY_CACHE). */
export function getCompanyCache(key: string): FcCacheEntry | undefined {
  return FC_COMPANY_CACHE_STORE.get(key);
}

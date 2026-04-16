// ── Firecrawl refresh state store ────────────────────────────────────────
// Shared module — both route.ts and refresh-status/route.ts import from here.
// Because Next.js compiles both into the same serverless function bundle,
// they share the same module instance and therefore the same Map references.

export type RefreshStatus =
  | "never_run"
  | "queued"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "timeout"
  | "skipped";

export interface RefreshState {
  company:         string;
  source:          "firecrawl_tier_a" | "firecrawl_tier_b";
  status:          RefreshStatus;
  query:           string;
  filter:          string;
  started_at:      number | null;
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

// Module-level Maps — single source of truth, shared across all imports
export const REFRESH_STATE   = new Map<string, RefreshState>();
export const REFRESH_HISTORY: RefreshRun[] = [];
export const REFRESH_HISTORY_MAX = 200;

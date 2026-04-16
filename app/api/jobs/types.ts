// ── Shared refresh types ───────────────────────────────────────────────────
// Imported by: refresh-store.ts, lib/redis.ts, app/api/jobs/route.ts,
//              app/api/jobs/refresh/route.ts, app/api/jobs/refresh-status/route.ts

export type RefreshStatus =
  | "never_run"
  | "queued"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "timeout"
  | "skipped"
  | "rate_limited";

export type RefreshSource =
  | "greenhouse"
  | "workday"
  | "jsearch"
  | "adzuna"
  | "jooble"
  | "playwright_microsoft"
  | "playwright_google"
  | "playwright_apple"
  | "playwright_meta"
  | "playwright_amazon"
  | "playwright_jpmorgan";

export interface RefreshState {
  company:         string;
  source:          RefreshSource;
  status:          RefreshStatus;
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
  source:        RefreshSource;
  status:        RefreshStatus;
  started_at:    number;
  finished_at:   number | null;
  duration_ms:   number | null;
  raw_count:     number | null;
  kept_count:    number | null;
  error_message: string | null;
}

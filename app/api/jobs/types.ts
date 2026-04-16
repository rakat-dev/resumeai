// ── Shared Firecrawl refresh types ────────────────────────────────────────
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

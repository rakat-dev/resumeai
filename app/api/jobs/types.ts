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
  | "phenom"                       // Phenom-People-hosted careers sites (CVS Health, etc.)
  | "meta"                         // Meta sitemap-based scrape (replaces broken playwright_meta)
  | "microsoft_v2"
  | "playwright_google"
  | "playwright_apple"
  | "playwright_jpmorgan"
  | "playwright_goldman"
  | "playwright_openai"
  | "playwright_meta"
  | "amazon_jobs"
  | "walmart_cxs"
  | "google_v2"                    // Google Careers SSR + AF_initDataCallback hydration parser (lib/scrapers/google.ts)
  // @deprecated — use company-specific playwright sources; source=playwright returns 400
  | "playwright";

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

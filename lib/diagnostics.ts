// ── Validator Observability — Diagnostics Data Model ─────────────────────
// In-memory store for the latest refresh diagnostics. Updated by the ingest
// pipeline and by adapter functions that do pre-filtering. Consumed by
// GET /api/jobs/diagnostics and the UI dashboard at /diagnostics.
//
// Only the LATEST refresh is kept. No DB table — pure in-memory singleton.

export type DropReason =
  | "date"
  | "location"
  | "title"
  | "sponsorship"
  | "fulltime"
  | "clearance"
  | "duplicate"
  | "mapping"
  | "http_error"
  | "unknown";

export interface RejectedJobSample {
  title?: string;
  company?: string;
  location?: string;
  posted_at?: string;
  source: string;
  reason: DropReason;
  stage: "adapter" | "pipeline";
  snippet?: string;
  url?: string;
}

// Counts returned by adapters that do their own pre-filtering.
export interface AdapterDropCounts {
  fetched_from_api:      number;
  dropped_by_date:       number;
  dropped_by_location:   number;
  dropped_by_title:      number;
  dropped_by_sponsorship:number;
  dropped_by_duplicate:  number;
  dropped_by_mapping:    number;
  samples: RejectedJobSample[];
}

export interface SourceDiagnostics {
  source: string;

  // Adapter funnel
  fetched:                number;
  mapped:                 number;

  dropped_by_date:        number;
  dropped_by_location:    number;
  dropped_by_title:       number;
  dropped_by_sponsorship: number;
  dropped_by_fulltime:    number;
  dropped_by_clearance:   number;
  dropped_by_duplicate:   number;
  dropped_by_mapping:     number;
  dropped_by_http_error:  number;

  adapter_kept: number;

  // Pipeline safety-net drops
  pipeline_title_drop:       number;
  pipeline_location_drop:    number;
  pipeline_date_drop:        number;
  pipeline_sponsorship_drop: number;
  pipeline_fulltime_drop:    number;
  pipeline_clearance_drop:   number;
  pipeline_duplicate_drop:   number;

  final_stored: number;

  rejected_samples: RejectedJobSample[];
  warnings:         string[];
  http_errors?: { tenant?: string; status?: number; url?: string; message?: string }[];
}

export interface LatestRefreshDiagnostics {
  refresh_started_at:   string;
  refresh_finished_at?: string;
  sources:              SourceDiagnostics[];
  global_warnings:      string[];
}

// ── In-memory store (latest run only) ────────────────────────────────────
let _latest: LatestRefreshDiagnostics | null = null;

export function startDiagnosticsRun(): void {
  _latest = { refresh_started_at: new Date().toISOString(), sources: [], global_warnings: [] };
}

export function upsertSourceDiagnostics(d: SourceDiagnostics): void {
  if (!_latest) return;
  _latest.sources = _latest.sources.filter(s => s.source !== d.source);
  _latest.sources.push(d);
}

export function finishDiagnosticsRun(): void {
  if (_latest) _latest.refresh_finished_at = new Date().toISOString();
}

export function getLatestDiagnostics(): LatestRefreshDiagnostics | null {
  return _latest;
}

// ── Sample helpers ────────────────────────────────────────────────────────
export const SAMPLE_LIMIT = 10;

/** Add a rejected sample, capped at SAMPLE_LIMIT per reason per stage. */
export function pushSample(
  samples: RejectedJobSample[],
  counts: Record<string, number>,
  s: RejectedJobSample,
): void {
  const key = `${s.stage}:${s.reason}`;
  counts[key] = (counts[key] ?? 0) + 1;
  if (counts[key] <= SAMPLE_LIMIT) samples.push(s);
}

// ── Drift warning builder ─────────────────────────────────────────────────
export function buildWarnings(d: {
  fetched:      number;
  adapter_kept: number;
  final_stored: number;
  http_errors?: { status?: number; tenant?: string; message?: string }[];
}): string[] {
  const w: string[] = [];
  const pipelineDrop = d.adapter_kept - d.final_stored;

  if (d.fetched > 0 && d.final_stored === 0) {
    w.push(`Source fetched ${d.fetched} jobs but stored 0.`);
  }
  if (d.adapter_kept > 0 && pipelineDrop / d.adapter_kept > 0.05) {
    w.push(
      `Pipeline dropped ${pipelineDrop}/${d.adapter_kept} ` +
      `(${Math.round((pipelineDrop / d.adapter_kept) * 100)}%) of adapter-kept jobs.`,
    );
  }
  if (d.adapter_kept >= 20 && d.final_stored / d.adapter_kept < 0.75) {
    w.push(
      `Adapter/pipeline mismatch: final stored (${d.final_stored}) is much lower ` +
      `than adapter kept (${d.adapter_kept}).`,
    );
  }
  for (const e of d.http_errors ?? []) {
    if ((e.status ?? 0) >= 400) {
      const who = e.tenant ? ` tenant=${e.tenant}` : "";
      w.push(`HTTP ${e.status ?? "error"}${who}: ${e.message ?? "(no message)"}`);
    }
  }
  return w;
}

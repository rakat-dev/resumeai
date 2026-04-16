import { NextResponse } from "next/server";
import {
  REFRESH_STATE, REFRESH_HISTORY,
  type RefreshState, type RefreshRun,
} from "@/app/api/jobs/refresh-store";

// ── GET /api/jobs/refresh-status ──────────────────────────────────────────
// Returns current per-company Firecrawl refresh state + recent run history.
// Both Maps live in refresh-store.ts, shared with route.ts in the same bundle.
// ─────────────────────────────────────────────────────────────────────────

function ago(ms: number | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function statusEmoji(status: RefreshState["status"]): string {
  const map: Record<string, string> = {
    never_run:       "⬜",
    queued:          "🟡",
    running:         "🔵",
    success:         "🟢",
    partial_success: "🟠",
    failed:          "🔴",
    timeout:         "⏱️",
    skipped:         "⏭️",
  };
  return map[status] ?? "❓";
}

export async function GET() {
  const states = Array.from(REFRESH_STATE.values()) as RefreshState[];

  // Sort: running first → queued → by last_attempt desc
  states.sort((a, b) => {
    const order = ["running","queued","success","partial_success","failed","timeout","never_run","skipped"];
    const ai = order.indexOf(a.status), bi = order.indexOf(b.status);
    if (ai !== bi) return ai - bi;
    return (b.last_attempt_at ?? 0) - (a.last_attempt_at ?? 0);
  });

  const summary = {
    total:           states.length,
    running:         states.filter(s => s.status === "running").length,
    queued:          states.filter(s => s.status === "queued").length,
    success:         states.filter(s => s.status === "success").length,
    partial_success: states.filter(s => s.status === "partial_success").length,
    failed:          states.filter(s => s.status === "failed").length,
    timeout:         states.filter(s => s.status === "timeout").length,
    never_run:       states.filter(s => s.status === "never_run").length,
  };

  const companies = states.map(s => ({
    emoji:              statusEmoji(s.status),
    company:            s.company,
    source:             s.source,
    status:             s.status,
    query:              s.query,
    filter:             s.filter,
    started_at:         s.started_at,
    finished_at:        s.finished_at,
    duration_ms:        s.duration_ms,
    raw_count:          s.raw_count,
    kept_count:         s.kept_count,
    error_message:      s.error_message,
    last_success_at:    s.last_success_at,
    last_attempt_at:    s.last_attempt_at,
    // Human-readable relative times
    started_at_ago:     ago(s.started_at),
    finished_at_ago:    ago(s.finished_at),
    last_success_ago:   ago(s.last_success_at),
    last_attempt_ago:   ago(s.last_attempt_at),
  }));

  // Last 50 history entries, newest first
  const history = [...(REFRESH_HISTORY as RefreshRun[])]
    .slice(-50)
    .reverse()
    .map(r => ({
      emoji:           statusEmoji(r.status),
      run_id:          r.run_id,
      company:         r.company,
      source:          r.source,
      status:          r.status,
      query:           r.query,
      filter:          r.filter,
      started_at:      r.started_at,
      finished_at:     r.finished_at,
      duration_ms:     r.duration_ms,
      raw_count:       r.raw_count,
      kept_count:      r.kept_count,
      error_message:   r.error_message,
      started_at_ago:  ago(r.started_at),
      finished_at_ago: ago(r.finished_at),
    }));

  return NextResponse.json({
    as_of:          new Date().toISOString(),
    summary,
    companies,
    recent_history: history,
  });
}

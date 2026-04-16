import { NextResponse } from "next/server";
import { getAllRefreshStates, getRefreshHistory, isRedisConfigured } from "@/lib/redis";
import { REFRESH_STATE, REFRESH_HISTORY } from "@/app/api/jobs/refresh-store";
import type { RefreshState, RefreshRun } from "@/app/api/jobs/types";

// ── GET /api/jobs/refresh-status ──────────────────────────────────────────
// Reads from Redis (persistent, cross-instance) when configured.
// Falls back to in-memory Maps when Redis is not yet set up.

function ago(ms: number | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
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
    rate_limited:    "🚫",
  };
  return map[status] ?? "❓";
}

export async function GET() {
  let states: RefreshState[];
  let history: RefreshRun[];
  let source: "redis" | "memory";

  if (isRedisConfigured()) {
    [states, history] = await Promise.all([
      getAllRefreshStates(),
      getRefreshHistory(50),
    ]);
    source = "redis";
    // Merge in any in-memory entries that might be newer (e.g. currently running)
    const redisCompanies = new Set(states.map(s => s.company));
    for (const [company, state] of REFRESH_STATE.entries()) {
      if (!redisCompanies.has(company) || state.status === "running") {
        const existing = states.findIndex(s => s.company === company);
        if (existing >= 0) states[existing] = state;
        else states.push(state);
      }
    }
  } else {
    states = Array.from(REFRESH_STATE.values()) as RefreshState[];
    history = [...(REFRESH_HISTORY as RefreshRun[])].slice(-50).reverse();
    source = "memory";
  }

  states.sort((a, b) => {
    const order = ["running", "queued", "success", "partial_success", "failed", "timeout", "rate_limited", "never_run", "skipped"];
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
    rate_limited:    states.filter(s => s.status === "rate_limited").length,
    never_run:       states.filter(s => s.status === "never_run").length,
  };

  const companies = states.map(s => ({
    emoji:            statusEmoji(s.status),
    company:          s.company,
    source:           s.source,
    status:           s.status,
    started_at:       s.started_at,
    finished_at:      s.finished_at,
    duration_ms:      s.duration_ms,
    raw_count:        s.raw_count,
    kept_count:       s.kept_count,
    error_message:    s.error_message,
    last_success_at:  s.last_success_at,
    last_attempt_at:  s.last_attempt_at,
    started_at_ago:   ago(s.started_at),
    finished_at_ago:  ago(s.finished_at),
    last_success_ago: ago(s.last_success_at),
    last_attempt_ago: ago(s.last_attempt_at),
  }));

  const recentHistory = history.map(r => ({
    emoji:           statusEmoji(r.status),
    run_id:          r.run_id,
    company:         r.company,
    source:          r.source,
    status:          r.status,
    started_at:      r.started_at,
    finished_at:     r.finished_at,
    duration_ms:     r.duration_ms,
    raw_count:       r.raw_count,
    kept_count:      r.kept_count,
    error_message:   r.error_message,
    started_at_ago:  ago(r.started_at),
    finished_at_ago: ago(r.finished_at ?? null),
  }));

  return NextResponse.json({
    as_of:         new Date().toISOString(),
    storage:       source,
    redis_enabled: isRedisConfigured(),
    summary,
    companies,
    recent_history: recentHistory,
  });
}

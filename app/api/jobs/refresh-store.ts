// ── Refresh state store ───────────────────────────────────────────────────
// In-memory Maps for same-instance fast path +
// Upstash Redis for cross-instance persistence (refresh status only).
//
// Jobs are stored in Supabase (real DB), NOT here.

export type { RefreshStatus, RefreshSource, RefreshState, RefreshRun } from "./types";
import type { RefreshState, RefreshRun } from "./types";
import { saveRefreshState, appendRefreshRun } from "@/lib/redis";

// ── In-memory Maps (fast path, same serverless instance) ─────────────────
export const REFRESH_STATE   = new Map<string, RefreshState>();
export const REFRESH_HISTORY: RefreshRun[] = [];
export const REFRESH_HISTORY_MAX = 200;

// ── Persistent write helpers ──────────────────────────────────────────────
// Called after every state transition. Redis write is fire-and-forget.

export function persistState(state: RefreshState): void {
  REFRESH_STATE.set(state.company, state);
  saveRefreshState(state).catch(e =>
    console.error(`[store] persistState Redis write failed (${state.company}):`, e)
  );
}

export function persistRun(run: RefreshRun): void {
  REFRESH_HISTORY.push(run);
  if (REFRESH_HISTORY.length > REFRESH_HISTORY_MAX) {
    REFRESH_HISTORY.splice(0, REFRESH_HISTORY.length - REFRESH_HISTORY_MAX);
  }
  appendRefreshRun(run).catch(e =>
    console.error(`[store] persistRun Redis write failed (${run.company}):`, e)
  );
}

// ── Firecrawl refresh state store ────────────────────────────────────────
// In-memory Maps for same-instance fast path +
// Upstash Redis for cross-instance persistence.
//
// The Maps stay as a fast local cache — reads check memory first.
// All writes go to both memory AND Redis (fire-and-forget, non-blocking).

export type { RefreshStatus, RefreshState, RefreshRun } from "./types";
import type { RefreshState, RefreshRun } from "./types";
import { saveRefreshState, appendRefreshRun } from "@/lib/redis";

// ── In-memory Maps (fast path, same serverless instance) ─────────────────
export const REFRESH_STATE   = new Map<string, RefreshState>();
export const REFRESH_HISTORY: RefreshRun[] = [];
export const REFRESH_HISTORY_MAX = 200;

// ── Firecrawl job cache ───────────────────────────────────────────────────
export interface FcCacheEntry {
  jobs:   unknown[];
  raw:    number;
  ts:     number;
  filter: string;
}
export const FC_COMPANY_CACHE_STORE = new Map<string, FcCacheEntry>();

export function setCompanyCache(key: string, entry: FcCacheEntry): void {
  FC_COMPANY_CACHE_STORE.set(key, entry);
}
export function getCompanyCache(key: string): FcCacheEntry | undefined {
  return FC_COMPANY_CACHE_STORE.get(key);
}

// ── Persistent write helpers ──────────────────────────────────────────────
// Called by route.ts and refresh/route.ts after every state transition.
// Redis write is fire-and-forget (no await at call site) — never blocks response.

export function persistState(state: RefreshState): void {
  REFRESH_STATE.set(state.company, state);
  // Non-blocking Redis write
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

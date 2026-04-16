import { Redis } from "@upstash/redis";
import type { RefreshState, RefreshRun } from "@/app/api/jobs/types";

// ── Upstash Redis client ───────────────────────────────────────────────────
// Used ONLY for: refresh status, refresh history, short-lived source cache.
// Jobs are stored in Supabase, not here.

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// ── Key helpers ───────────────────────────────────────────────────────────
const KEY_STATE   = (company: string) => `rs:state:${company}`;
const KEY_HISTORY = "rs:history";
const HISTORY_MAX = 200;

// ── Public API ────────────────────────────────────────────────────────────

/** Write current refresh state for one company. No-op if Redis not configured. */
export async function saveRefreshState(state: RefreshState): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(KEY_STATE(state.company), JSON.stringify(state));
  } catch (e) {
    console.error(`[redis] saveRefreshState failed for ${state.company}:`, e);
  }
}

/** Read refresh state for all known companies. */
export async function getAllRefreshStates(): Promise<RefreshState[]> {
  const r = getRedis();
  if (!r) return [];
  try {
    const keys: string[] = [];
    let cursor = 0;
    do {
      const [nextCursor, batch] = await r.scan(cursor, { match: "rs:state:*", count: 100 });
      keys.push(...(batch as string[]));
      cursor = Number(nextCursor);
    } while (cursor !== 0);

    if (keys.length === 0) return [];
    const values = await r.mget<string[]>(...keys);
    return values
      .filter((v): v is string => v !== null && v !== undefined)
      .map(v => JSON.parse(v) as RefreshState);
  } catch (e) {
    console.error("[redis] getAllRefreshStates failed:", e);
    return [];
  }
}

/** Append a completed run to the history list (capped at HISTORY_MAX). */
export async function appendRefreshRun(run: RefreshRun): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.lpush(KEY_HISTORY, JSON.stringify(run));
    await r.ltrim(KEY_HISTORY, 0, HISTORY_MAX - 1);
  } catch (e) {
    console.error("[redis] appendRefreshRun failed:", e);
  }
}

/** Read most recent N history runs (newest first). */
export async function getRefreshHistory(limit = 50): Promise<RefreshRun[]> {
  const r = getRedis();
  if (!r) return [];
  try {
    const items = await r.lrange<string>(KEY_HISTORY, 0, limit - 1);
    return items.map(v => (typeof v === "string" ? JSON.parse(v) : v) as RefreshRun);
  } catch (e) {
    console.error("[redis] getRefreshHistory failed:", e);
    return [];
  }
}

/** True if Redis is configured (env vars present). */
export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

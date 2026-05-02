// Shared IndexedDB cache helpers — used by app/jobs/page.tsx and app/saved/page.tsx.
// Stores the full jobs array (including fullDescription, viewedAt, tailoredAt) with
// a 5-min TTL so JDs survive navigation between tabs.

import type { Job } from "@/app/api/jobs/route";

export const IDB_NAME    = "resumeai_cache";
export const IDB_STORE   = "kv";
export const IDB_JOB_KEY = "jobs_cache";

export type JobCacheEntry = { jobs: Job[]; sources: Record<string, number>; savedAt: number };

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no IDB")); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function saveJobCache(jobs: Job[], sources: Record<string, number>): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).put({ jobs, sources, savedAt: Date.now() }, IDB_JOB_KEY);
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror   = () => { db.close(); reject(req.error); };
    });
  } catch (e) {
    console.warn("[saveJobCache] IndexedDB write failed:", e);
  }
}

export async function loadJobCache(): Promise<JobCacheEntry | null> {
  try {
    const db = await openIDB();
    return await new Promise<JobCacheEntry | null>((resolve) => {
      const tx  = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_JOB_KEY) as IDBRequest<JobCacheEntry | undefined>;
      req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
      req.onerror   = () => { db.close(); resolve(null); };
    });
  } catch (e) {
    console.warn("[loadJobCache] IndexedDB read failed:", e);
    return null;
  }
}

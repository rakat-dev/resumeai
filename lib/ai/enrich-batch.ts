import { enrichJob } from "./enrich-job";
import type { JobInputForEnrichment } from "./enrich-job";
import type { EnrichedJob, AiBatchStats } from "./types";

export type { JobInputForEnrichment };

const MAX_CONCURRENCY    = Number(process.env.AI_MAX_CONCURRENCY    ?? 3);
const MAX_JOBS_PER_REFRESH = Number(process.env.AI_MAX_JOBS_PER_REFRESH ?? 100);

interface BatchOpts {
  maxJobs?: number;
}

export async function enrichBatch(
  jobs: JobInputForEnrichment[],
  opts?: BatchOpts
): Promise<{ results: Map<string, EnrichedJob>; stats: AiBatchStats }> {
  const batchStartMs = Date.now();
  const limit = opts?.maxJobs ?? MAX_JOBS_PER_REFRESH;
  const toProcess = jobs.slice(0, limit);
  const skippedCount = jobs.length - toProcess.length;

  const results = new Map<string, EnrichedJob>();
  const stats: AiBatchStats = {
    totalJobs:      jobs.length,
    enriched:       0,
    cacheHits:      0,
    failed:         0,
    rateLimited:    0,
    skipped:        skippedCount,
    totalLatencyMs: 0,
    totalTokens:    0,
  };

  // Concurrency pool: keep at most MAX_CONCURRENCY in-flight
  const concurrency = Math.max(1, MAX_CONCURRENCY);
  const queue = [...toProcess];
  const inFlight = new Set<Promise<void>>();

  const runNext = (): void => {
    const job = queue.shift();
    if (!job) return;
    const key = job.id ?? job.url ?? `${job.company}::${job.title}`;
    let resolve!: () => void;
    const p: Promise<void> = new Promise(r => { resolve = r; });
    inFlight.add(p);
    enrichJob(job).then(result => {
      results.set(key, result);
      const s = result.aiMeta.status;
      if (s === "success")       stats.enriched++;
      else if (s === "cached")   stats.cacheHits++;
      else if (s === "failed") {
        if (result.aiMeta?.error === "rate_limited") stats.rateLimited++;
        else                                         stats.failed++;
      }
      else if (s === "skipped")  stats.skipped++;
      stats.totalLatencyMs += result.aiMeta.latencyMs;
      stats.totalTokens    += result.aiMeta.tokenUsage?.total ?? 0;
    }).catch((e: unknown) => {
      console.error("[AI batch] per-job error:", e instanceof Error ? e.message : String(e));
      stats.failed++;
    }).finally(() => {
      inFlight.delete(p);
      resolve();
    });
  };

  // Fill up to concurrency limit
  for (let i = 0; i < concurrency && queue.length > 0; i++) {
    runNext();
  }

  // Drain: whenever a slot frees, start the next job
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    while (inFlight.size < concurrency && queue.length > 0) {
      runNext();
    }
  }

  const durationMs = Date.now() - batchStartMs;
  console.log(
    `[ai_batch] total=${stats.totalJobs} enriched=${stats.enriched} cached=${stats.cacheHits} failed=${stats.failed} skipped=${stats.skipped} rate_limited=${stats.rateLimited} durationMs=${durationMs}`
  );
  return { results, stats };
}

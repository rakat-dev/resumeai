import { NextRequest, NextResponse } from "next/server";
import { persistState, persistRun } from "@/app/api/jobs/refresh-store";
import type { RefreshState } from "@/app/api/jobs/types";

// ── POST /api/jobs/refresh ─────────────────────────────────────────────────
// Background ingestion endpoint. Fetches from all sources, normalizes,
// filters, dedupes, and stores jobs in Supabase.
//
// Can be called:
//   - Manually (admin button in UI)
//   - From an external scheduler (cron)
//   - From Vercel cron (if upgraded)
//
// Steps wired in order (each step adds to this file):
//   [x] Step 1 — Firecrawl removed
//   [ ] Step 5 — Greenhouse + Workday ingestion
//   [ ] Step 6 — JSearch / Adzuna / Jooble ingestion
//   [ ] Step 7 — Playwright Tier A ingestion
//   [ ] Step 8 — Central normalize / filter / dedupe / store

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const source = (body.source as string) || "all";

  console.log(`[refresh] POST triggered — source=${source}`);

  // TODO (Step 5): Wire Greenhouse + Workday ingestion
  // TODO (Step 6): Wire JSearch / Adzuna / Jooble ingestion
  // TODO (Step 7): Wire Playwright Tier A ingestion

  return NextResponse.json({
    ok: true,
    message: "Refresh endpoint ready. Ingestion sources will be wired in subsequent steps.",
    source,
    jobs_stored: 0,
  });
}

// Also support GET for easy manual browser trigger
export async function GET(req: NextRequest) {
  return POST(req);
}

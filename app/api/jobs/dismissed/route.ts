import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { JobRow } from "@/lib/supabase";
import { getFortuneTier, getPriorityTier, formatPostedDate } from "@/lib/jobUtils";
import type { Job } from "@/app/api/jobs/route";

export const dynamic = "force-dynamic";

// ── GET /api/jobs/dismissed ────────────────────────────────────────────────
// Returns all dismissed jobs ordered by dismissed_at DESC.
// Uses the partial index on job_user_state.dismissed_at for fast lookup.
// Jobs that are no longer active (is_active=false) are silently skipped.
export async function GET() {
  try {
    // Step 1 — get all dismissed job_ids + timestamps
    const { data: states, error: statesErr } = await supabaseAdmin
      .from("job_user_state")
      .select("job_id, dismissed_at, viewed_at, tailored_at")
      .not("dismissed_at", "is", null)
      .order("dismissed_at", { ascending: false });

    if (statesErr) {
      console.error("[/api/jobs/dismissed] states fetch error:", statesErr.message);
      return NextResponse.json({ error: statesErr.message }, { status: 500 });
    }

    if (!states || states.length === 0) {
      return NextResponse.json({ jobs: [], count: 0 });
    }

    type StateRow = { job_id: string; dismissed_at: string; viewed_at: string | null; tailored_at: string | null };
    const stateRows = states as StateRow[];
    const stateMap  = new Map(stateRows.map(s => [s.job_id, s]));
    const jobIds    = stateRows.map(s => s.job_id);

    // Step 2 — fetch matching job rows (only active jobs; skip soft-deleted)
    const { data: rows, error: jobsErr } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .in("id", jobIds)
      .eq("is_active", true);

    if (jobsErr) {
      console.error("[/api/jobs/dismissed] jobs fetch error:", jobsErr.message);
      return NextResponse.json({ error: jobsErr.message }, { status: 500 });
    }

    // Step 3 — map rows to Job shape, merge dismissed_at / status
    const V2_SOURCES = new Set(["walmart_v2", "amazon_v2", "google_v2", "microsoft_v2", "jpmorgan_v2"]);

    const jobs: (Job & { dismissedAt: string })[] = (rows ?? [])
      .map((row: JobRow) => {
        const rawSource  = row.source as string;
        const sourceType = V2_SOURCES.has(rawSource)
          ? "v2" as const
          : rawSource.startsWith("playwright")
            ? "playwright" as const
            : (rawSource as Job["sourceType"]) ?? "other" as const;
        const ts = row.posted_at ? Math.floor(new Date(row.posted_at).getTime() / 1000) : 0;
        const st = stateMap.get(row.id)!;

        return {
          id:              row.id,
          title:           row.title,
          company:         row.company,
          location:        row.location,
          type:            row.employment_type ?? "Full-time",
          description:     row.description ?? "",
          applyUrl:        row.apply_url ?? "#",
          postedAt:        row.posted_at ?? "",
          postedDate:      ts ? formatPostedDate(ts) : "Recently",
          postedTimestamp: ts,
          source:          rawSource,
          sourceType,
          skills:          [],
          sponsorshipTag:  (row.sponsorship_status as Job["sponsorshipTag"]) ?? "not_mentioned",
          priorityTier:    getPriorityTier(row.company),
          fortuneRank:     getFortuneTier(row.company),
          positionRank:    row.position_rank ?? undefined,
          fullDescription: row.full_description ?? undefined,
          viewedAt:        st.viewed_at    ?? null,
          tailoredAt:      st.tailored_at  ?? null,
          dismissedAt:     st.dismissed_at,
        };
      })
      // Preserve dismissed_at DESC order from the states query
      .sort((a, b) => new Date(b.dismissedAt).getTime() - new Date(a.dismissedAt).getTime());

    return NextResponse.json({ jobs, count: jobs.length });

  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

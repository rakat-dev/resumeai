import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// ── Types ──────────────────────────────────────────────────────────────────
type StatusAction = "viewed" | "tailored" | "dismissed" | "undismissed";

interface StatusBody {
  jobId:  string;
  action: StatusAction;
}

const VALID_ACTIONS = new Set<StatusAction>(["viewed", "tailored", "dismissed", "undismissed"]);

// ── POST /api/jobs/status ──────────────────────────────────────────────────
// Body: { jobId: string, action: StatusAction }
//
// viewed      — stamps viewed_at with NOW() on first call only (idempotent)
// tailored    — stamps tailored_at with NOW() on first call only (idempotent)
// dismissed   — stamps dismissed_at with NOW() (always overwrites)
// undismissed — clears dismissed_at (sets to null)
//
// Uses upsert on job_id (PK). The trigger in the migration auto-updates
// updated_at on every row modification.
export async function POST(req: NextRequest) {
  // ── Parse body ────────────────────────────────────────────────────────
  let body: StatusBody;
  try {
    body = (await req.json()) as StatusBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jobId, action } = body ?? {};
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "jobId (string) is required" }, { status: 400 });
  }
  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${[...VALID_ACTIONS].join(", ")}` },
      { status: 400 }
    );
  }

  // ── Fetch existing row (needed for idempotent first-time stamps) ───────
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("job_user_state")
    .select("job_id, viewed_at, tailored_at, dismissed_at")
    .eq("job_id", jobId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[/api/jobs/status] fetch error:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  // ── Build upsert payload ───────────────────────────────────────────────
  const now = new Date().toISOString();
  const patch: Record<string, string | null> = { job_id: jobId };

  switch (action) {
    case "viewed":
      // Only stamp the first time — never overwrite an existing timestamp
      patch.viewed_at = existing?.viewed_at ?? now;
      break;
    case "tailored":
      patch.tailored_at = existing?.tailored_at ?? now;
      break;
    case "dismissed":
      patch.dismissed_at = now;
      break;
    case "undismissed":
      patch.dismissed_at = null;
      break;
  }

  // ── Upsert ────────────────────────────────────────────────────────────
  const { error: upsertErr } = await supabaseAdmin
    .from("job_user_state")
    .upsert(patch, { onConflict: "job_id" });

  if (upsertErr) {
    console.error("[/api/jobs/status] upsert error:", upsertErr.message);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  console.log(`[/api/jobs/status] ok jobId=${jobId} action=${action}`);
  return NextResponse.json({ ok: true, jobId, action });
}

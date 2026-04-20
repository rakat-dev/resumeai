import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// One-shot migration: adds full_description column if it doesn't exist.
// Call GET /api/migrate once after deploying this code.
// Safe to call multiple times — uses IF NOT EXISTS.
export async function GET() {
  try {
    // Supabase JS doesn't expose raw DDL, so we use a workaround:
    // insert a dummy row select to check if the column exists.
    const { error: checkErr } = await supabaseAdmin
      .from("jobs")
      .select("full_description")
      .limit(1);

    if (!checkErr) {
      return NextResponse.json({ ok: true, message: "Column full_description already exists." });
    }

    // Column doesn't exist — use rpc if available, else inform user to run SQL manually
    // Since Supabase free tier doesn't expose exec_sql, we return the SQL to run manually.
    return NextResponse.json({
      ok: false,
      action_required: true,
      sql: "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS full_description text;",
      message: "Run the SQL above in your Supabase SQL Editor, then call this endpoint again to verify.",
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

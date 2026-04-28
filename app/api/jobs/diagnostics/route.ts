// GET /api/jobs/diagnostics — returns latest refresh diagnostics.
// No auth needed: personal-use app only.

import { NextResponse } from "next/server";
import { getLatestDiagnostics } from "@/lib/diagnostics";

export async function GET() {
  const diag = await getLatestDiagnostics();
  if (!diag) {
    return NextResponse.json({
      message: "No diagnostics available yet. Run refresh first.",
      sources: [],
    });
  }
  return NextResponse.json(diag);
}

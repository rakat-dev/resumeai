import { NextRequest, NextResponse } from "next/server";

// Debug endpoint — tests Workday tenants server-side to see raw titles
// Usage: /api/debug-workday?tenant=walmart&server=wd5&site=WalmartExternal&q=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenant = searchParams.get("tenant") || "walmart";
  const server = searchParams.get("server") || "wd5";
  const site   = searchParams.get("site")   || "WalmartExternal";
  const search = searchParams.get("q")      || "";

  const url = `https://${tenant}.${server}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: search }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, status: res.status, url, body: body.slice(0, 200) });
    }

    const data = await res.json();
    const jobs = (data.jobPostings ?? []) as Record<string, unknown>[];

    return NextResponse.json({
      ok: true, url, tenant, server, site, search,
      total: data.total ?? 0,
      returned: jobs.length,
      titles: jobs.map(j => ({
        title:    j.title,
        location: (j.locationsText as string) ?? "",
        posted:   (j.postedOn as string) ?? null,
      })),
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), url });
  }
}

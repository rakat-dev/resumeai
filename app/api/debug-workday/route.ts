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
  const referer = `https://${tenant}.${server}.myworkdayjobs.com/en-US/${site}`;

  // Try multiple request body variants to identify which one the tenant accepts
  const variants = [
    // Variant A: minimal
    { name: "minimal", body: { appliedFacets: {}, limit: 20, offset: 0, searchText: search } },
    // Variant B: with searchText key explicitly
    { name: "with_limit_only", body: { limit: 20, offset: 0 } },
    // Variant C: with all standard fields Workday expects
    { name: "full_fields", body: {
      appliedFacets: {},
      limit: 20,
      offset: 0,
      searchText: search,
      jobFamilyGroup: [],
      country: [],
      jobType: [],
      locations: [],
    }},
  ];

  const results: Record<string, unknown>[] = [];

  for (const v of variants) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
          "Referer": referer,
          "Origin": `https://${tenant}.${server}.myworkdayjobs.com`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: JSON.stringify(v.body),
        signal: AbortSignal.timeout(12_000),
      });

      if (res.ok) {
        const data = await res.json();
        const jobs = (data.jobPostings ?? []) as Record<string, unknown>[];
        results.push({
          variant: v.name, ok: true, status: res.status,
          total: data.total ?? 0, returned: jobs.length,
          sample: jobs.slice(0, 3).map(j => j.title),
        });
        break; // stop at first success
      } else {
        const body = await res.text().catch(() => "");
        results.push({ variant: v.name, ok: false, status: res.status, body: body.slice(0, 200) });
      }
    } catch (e: unknown) {
      results.push({ variant: v.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ url, referer, tenant, server, site, results });
}

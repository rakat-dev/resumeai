import { NextRequest, NextResponse } from "next/server";
import { COMPANY_ATS_REGISTRY } from "@/lib/companyAtsRegistry";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ── Workday Debug Endpoint ─────────────────────────────────────────────────
// Tests every Workday tenant in COMPANY_ATS_REGISTRY (enabled AND disabled).
// Answers: is the endpoint reachable? Which titles does it return?
//
// Usage:
//   GET /api/jobs/workday-debug               — test all
//   GET /api/jobs/workday-debug?only=enabled  — only enabled tenants
//   GET /api/jobs/workday-debug?only=disabled — only disabled tenants (retry check)
//   GET /api/jobs/workday-debug?company=Walmart — single company
//
// Returns JSON: [{ company, enabled, status, httpCode, total, titles[], error, note }]
// ───────────────────────────────────────────────────────────────────────────

interface WorkdayResult {
  company:   string;
  enabled:   boolean;
  url:       string;
  status:    "ok" | "http_error" | "network_error" | "parse_error" | "timeout";
  httpCode?: number;
  total:     number;
  titles:    string[];
  error?:    string;
  note?:     string;
  durationMs: number;
}

interface WorkdayJobPosting {
  title?:       string;
  externalPath?: string;
  locationsText?: string;
  postedOn?:    string;
  bulletFields?: string[];
}

interface WorkdayResponse {
  total?:       number;
  jobPostings?: WorkdayJobPosting[];
}

function parseWorkdayUrl(careersUrl: string): { tenant: string; server: string; site: string } | null {
  const match = careersUrl.match(/https?:\/\/([^.]+)\.([^.]+)\.myworkdayjobs\.com\/(.+?)\/?$/);
  if (!match) return null;
  const [, tenant, server, site] = match;
  return { tenant, server, site };
}

async function testWorkdayTenant(
  company:  string,
  enabled:  boolean,
  careersUrl: string,
  note?:    string,
): Promise<WorkdayResult> {
  const start = Date.now();
  const parsed = parseWorkdayUrl(careersUrl);

  if (!parsed) {
    return {
      company,
      enabled,
      url: careersUrl,
      status: "parse_error",
      total: 0,
      titles: [],
      error: "Could not parse tenant/server/site from careersUrl",
      note,
      durationMs: Date.now() - start,
    };
  }

  const { tenant, server, site } = parsed;
  const apiUrl = `https://${tenant}.${server}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Accept":          "application/json",
        "Content-Type":    "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "" }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      return {
        company,
        enabled,
        url: apiUrl,
        status: "http_error",
        httpCode: res.status,
        total: 0,
        titles: [],
        error: `HTTP ${res.status} ${res.statusText}`,
        note,
        durationMs: Date.now() - start,
      };
    }

    const data = (await res.json()) as WorkdayResponse;
    const jobs = data.jobPostings ?? [];
    return {
      company,
      enabled,
      url: apiUrl,
      status: "ok",
      httpCode: res.status,
      total: data.total ?? jobs.length,
      titles: jobs.slice(0, 8).map(j => j.title ?? "(no title)"),
      note,
      durationMs: Date.now() - start,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("abort");
    return {
      company,
      enabled,
      url: apiUrl,
      status: isTimeout ? "timeout" : "network_error",
      total: 0,
      titles: [],
      error: msg,
      note,
      durationMs: Date.now() - start,
    };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const only    = searchParams.get("only");    // "enabled" | "disabled" | null
  const company = searchParams.get("company"); // filter by exact company name

  // Pull every Workday config from the registry
  let configs = COMPANY_ATS_REGISTRY.filter(c => c.ats === "workday" && c.careersUrl);

  if (only === "enabled")  configs = configs.filter(c => c.enabled);
  if (only === "disabled") configs = configs.filter(c => !c.enabled);
  if (company)             configs = configs.filter(c => c.company.toLowerCase() === company.toLowerCase());

  if (configs.length === 0) {
    return NextResponse.json(
      { error: "No Workday configs matched", filters: { only, company } },
      { status: 404 },
    );
  }

  const settled = await Promise.allSettled(
    configs.map(c => testWorkdayTenant(c.company, c.enabled, c.careersUrl!, c.note)),
  );

  const results: WorkdayResult[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          company:    configs[i].company,
          enabled:    configs[i].enabled,
          url:        configs[i].careersUrl ?? "",
          status:     "network_error",
          total:      0,
          titles:     [],
          error:      r.reason instanceof Error ? r.reason.message : String(r.reason),
          note:       configs[i].note,
          durationMs: 0,
        },
  );

  // Summary for quick eyeballing
  const summary = {
    total_tested:   results.length,
    ok:             results.filter(r => r.status === "ok").length,
    http_error:     results.filter(r => r.status === "http_error").length,
    network_error:  results.filter(r => r.status === "network_error").length,
    timeout:        results.filter(r => r.status === "timeout").length,
    parse_error:    results.filter(r => r.status === "parse_error").length,
    jobs_available: results.reduce((sum, r) => sum + r.total, 0),
  };

  return NextResponse.json(
    {
      summary,
      filters: { only: only ?? "all", company: company ?? null },
      results: results.sort((a, b) => {
        if (a.status === "ok" && b.status !== "ok") return -1;
        if (a.status !== "ok" && b.status === "ok") return 1;
        return b.total - a.total;
      }),
    },
    { status: 200 },
  );
}

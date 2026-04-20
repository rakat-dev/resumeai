import { NextResponse } from "next/server";

// Debug endpoint: fetch a specific Walmart job's detail from the server side
// and return the raw plain text so we can see what the sponsorship filter sees.
// Usage: GET /api/debug/walmart-jd?reqId=R-2466378
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reqId = searchParams.get("reqId") || "R-2466378";

  const WALMART_CXS_BASE = "https://walmart.wd5.myworkdayjobs.com/wday/cxs/walmart/WalmartExternal";
  const PROFILE_IDS = [
    "1d1f3a5e8423010343a62f13c700a839",
    "12a6482783d701de2ca3f755f12e45df",
    "12a6482783d7012a1ee3be9cf02eaddb",
    "fba71304cea401287d93764c1f2df0c0",
  ];

  // Step 1: find the externalPath for this reqId via search
  let externalPath = "";
  let postedOn = "";
  for (let offset = 0; offset < 300; offset += 20) {
    const res = await fetch(`${WALMART_CXS_BASE}/jobs`, {
      method: "POST",
      headers: {
        "Accept": "application/json", "Content-Type": "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      body: JSON.stringify({ appliedFacets: { Job_Profiles: PROFILE_IDS }, limit: 20, offset, searchText: "software" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) break;
    const data = await res.json() as Record<string, unknown>;
    const postings = (data.jobPostings ?? []) as Record<string, unknown>[];
    const match = postings.find(j => ((j.bulletFields as string[]) || [])[0] === reqId);
    if (match) {
      externalPath = (match.externalPath as string) || "";
      postedOn = (match.postedOn as string) || "";
      break;
    }
    if (postings.length < 20) break;
  }

  if (!externalPath) {
    return NextResponse.json({ error: `reqId ${reqId} not found in search results`, reqId });
  }

  // Step 2: fetch detail
  const detailRes = await fetch(`${WALMART_CXS_BASE}${externalPath}`, {
    headers: {
      "Accept": "application/json", "Accept-Language": "en-US",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!detailRes.ok) {
    return NextResponse.json({ error: `detail fetch HTTP ${detailRes.status}`, externalPath });
  }
  const detail = await detailRes.json() as Record<string, unknown>;
  const info = (detail.jobPostingInfo ?? {}) as Record<string, unknown>;
  const rawHtml = (info.jobDescription as string) ?? (info.externalDescription as string) ?? "";

  // Step 3: htmlToPlainText exactly as in playwrightScrapers.ts
  const plainText = rawHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#?\w+;/g, " ")
    .replace(/[*\u2022\u00b7\u2013\u2014]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  // Step 4: trimAtSimilarJobs
  const markers = ["similar jobs","similar job","related jobs","jobs you may like","recommended jobs","you might also like"];
  let cut = plainText.length;
  for (const m of markers) { const i = plainText.indexOf(m); if (i !== -1 && i < cut) cut = i; }
  const trimmed = plainText.slice(0, cut).trim();

  // Step 5: run every NO_SPONSORSHIP_PATTERNS
  const NO_SPONSORSHIP_PATTERNS: [RegExp, string][] = [
    [/\bimmigration sponsorship (?:support )?(?:will )?not be available\b/i, "immigration sponsorship will not be available"],
    [/\bimmigration sponsorship (?:support )?is not available\b/i, "immigration sponsorship is not available"],
    [/\bimmigration sponsorship (?:support )?is not provided\b/i, "immigration sponsorship is not provided"],
    [/\bimmigration sponsorship (?:support )?will not be provided\b/i, "immigration sponsorship will not be provided"],
    [/\bno immigration sponsorship support\b/i, "no immigration sponsorship support"],
    [/\bimmigration support is not provided\b/i, "immigration support is not provided"],
    [/\bvisa sponsorship (?:is )?not available\b/i, "visa sponsorship not available"],
    [/\bvisa sponsorship (?:support )?is not provided\b/i, "visa sponsorship is not provided"],
    [/\bvisa sponsorship (?:support )?will not be provided\b/i, "visa sponsorship will not be provided"],
    [/\bemployment-based visa sponsorship is not available\b/i, "employment-based visa sponsorship is not available"],
    [/\bemployment-based visa sponsorship will not be provided\b/i, "employment-based visa sponsorship will not be provided"],
    [/\bno visa sponsorship\b/i, "no visa sponsorship"],
    [/\bno sponsorship\b/i, "no sponsorship"],
    [/\bnot eligible for (?:employment|visa|immigration) sponsorship\b/i, "not eligible for sponsorship"],
    [/\bthis position is not eligible for (?:employment|visa|immigration) sponsorship\b/i, "this position not eligible"],
    [/\bthis (?:role|position) does not offer sponsorship\b/i, "this role does not offer sponsorship"],
    [/\bthis (?:role|position) does not support sponsorship\b/i, "this role does not support sponsorship"],
    [/\bthis (?:role|position) will not provide sponsorship\b/i, "this role will not provide sponsorship"],
    [/\bthis (?:role|position) is ineligible for sponsorship\b/i, "this role is ineligible"],
    [/\bwill not sponsor\b/i, "will not sponsor"],
    [/\bwe will not sponsor\b/i, "we will not sponsor"],
    [/\bdoes not provide sponsorship\b/i, "does not provide sponsorship"],
    [/\bcannot provide sponsorship\b/i, "cannot provide sponsorship"],
    [/\bunable to sponsor\b/i, "unable to sponsor"],
    [/\bno h-1b sponsorship\b/i, "no h-1b sponsorship"],
    [/\bnot available for opt\b/i, "not available for opt"],
    [/\bnot available for cpt\b/i, "not available for cpt"],
    [/\bnot considering candidates who require sponsorship\b/i, "not considering candidates who require sponsorship"],
    [/\bmust be authorized to work in the (?:u\.?s\.?|united states) without (?:current or future )?sponsorship\b/i, "must be authorized without sponsorship"],
    [/\bmust be legally authorized to work in the (?:u\.?s\.?|united states) without (?:current or future )?sponsorship\b/i, "must be legally authorized without sponsorship"],
    [/\bauthorized to work in the (?:u\.?s\.?|united states) without (?:current or future )?sponsorship\b/i, "authorized without sponsorship"],
    [/\bwithout current or future sponsorship\b/i, "without current or future sponsorship"],
    [/\bwithout employer sponsorship\b/i, "without employer sponsorship"],
    [/\bwithout visa sponsorship\b/i, "without visa sponsorship"],
  ];

  const matched = NO_SPONSORSHIP_PATTERNS
    .map(([rx, label]) => {
      const m = trimmed.match(rx);
      if (!m) return null;
      const idx = m.index ?? 0;
      return { label, match: m[0], context: trimmed.slice(Math.max(0, idx - 80), idx + 160) };
    })
    .filter(Boolean);

  // All occurrences of "sponsor" in trimmed text
  const sponsorContexts: string[] = [];
  let searchFrom = 0;
  while (true) {
    const i = trimmed.indexOf("sponsor", searchFrom);
    if (i === -1) break;
    sponsorContexts.push(trimmed.slice(Math.max(0, i - 60), i + 120));
    searchFrom = i + 1;
    if (sponsorContexts.length > 10) break;
  }

  return NextResponse.json({
    reqId,
    externalPath,
    postedOn,
    rawHtmlLen: rawHtml.length,
    trimmedLen: trimmed.length,
    dropped: matched.length > 0,
    matchedPatterns: matched,
    allSponsorContexts: sponsorContexts,
    tail500: trimmed.slice(-500),
    full_text: trimmed,
  });
}

// ── Tier A Company Scrapers ───────────────────────────────────────────────
// Spec §7: One broad scrape per company, filter locally.
// These use each company's internal career API (JSON endpoints) since
// Vercel serverless does not support browser binaries.
// Named fetchXxxJobs() per spec contract.

export interface ScrapedJob {
  id:          string;
  company:     string;
  title:       string;
  location:    string;
  description: string;
  applyUrl:    string;
  postedAt:    string | null;
  type:        string;
}

// ── Microsoft ─────────────────────────────────────────────────────────────
// Uses apply.careers.microsoft.com pcsx search API (reverse-engineered
// 2026-04-16 via Chrome DevTools — the old jobs.careers.microsoft.com
// endpoint now redirects to this SPA). Default page size = 10.
// Verified working from cold fetch (no cookies, no CSRF required).
export async function fetchMicrosoftJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  const MAX_PAGES = 15;
  const PAGE_SIZE = 10; // Microsoft's default — matches what the SPA uses

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        domain:   "microsoft.com",
        location: "",
        query:    "software engineer",
        start:    String(page * PAGE_SIZE),
      });
      const res = await fetch(
        `https://apply.careers.microsoft.com/api/pcsx/search?${params}`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(12_000),
        }
      );
      if (!res.ok) break;
      const data = await res.json();
      const positions = (data?.data?.positions ?? []) as Record<string, unknown>[];
      if (positions.length === 0) break;

      for (const p of positions) {
        const numericId  = p.id as number | undefined;
        const displayId  = (p.displayJobId as string) ?? String(numericId ?? Math.random());
        const locStdArr  = (p.standardizedLocations as string[]) ?? [];
        const locRawArr  = (p.locations as string[]) ?? [];
        const postedTs   = p.postedTs as number | undefined;
        results.push({
          id:          `msft-${numericId ?? displayId}`,
          company:     "Microsoft",
          title:       (p.name as string) ?? "",
          location:    locStdArr[0] ?? locRawArr[0] ?? "United States",
          description: "", // position_details endpoint holds this — not fetched to keep refresh fast
          applyUrl:    `https://jobs.careers.microsoft.com/global/en/job/${displayId}`,
          postedAt:    postedTs ? new Date(postedTs * 1000).toISOString() : null,
          type:        "Full-time",
        });
      }
      if (positions.length < PAGE_SIZE) break;
    } catch { break; }
  }

  console.log(`[playwright] Microsoft: ${results.length} raw`);
  return results;
}

// ── Google ────────────────────────────────────────────────────────────────
// Uses careers.google.com JSON API
// Spec: sort by date, 15 pages (no visible posted date on cards)
export async function fetchGoogleJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  const MAX_PAGES = 15;
  const PAGE_SIZE = 20;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        q:           "software engineer",
        location:    "United States",
        employment_type: "FULL_TIME",
        page:        String(page),
        num:         String(PAGE_SIZE),
        sort_by:     "date",
      });
      const res = await fetch(
        `https://careers.google.com/api/v3/search/?${params}`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(12_000),
        }
      );
      if (!res.ok) break;
      const data = await res.json();
      const jobs = (data.jobs ?? []) as Record<string, unknown>[];
      if (jobs.length === 0) break;

      for (const j of jobs) {
        const jobId = (j.id as string) ?? String(Math.random());
        const locs  = (j.locations ?? []) as string[];
        results.push({
          id:          `goog-${jobId}`,
          company:     "Google",
          title:       (j.title as string) ?? "",
          location:    locs[0] ?? "United States",
          description: (j.description as string) ?? "",
          applyUrl:    `https://careers.google.com/jobs/results/${jobId}`,
          postedAt:    (j.publish_date as string) ?? null,
          type:        "Full-time",
        });
      }
      if (jobs.length < PAGE_SIZE) break;
    } catch { break; }
  }

  console.log(`[playwright] Google: ${results.length} raw`);
  return results;
}

// ── Apple ─────────────────────────────────────────────────────────────────
// Uses jobs.apple.com search API (JSON)
export async function fetchAppleJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  const MAX_PAGES = 15;
  const PAGE_SIZE = 20;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        search:   "software engineer",
        sort:     "newest",
        filters:  "location=US",
        page:     String(page),
        pageSize: String(PAGE_SIZE),
      });
      const res = await fetch(
        `https://jobs.apple.com/api/role/search?${params}`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(12_000),
        }
      );
      if (!res.ok) break;
      const data = await res.json();
      const jobs = (data.searchResults ?? []) as Record<string, unknown>[];
      if (jobs.length === 0) break;

      for (const j of jobs) {
        const jobId   = (j.positionId as string) ?? String(Math.random());
        const locArr  = (j.locations ?? []) as Array<Record<string, unknown>>;
        const locName = (locArr[0]?.name as string) ?? "United States";
        results.push({
          id:          `aapl-${jobId}`,
          company:     "Apple",
          title:       (j.postingTitle as string) ?? "",
          location:    locName,
          description: (j.jobSummary as string) ?? "",
          applyUrl:    `https://jobs.apple.com/en-us/details/${jobId}`,
          postedAt:    (j.postDateInGMT as string) ?? null,
          type:        "Full-time",
        });
      }
      if (jobs.length < PAGE_SIZE) break;
    } catch { break; }
  }

  console.log(`[playwright] Apple: ${results.length} raw`);
  return results;
}

// ── Meta ──────────────────────────────────────────────────────────────────
// Uses metacareers.com GraphQL endpoint
export async function fetchMetaJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  const MAX_PAGES = 15;
  const PAGE_SIZE = 20;

  for (let cursor = 0; cursor < MAX_PAGES * PAGE_SIZE; cursor += PAGE_SIZE) {
    try {
      const res = await fetch("https://www.metacareers.com/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        body: new URLSearchParams({
          av:        "0",
          __user:    "0",
          __a:       "1",
          fb_dtsg:   "",
          variables: JSON.stringify({
            search_input: {
              q:                   "software engineer",
              divisions:           [],
              offices:             ["United States"],
              roles:               [],
              leadership_levels:   [],
              saved_jobs:          [],
              saved_searches:      [],
              sub_teams:           [],
              teams:               [],
              is_leadership:       false,
              is_remote_only:      false,
              sort_by_new:         true,
              page:                Math.floor(cursor / PAGE_SIZE),
              results_per_page:    PAGE_SIZE,
            },
          }),
          doc_id: "9915453765139688",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) break;
      const data = await res.json();
      const jobs = (
        data?.data?.job_search?.jobs ??
        data?.data?.careers_job_search?.jobs ??
        []
      ) as Record<string, unknown>[];
      if (jobs.length === 0) break;

      for (const j of jobs) {
        const jobId = (j.id as string) ?? String(Math.random());
        const locs  = (j.locations ?? []) as Array<Record<string, unknown>>;
        results.push({
          id:          `meta-${jobId}`,
          company:     "Meta",
          title:       (j.title as string) ?? "",
          location:    (locs[0]?.name as string) ?? "United States",
          description: (j.description as string) ?? (j.summary as string) ?? "",
          applyUrl:    `https://www.metacareers.com/jobs/${jobId}`,
          postedAt:    null, // Meta doesn't expose posted date in API
          type:        "Full-time",
        });
      }
      if (jobs.length < PAGE_SIZE) break;
    } catch { break; }
  }

  console.log(`[playwright] Meta: ${results.length} raw`);
  return results;
}

// ── Amazon ────────────────────────────────────────────────────────────────
// Uses Amazon Jobs API
export async function fetchAmazonJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  const MAX_PAGES = 15;
  const PAGE_SIZE = 10;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        base_query:    "software engineer",
        loc_query:     "United States",
        type:          "FULL_TIME",
        sort:          "recent",
        this_week:     "0",
        offset:        String((page - 1) * PAGE_SIZE),
        result_limit:  String(PAGE_SIZE),
        format:        "json",
        "radius[]:":   "24km",
      });
      const res = await fetch(
        `https://www.amazon.jobs/en/search.json?${params}`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(12_000),
        }
      );
      if (!res.ok) break;
      const data = await res.json();
      const jobs = (data.jobs ?? []) as Record<string, unknown>[];
      if (jobs.length === 0) break;

      for (const j of jobs) {
        const jobId = (j.id_icims as string) ?? String(Math.random());
        results.push({
          id:          `amzn-${jobId}`,
          company:     "Amazon",
          title:       (j.title as string) ?? "",
          location:    (j.normalized_location as string) ?? (j.city as string) ?? "United States",
          description: (j.description as string) ?? (j.description_short as string) ?? "",
          applyUrl:    `https://www.amazon.jobs/en/jobs/${jobId}`,
          postedAt:    (j.posted_date as string) ?? null,
          type:        "Full-time",
        });
      }
      if (jobs.length < PAGE_SIZE) break;
    } catch { break; }
  }

  console.log(`[playwright] Amazon: ${results.length} raw`);
  return results;
}

// ── JPMorgan Chase ────────────────────────────────────────────────────────
// Uses Oracle HCM REST API (JPMC careers)
export async function fetchJPMJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  const MAX_PAGES = 15;
  const PAGE_SIZE = 25;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const offset = page * PAGE_SIZE;
      const res = await fetch(
        `https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations,flexFieldsFacet.values&finder=findReqs;siteNumber=CX_1001,facetsList=LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS,limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC,keyword=software%20engineer,locationId=300000000149325`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(12_000),
        }
      );
      if (!res.ok) break;
      const data = await res.json();
      const items = (data.items ?? []) as Record<string, unknown>[];
      const reqs  = items.flatMap(i =>
        ((i.requisitionList ?? []) as Record<string, unknown>[])
      );
      if (reqs.length === 0) break;

      for (const j of reqs) {
        const jobId = (j.Id as string) ?? (j.requisitionId as string) ?? String(Math.random());
        const locObj = (j.primaryLocation as Record<string, unknown>) ?? {};
        results.push({
          id:          `jpm-${jobId}`,
          company:     "JPMorgan Chase",
          title:       (j.Title as string) ?? "",
          location:    (locObj.Name as string) ?? "United States",
          description: (j.ExternalDescriptionStr as string) ?? "",
          applyUrl:    `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${jobId}`,
          postedAt:    (j.PostedDate as string) ?? null,
          type:        "Full-time",
        });
      }
      if (reqs.length < PAGE_SIZE) break;
    } catch { break; }
  }

  console.log(`[playwright] JPMorgan: ${results.length} raw`);
  return results;
}

// ── Goldman Sachs (Oracle HCM) ─────────────────────────────────────────────
export async function fetchGoldmanSachsJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  const MAX_PAGES = 15;
  const PAGE_SIZE = 25;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const offset = page * PAGE_SIZE;
      // Goldman Sachs Oracle HCM REST endpoint
      const res = await fetch(
        `https://hdpc.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations,flexFieldsFacet.values&finder=findReqs;siteNumber=CX_1001,facetsList=LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS,limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC,keyword=software%20engineer`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(12_000),
        }
      );
      if (!res.ok) break;
      const data = await res.json();
      const items = (data.items ?? []) as Record<string, unknown>[];
      const reqs  = items.flatMap(i =>
        ((i.requisitionList ?? []) as Record<string, unknown>[])
      );
      if (reqs.length === 0) break;

      for (const j of reqs) {
        const jobId  = (j.Id as string) ?? (j.requisitionId as string) ?? String(Math.random());
        const locObj = (j.primaryLocation as Record<string, unknown>) ?? {};
        results.push({
          id:          `gs-${jobId}`,
          company:     "Goldman Sachs",
          title:       (j.Title as string) ?? "",
          location:    (locObj.Name as string) ?? "United States",
          description: (j.ExternalDescriptionStr as string) ?? "",
          applyUrl:    `https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${jobId}`,
          postedAt:    (j.PostedDate as string) ?? null,
          type:        "Full-time",
        });
      }
      if (reqs.length < PAGE_SIZE) break;
    } catch { break; }
  }

  console.log(`[playwright] Goldman Sachs: ${results.length} raw`);
  return results;
}

// ── OpenAI (Ashby) ────────────────────────────────────────────────────────
// Ashby public job board API: GET /api/jobPostings?organizationHostedJobsPageName={slug}
export async function fetchOpenAIJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  try {
    const res = await fetch(
      "https://api.ashbyhq.com/posting-api/job-board?organizationHostedJobsPageName=openai",
      {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      console.warn(`[playwright] OpenAI (Ashby) HTTP ${res.status}`);
      return results;
    }
    const data = await res.json();
    const jobs = (data.jobs ?? data.jobPostings ?? []) as Record<string, unknown>[];

    for (const j of jobs) {
      const jobId   = (j.id as string) ?? String(Math.random());
      const locArr  = ((j.location as Record<string,unknown>)?.name as string) ?? (j.locationName as string) ?? "United States";
      const applyUrl = (j.jobUrl as string) ?? `https://openai.com/careers`;
      results.push({
        id:          `openai-${jobId}`,
        company:     "OpenAI",
        title:       (j.title as string) ?? "",
        location:    locArr,
        description: (j.descriptionPlain as string) ?? (j.description as string) ?? "",
        applyUrl,
        postedAt:    (j.publishedDate as string) ?? (j.createdAt as string) ?? null,
        type:        "Full-time",
      });
    }
  } catch (e) {
    console.warn(`[playwright] OpenAI fetch error: ${e}`);
  }

  console.log(`[playwright] OpenAI: ${results.length} raw`);
  return results;
}

// ── Netflix (Lever) ───────────────────────────────────────────────────────
// Lever public API: GET https://api.lever.co/v0/postings/{company}?mode=json
export async function fetchNetflixJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  try {
    const res = await fetch(
      "https://api.lever.co/v0/postings/netflix?mode=json&limit=500",
      {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      console.warn(`[playwright] Netflix (Lever) HTTP ${res.status}`);
      return results;
    }
    const jobs = (await res.json()) as Record<string, unknown>[];

    for (const j of jobs) {
      const jobId   = (j.id as string) ?? String(Math.random());
      const locObj  = (j.categories as Record<string, unknown>) ?? {};
      const location = (locObj.location as string) ?? (locObj.city as string) ?? "United States";
      results.push({
        id:          `netflix-${jobId}`,
        company:     "Netflix",
        title:       (j.text as string) ?? "",
        location,
        description: ((j.descriptionPlain as string) ?? (j.description as string) ?? "").slice(0, 1200),
        applyUrl:    (j.hostedUrl as string) ?? `https://jobs.lever.co/netflix/${jobId}`,
        postedAt:    j.createdAt ? new Date(j.createdAt as number).toISOString() : null,
        type:        "Full-time",
      });
    }
  } catch (e) {
    console.warn(`[playwright] Netflix fetch error: ${e}`);
  }

  console.log(`[playwright] Netflix: ${results.length} raw`);
  return results;
}

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
// Uses msft careers search API — returns JSON job listings
// Spec: sort by date, paginate up to 15 pages (no visible date on cards)
export async function fetchMicrosoftJobs(): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  const MAX_PAGES = 15;
  const PAGE_SIZE = 20;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const res = await fetch(
        "https://gcsservices.careers.microsoft.com/search/api/v1/search",
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(12_000),
        }
      );

      // Fallback to public search endpoint
      const params = new URLSearchParams({
        q:        "software engineer",
        l:        "en_us",
        pg:       String(page + 1),
        pgSz:     String(PAGE_SIZE),
        o:        "Relevance",
        flt:      "",
      });
      const res2 = await fetch(
        `https://jobs.careers.microsoft.com/global/en/search?${params}`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(12_000),
        }
      );
      if (!res2.ok) break;
      const data = await res2.json();
      const jobs = (data.operationResult?.result?.jobs ?? []) as Record<string, unknown>[];
      if (jobs.length === 0) break;

      for (const j of jobs) {
        const jobId = (j.jobId as string) ?? String(Math.random());
        results.push({
          id:          `msft-${jobId}`,
          company:     "Microsoft",
          title:       (j.title as string) ?? "",
          location:    (j.location as string) ?? "United States",
          description: (j.description as string) ?? "",
          applyUrl:    `https://jobs.careers.microsoft.com/global/en/job/${jobId}`,
          postedAt:    (j.postingDate as string) ?? null,
          type:        "Full-time",
        });
      }
      if (jobs.length < PAGE_SIZE) break;
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

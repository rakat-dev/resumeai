import { NextRequest, NextResponse } from "next/server";

export type JobFilter = "24h" | "7d" | "30d" | "any";

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  type: string;
  salary?: string;
  description: string;
  applyUrl: string;
  postedAt: string;
  postedDate: string;
  postedTimestamp: number;
  source: string;
  sourceType: "jsearch" | "greenhouse" | "lever" | "remotive" | "workday" | "other";
  skills: string[];
  sponsorshipTag: "mentioned" | "not_mentioned";
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SKILL_KEYWORDS = [
  "React","Next.js","TypeScript","JavaScript","Python","Java","Spring Boot","Node.js",
  "AWS","Azure","GCP","Docker","Kubernetes","PostgreSQL","MongoDB","Redis","GraphQL",
  "REST","Microservices","CI/CD","Git","Agile","Scrum","Go","Rust","Swift","Kotlin",
  "Angular","Vue","Django","FastAPI","Terraform","Linux","SQL","NoSQL","Machine Learning",
  "AI","LLM","TensorFlow","PyTorch","Kafka","Spark","Elasticsearch",
];

function extractSkills(description: string): string[] {
  return SKILL_KEYWORDS.filter(skill =>
    new RegExp(`\\b${skill.replace(".", "\\.")}\\b`, "i").test(description)
  ).slice(0, 6);
}

function detectSponsorship(description: string): "mentioned" | "not_mentioned" {
  const keywords = ["sponsor","h-1b","h1b","visa","work authorization","work permit","ead","opt","cpt","green card"];
  const lc = description.toLowerCase();
  return keywords.some(k => lc.includes(k)) ? "mentioned" : "not_mentioned";
}

function formatPostedDate(timestampSeconds: number): string {
  const diff = Date.now() - timestampSeconds * 1000;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function isContractOrPartTime(type: string, description: string): boolean {
  const lc = (type + " " + description.slice(0, 300)).toLowerCase();
  return /\bcontract(or)?\b|\bpart.?time\b|\bintern(ship)?\b|\bfreelance\b|\btemporary\b|\btemp\b/.test(lc);
}

function deduplicateJobs(jobs: Job[]): Job[] {
  const seenIds = new Set<string>();
  const seenTitleCompany = new Set<string>();
  return jobs.filter(job => {
    const key2 = `${job.title.toLowerCase().trim()}|||${job.company.toLowerCase().trim()}`;
    if (seenIds.has(job.id) || seenTitleCompany.has(key2)) return false;
    seenIds.add(job.id);
    seenTitleCompany.add(key2);
    return true;
  });
}

function generateAlternateQuery(query: string): string {
  const q = query.trim();
  if (/developer/i.test(q)) return q.replace(/developer/i, "Engineer");
  if (/engineer/i.test(q)) return q.replace(/engineer/i, "Developer");
  if (/\bjava\b/i.test(q) && !/spring/i.test(q)) return q + " Spring Boot";
  if (/react/i.test(q) && !/frontend/i.test(q)) return "Frontend " + q;
  if (/python/i.test(q) && !/backend/i.test(q)) return "Backend " + q;
  return q + " full time";
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>(res => setTimeout(() => res(fallback), ms)),
  ]);
}

// ── JSearch (RapidAPI) ─────────────────────────────────────────────────────

const DATE_MAP: Record<JobFilter, string> = {
  "24h": "today", "7d": "week", "30d": "month", "any": "",
};

async function fetchJSearch(query: string, filter: JobFilter, page = 1): Promise<Job[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    query,
    page: String(page),
    num_pages: "5",
    employment_types: "FULLTIME",
    ...(DATE_MAP[filter] && { date_posted: DATE_MAP[filter] }),
  });

  try {
    const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.data || [])
      .map((j: Record<string, unknown>, i: number): Job => {
        const desc = (j.job_description as string) || "";
        const empType = (j.job_employment_type as string) || "FULLTIME";
        const ts = (j.job_posted_at_timestamp as number) || 0;
        return {
          id: (j.job_id as string) || `js-${page}-${i}`,
          title: (j.job_title as string) || "",
          company: (j.employer_name as string) || "",
          location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || "Remote",
          type: empType,
          salary: j.job_min_salary
            ? `$${Math.round(Number(j.job_min_salary)/1000)}k–$${Math.round(Number(j.job_max_salary)/1000)}k`
            : undefined,
          description: desc.slice(0, 600),
          applyUrl: (j.job_apply_link as string) || "#",
          postedAt: (j.job_posted_at_datetime_utc as string) || "",
          postedDate: ts ? formatPostedDate(ts) : "Recently",
          postedTimestamp: ts,
          source: (j.job_publisher as string) || "Job Board",
          sourceType: "jsearch",
          skills: extractSkills(desc),
          sponsorshipTag: detectSponsorship(desc),
        };
      })
      .filter((j: Job) => j.title && j.company && !isContractOrPartTime(j.type, j.description));
  } catch {
    return [];
  }
}

// ── Greenhouse (official free API) ─────────────────────────────────────────

const GREENHOUSE_COMPANIES = [
  "airbnb","stripe","doordash","openai","coinbase","gusto","brex","notion",
  "plaid","lattice","figma","robinhood","benchling","mixpanel","amplitude",
  "segment","flexport","mercury","ramp","checkr",
];

async function fetchGreenhouse(query: string): Promise<Job[]> {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const results: Job[] = [];

  await Promise.allSettled(
    GREENHOUSE_COMPANIES.map(async company => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
          { next: { revalidate: 3600 } }
        );
        if (!res.ok) return;
        const data = await res.json();

        for (const j of (data.jobs || []) as Record<string, unknown>[]) {
          const title = (j.title as string) || "";
          const rawContent = (j.content as string) || "";
          const desc = rawContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600);
          const location = ((j.location as Record<string, unknown>)?.name as string) || "Remote";
          const url = (j.absolute_url as string) || "#";
          const updatedAt = (j.updated_at as string) || "";

          // Relevance filter
          const combined = (title + " " + desc).toLowerCase();
          if (!qWords.some(w => combined.includes(w))) continue;
          // Full-time filter
          if (isContractOrPartTime("", desc)) continue;

          const ts = updatedAt ? Math.floor(new Date(updatedAt).getTime() / 1000) : 0;
          const displayName = company.charAt(0).toUpperCase() + company.slice(1);

          results.push({
            id: `gh-${company}-${j.id ?? Math.random()}`,
            title,
            company: displayName,
            location,
            type: "Full-time",
            description: desc,
            applyUrl: url,
            postedAt: updatedAt,
            postedDate: ts ? formatPostedDate(ts) : "Recently",
            postedTimestamp: ts,
            source: "Greenhouse",
            sourceType: "greenhouse",
            skills: extractSkills(desc),
            sponsorshipTag: detectSponsorship(desc),
          });
        }
      } catch { /* skip */ }
    })
  );
  return results;
}

// ── Lever (official free API) ──────────────────────────────────────────────

const LEVER_COMPANIES = [
  "netflix","reddit","webflow","miro","airtable","asana","attentive",
  "loom","superhuman","deel","remote","scale-ai","alchemy",
  "postman","vercel","neo4j","monzo","launchdarkly","envoy","sourcegraph",
];

async function fetchLever(query: string): Promise<Job[]> {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const results: Job[] = [];

  await Promise.allSettled(
    LEVER_COMPANIES.map(async company => {
      try {
        const res = await fetch(
          `https://api.lever.co/v0/postings/${company}?mode=json`,
          { next: { revalidate: 3600 } }
        );
        if (!res.ok) return;
        const jobs = await res.json();
        if (!Array.isArray(jobs)) return;

        for (const j of jobs as Record<string, unknown>[]) {
          const title = (j.text as string) || "";
          const plainDesc = (j.descriptionPlain as string) || "";
          const desc = plainDesc.slice(0, 600);
          const cats = (j.categories as Record<string, unknown>) || {};
          const commitment = (cats.commitment as string) || "";
          const location = (cats.location as string) || "Remote";
          const url = (j.hostedUrl as string) || "#";
          const createdAt = (j.createdAt as number) || 0;

          const combined = (title + " " + desc).toLowerCase();
          if (!qWords.some(w => combined.includes(w))) continue;
          if (isContractOrPartTime(commitment, desc)) continue;

          const ts = createdAt > 1e10 ? Math.floor(createdAt / 1000) : createdAt;
          const displayName = company.charAt(0).toUpperCase() + company.slice(1).replace(/-/g, " ");

          results.push({
            id: `lever-${company}-${j.id ?? Math.random()}`,
            title,
            company: displayName,
            location,
            type: commitment || "Full-time",
            description: desc,
            applyUrl: url,
            postedAt: createdAt ? new Date(createdAt > 1e10 ? createdAt : createdAt * 1000).toISOString() : "",
            postedDate: ts ? formatPostedDate(ts) : "Recently",
            postedTimestamp: ts,
            source: "Lever",
            sourceType: "lever",
            skills: extractSkills(desc),
            sponsorshipTag: detectSponsorship(desc),
          });
        }
      } catch { /* skip */ }
    })
  );
  return results;
}

// ── Remotive (free remote-jobs API, no key needed) ─────────────────────────

async function fetchRemotive(query: string): Promise<Job[]> {
  try {
    const res = await fetch(
      `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=50`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return [];
    const data = await res.json();

    return ((data.jobs || []) as Record<string, unknown>[])
      .filter(j => !isContractOrPartTime((j.job_type as string) || "", (j.description as string) || ""))
      .map((j, i): Job => {
        const desc = ((j.description as string) || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600);
        const pubDate = (j.publication_date as string) || "";
        const ts = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;
        return {
          id: `remotive-${j.id ?? i}`,
          title: (j.title as string) || "",
          company: (j.company_name as string) || "",
          location: (j.candidate_required_location as string) || "Remote",
          type: (j.job_type as string) || "Full-time",
          description: desc,
          applyUrl: (j.url as string) || "#",
          postedAt: pubDate,
          postedDate: ts ? formatPostedDate(ts) : "Recently",
          postedTimestamp: ts,
          source: "Remotive",
          sourceType: "other",
          skills: extractSkills(desc),
          sponsorshipTag: detectSponsorship(desc),
        };
      });
  } catch {
    return [];
  }
}

// ── Workday (direct REST, company-specific) ────────────────────────────────

interface WorkdayCompany { tenant: string; site: string; name: string; variant?: string; }

const WORKDAY_COMPANIES: WorkdayCompany[] = [
  { tenant: "amazon",     site: "External_Career_Site", name: "Amazon" },
  { tenant: "adobe",      site: "external",             name: "Adobe" },
  { tenant: "salesforce", site: "External_Career_Site", name: "Salesforce" },
  { tenant: "dell",       site: "External-careers",     name: "Dell",    variant: "wd1" },
  { tenant: "target",     site: "careersus",            name: "Target" },
  { tenant: "paypal",     site: "jobs",                 name: "PayPal" },
];

async function fetchWorkday(query: string): Promise<Job[]> {
  const results: Job[] = [];

  await Promise.allSettled(
    WORKDAY_COMPANIES.map(async ({ tenant, site, name, variant = "wd5" }) => {
      try {
        const res = await fetch(
          `https://${tenant}.${variant}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: query }),
            next: { revalidate: 1800 },
          }
        );
        if (!res.ok) return;
        const data = await res.json();

        for (const j of (data.jobPostings || []) as Record<string, unknown>[]) {
          const title = (j.title as string) || "";
          if (!title) continue;

          const desc = ((j.jobDescription as Record<string, unknown>)?.items as string || "")
            .replace(/<[^>]+>/g, " ").slice(0, 600);
          const location = (j.locationsText as string) || "Remote";
          const externalPath = (j.externalPath as string) || "";
          const url = externalPath
            ? `https://${tenant}.${variant}.myworkdayjobs.com${externalPath}`
            : "#";
          const postedOn = (j.postedOn as string) || "";
          const ts = postedOn ? Math.floor(new Date(postedOn).getTime() / 1000) : 0;

          if (isContractOrPartTime("", desc)) continue;

          results.push({
            id: `wd-${tenant}-${Math.random().toString(36).slice(2)}`,
            title,
            company: name,
            location,
            type: "Full-time",
            description: desc,
            applyUrl: url,
            postedAt: postedOn,
            postedDate: ts ? formatPostedDate(ts) : "Recently",
            postedTimestamp: ts,
            source: "Workday",
            sourceType: "workday",
            skills: extractSkills(desc),
            sponsorshipTag: detectSponsorship(desc),
          });
        }
      } catch { /* skip */ }
    })
  );
  return results;
}

// ── SuccessFactors (hidden RSS/sitemal.xml feed) ───────────────────────────

interface SFCompany { slug: string; name: string; }

const SF_COMPANIES: SFCompany[] = [
  { slug: "careers.walmart",  name: "Walmart"  },
  { slug: "jobs.boeing",      name: "Boeing"   },
  { slug: "jobs.sap",         name: "SAP"      },
];

async function fetchSuccessFactors(query: string): Promise<Job[]> {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const results: Job[] = [];

  await Promise.allSettled(
    SF_COMPANIES.map(async ({ slug, name }) => {
      try {
        const res = await fetch(`https://${slug}.com/sitemal.xml`, {
          next: { revalidate: 3600 },
        });
        if (!res.ok) return;
        const xml = await res.text();

        // Parse XML job entries
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of items) {
          const getTag = (tag: string) => item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() || "";
          const title = getTag("title").replace(/<!\[CDATA\[(.*?)\]\]>/, "$1");
          const url = getTag("link").replace(/<!\[CDATA\[(.*?)\]\]>/, "$1");
          const desc = getTag("description").replace(/<!\[CDATA\|(.*?)\]\]>/,"$1").replace(/<[^>]+>/g, " ").slice(0, 600);

          const combined = (title + " " + desc).toLowerCase();
          if (!qWords.some(w => combined.includes(w))) continue;
          if (isContractOrPartTime("", desc)) continue;

          results.push({
            id: `sf-${slug}-${Math.random().toString(36).slice(2)}`,
            title,
            company: name,
            location: "See listing",
            type: "Full-time",
            description: desc,
            applyUrl: url,
            postedAt: "",
            postedDate: "Recently",
            postedTimestamp: 0,
            source: "SuccessFactors",
            sourceType: "other",
            skills: extractSkills(desc),
            sponsorshipTag: detectSponsorship(desc),
          });
        }
      } catch { /* skip */ }
    })
  );
  return results;
}

// ── Main Handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "";
  const filter = (searchParams.get("filter") as JobFilter) || "any";

  if (!query.trim()) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  const altQuery = generateAlternateQuery(query);

  try {
    // Fire ALL sources in parallel with timeouts so slow ones don't block
    const [r1, r2, r3, r4, r5, r6, r7] = await Promise.allSettled([
      withTimeout(fetchJSearch(query, filter, 1),     8000, []),
      withTimeout(fetchJSearch(query, filter, 2),     8000, []),
      withTimeout(fetchJSearch(altQuery, filter, 1),  8000, []),
      withTimeout(fetchGreenhouse(query),             10000, []),
      withTimeout(fetchLever(query),                  10000, []),
      withTimeout(fetchRemotive(query),                6000, []),
      withTimeout(fetchWorkday(query),                 8000, []),
      // SuccessFactors is slow/unreliable — run but don't wait long
    ]);

    // SuccessFactors in background (fire-and-forget for now; can be added back with cache)
    // withTimeout(fetchSuccessFactors(query), 5000, []);

    const allJobs: Job[] = [
      ...(r1.status === "fulfilled" ? r1.value : []),
      ...(r2.status === "fulfilled" ? r2.value : []),
      ...(r3.status === "fulfilled" ? r3.value : []),
      ...(r4.status === "fulfilled" ? r4.value : []),
      ...(r5.status === "fulfilled" ? r5.value : []),
      ...(r6.status === "fulfilled" ? r6.value : []),
      ...(r7.status === "fulfilled" ? r7.value : []),
    ].filter(j => j.title && j.company);

    // Deduplicate then sort newest first
    const unique = deduplicateJobs(allJobs);
    unique.sort((a, b) => (b.postedTimestamp || 0) - (a.postedTimestamp || 0));

    const sourceCounts = {
      jsearch: unique.filter(j => j.sourceType === "jsearch").length,
      greenhouse: unique.filter(j => j.sourceType === "greenhouse").length,
      lever: unique.filter(j => j.sourceType === "lever").length,
      remotive: unique.filter(j => j.sourceType === "other").length,
      workday: unique.filter(j => j.sourceType === "workday").length,
    };

    return NextResponse.json({ jobs: unique, count: unique.length, sources: sourceCounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Jobs API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
  skills: string[];          // Gap skills: mentioned in JD but NOT in base resume
  sponsorshipTag: "mentioned" | "not_mentioned";
  experience?: string;       // "0-1yr" | "1-3yr" | "4-6yr" | "6+yr"
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Decode HTML entities then strip all tags */
function cleanDescription(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Master skill keyword list
const SKILL_KEYWORDS = [
  "React","Next.js","Vue","TypeScript","JavaScript","Angular",
  "Python","Java","Go","Golang","Rust","Swift","Kotlin","Scala","PHP","Ruby","C++","C#",
  "Spring Boot","Node.js","Django","FastAPI","Express","Flask",
  "AWS","Azure","GCP","Docker","Kubernetes","Terraform","Linux","Ansible","Helm",
  "PostgreSQL","MongoDB","Redis","Elasticsearch","MySQL","SQL","NoSQL","Cassandra","DynamoDB",
  "GraphQL","gRPC","Kafka","RabbitMQ","Spark","Flink","Airflow",
  "Machine Learning","LLM","TensorFlow","PyTorch","OpenAI","LangChain",
  "CI/CD","Jenkins","GitHub Actions","ArgoCD",
  "Microservices","DevOps","SRE","DataDog","Prometheus","Grafana",
];

// Rahul's current skills — used to find GAP skills (in JD but not in resume)
const BASE_RESUME_TEXT = [
  "React Angular TypeScript JavaScript CSS3 React Hooks",
  "Java Spring Boot Spring MVC Spring Security REST Microservices Hibernate OAuth JWT",
  "AWS EC2 ECS EKS S3 RDS Lambda API Gateway IAM VPC Docker Kubernetes CI/CD Jenkins GitLab Maven",
  "Kafka SNS SQS PostgreSQL MySQL Oracle MongoDB Redis",
  "JUnit Mockito Selenium Splunk Dynatrace Kibana CloudWatch",
  "Agile Scrum Jira Git Python GitHub",
].join(" ");

/** Returns skills mentioned in JD that are NOT in the base resume */
function extractMissingSkills(description: string): string[] {
  return SKILL_KEYWORDS.filter(skill => {
    const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return regex.test(description) && !regex.test(BASE_RESUME_TEXT);
  }).slice(0, 6);
}

function detectSponsorship(description: string): "mentioned" | "not_mentioned" {
  const keywords = ["sponsor","h-1b","h1b","visa","work authorization","work permit","ead","opt","cpt","green card"];
  const lc = description.toLowerCase();
  return keywords.some(k => lc.includes(k)) ? "mentioned" : "not_mentioned";
}

function extractExperience(description: string): string {
  const m =
    description.match(/(\d+)\+?\s*(?:to|-)\s*\d+\s*years?\s*(?:of\s*)?(?:relevant\s*)?(?:experience|exp)/i) ||
    description.match(/(\d+)\+\s*years?\s*(?:of\s*)?(?:relevant\s*)?(?:experience|exp)/i) ||
    description.match(/(?:at\s+least|minimum(?:\s+of)?)\s+(\d+)\s*years?\s*(?:of\s*)?(?:experience|exp)/i) ||
    description.match(/(\d+)\s*years?\s*(?:of\s*)?(?:experience|exp)/i);
  if (!m) return "";
  const y = parseInt(m[1]);
  if (y <= 1) return "0-1yr";
  if (y <= 3) return "1-3yr";
  if (y <= 6) return "4-6yr";
  return "6+yr";
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

// ── Title relevance filtering ──────────────────────────────────────────────

const TITLE_ALLOWLIST =
  /\b(engineer|developer|architect|programmer|swe|java|python|node\.?js|golang|\bgo\b|react|angular|vue|frontend|back.?end|full.?stack|software|web\s|cloud|devops|sre|platform|typescript|javascript|spring|kotlin|scala|rust|swift|api\s|infrastructure|reliability|embedded|mobile|ios|android|data\s+engineer|ml\s+engineer|ai\s+engineer)\b/i;

const TITLE_BLOCKLIST =
  /\b(manager|director|recruiter|recruitment|machine\s+learning\s+scientist|data\s+scientist|auditor|qa\s+lead|qa\s+manager|test\s+lead|product\s+manager|marketing|talent|acquisition|hr\b|finance|accounting|legal|vp\b|vice\s+president|chief|officer|sales|business\s+analyst|scrum\s+master|project\s+manager|program\s+manager|relationship\s+manager)\b/i;

function isRelevantTitle(title: string): boolean {
  return TITLE_ALLOWLIST.test(title) && !TITLE_BLOCKLIST.test(title);
}

// ── Fortune 500 / tier-1 tech company ranking ──────────────────────────────

const TIER1_NAMES = [
  "amazon","google","microsoft","apple","meta","netflix","salesforce","adobe","ibm","oracle",
  "intel","nvidia","twitter","linkedin","uber","lyft","airbnb","stripe","doordash","coinbase",
  "robinhood","paypal","square","shopify","atlassian","jpmorgan","goldman sachs","visa",
  "walmart","target","boeing","lockheed","unitedhealth","openai","anthropic",
  "palantir","databricks","snowflake","cloudflare","hashicorp","datadog","twilio",
  "elastic","mongodb","confluent","hpe","vmware","dell","cisco","qualcomm",
  "amd","broadcom","sap","workday","servicenow","zendesk","hubspot",
  "dropbox","zoom","okta","crowdstrike","palo alto","fortinet","zscaler",
  "ramp","brex","notion","plaid","figma","gusto","checkr","mercury","flexport",
];

function getTierScore(company: string): number {
  const lc = company.toLowerCase();
  return TIER1_NAMES.some(t => lc === t || lc.includes(t)) ? 1 : 0;
}

function deduplicateJobs(jobs: Job[]): Job[] {
  const seenIds = new Set<string>();
  const seenTitleCompany = new Set<string>();
  return jobs.filter(job => {
    const key = `${job.title.toLowerCase().trim()}|||${job.company.toLowerCase().trim()}`;
    if (seenIds.has(job.id) || seenTitleCompany.has(key)) return false;
    seenIds.add(job.id);
    seenTitleCompany.add(key);
    return true;
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), ms))]);
}

// ── JSearch (RapidAPI) ─────────────────────────────────────────────────────

const DATE_MAP: Record<JobFilter, string> = {
  "24h": "today", "7d": "week", "30d": "month", "any": "",
};

async function fetchJSearch(query: string, filter: JobFilter, page = 1): Promise<Job[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.warn("JSearch: RAPIDAPI_KEY not set — skipping");
    return [];
  }

  // NOTE: employment_types="FULLTIME" is a PAID-TIER-ONLY param that silently returns 0 results on free tier.
  // We filter full-time server-side via isContractOrPartTime() instead.
  const params = new URLSearchParams({
    query,
    page: String(page),
    num_pages: "3",          // was 5 — reduce quota burn
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

    if (!res.ok) {
      console.error(`JSearch HTTP ${res.status} for query="${query}" page=${page}`);
      return [];
    }

    const data = await res.json();
    const raw = data.data || [];
    console.log(`JSearch: query="${query}" page=${page} → ${raw.length} raw results`);

    return (raw as Record<string, unknown>[])
      .map((j, i): Job => {
        const rawDesc = (j.job_description as string) || "";
        const desc = cleanDescription(rawDesc).slice(0, 600);
        const empType = (j.job_employment_type as string) || "Full-time";
        const ts = (j.job_posted_at_timestamp as number) || 0;
        return {
          id: (j.job_id as string) || `js-${page}-${i}`,
          title: (j.job_title as string) || "",
          company: (j.employer_name as string) || "",
          location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || "Remote",
          type: empType,
          salary: j.job_min_salary
            ? `$${Math.round(Number(j.job_min_salary) / 1000)}k–$${Math.round(Number(j.job_max_salary) / 1000)}k`
            : undefined,
          description: desc,
          applyUrl: (j.job_apply_link as string) || "#",
          postedAt: (j.job_posted_at_datetime_utc as string) || "",
          postedDate: ts ? formatPostedDate(ts) : "Recently",
          postedTimestamp: ts,
          source: (j.job_publisher as string) || "Job Board",
          sourceType: "jsearch",
          skills: extractMissingSkills(rawDesc),
          sponsorshipTag: detectSponsorship(rawDesc),
          experience: extractExperience(rawDesc),
        };
      })
      .filter(j => j.title && j.company && isRelevantTitle(j.title) && !isContractOrPartTime(j.type, j.description));
  } catch (err) {
    console.error(`JSearch exception query="${query}" page=${page}:`, err);
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
          // Title-only relevance check — prevents irrelevant non-eng roles flooding results
          if (!isRelevantTitle(title)) continue;

          const rawContent = (j.content as string) || "";
          const desc = cleanDescription(rawContent).slice(0, 600);
          const location = ((j.location as Record<string, unknown>)?.name as string) || "Remote";
          const url = (j.absolute_url as string) || "#";
          const updatedAt = (j.updated_at as string) || "";

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
            skills: extractMissingSkills(rawContent),
            sponsorshipTag: detectSponsorship(rawContent),
            experience: extractExperience(rawContent),
          });
        }
      } catch { /* skip company */ }
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
          if (!isRelevantTitle(title)) continue;

          const plainDesc = (j.descriptionPlain as string) || "";
          const rawDesc = (j.description as string) || plainDesc;
          const desc = cleanDescription(plainDesc || rawDesc).slice(0, 600);
          const cats = (j.categories as Record<string, unknown>) || {};
          const commitment = (cats.commitment as string) || "";
          const location = (cats.location as string) || "Remote";
          const url = (j.hostedUrl as string) || "#";
          const createdAt = (j.createdAt as number) || 0;

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
            skills: extractMissingSkills(rawDesc),
            sponsorshipTag: detectSponsorship(rawDesc),
            experience: extractExperience(rawDesc),
          });
        }
      } catch { /* skip company */ }
    })
  );
  return results;
}

// ── Remotive (free remote-jobs API) ───────────────────────────────────────

async function fetchRemotive(query: string): Promise<Job[]> {
  try {
    const res = await fetch(
      `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=50`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return [];
    const data = await res.json();

    return ((data.jobs || []) as Record<string, unknown>[])
      .filter(j => {
        const title = (j.title as string) || "";
        return isRelevantTitle(title) &&
          !isContractOrPartTime((j.job_type as string) || "", (j.description as string) || "");
      })
      .map((j, i): Job => {
        const rawDesc = (j.description as string) || "";
        const desc = cleanDescription(rawDesc).slice(0, 600);
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
          skills: extractMissingSkills(rawDesc),
          sponsorshipTag: detectSponsorship(rawDesc),
          experience: extractExperience(rawDesc),
        };
      });
  } catch {
    return [];
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "";
  const filter = (searchParams.get("filter") as JobFilter) || "any";

  if (!query.trim()) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  try {
    // 2 JSearch calls + free sources in parallel
    // JSearch timeout raised to 15s (avg response ~7.6s on free tier)
    const [r1, r2, r3, r4, r5] = await Promise.allSettled([
      withTimeout(fetchJSearch(query, filter, 1),  15000, []),
      withTimeout(fetchJSearch(query, filter, 2),  15000, []),
      withTimeout(fetchGreenhouse(query),           10000, []),
      withTimeout(fetchLever(query),                10000, []),
      withTimeout(fetchRemotive(query),              6000, []),
    ]);

    const allJobs: Job[] = [
      ...(r1.status === "fulfilled" ? r1.value : []),
      ...(r2.status === "fulfilled" ? r2.value : []),
      ...(r3.status === "fulfilled" ? r3.value : []),
      ...(r4.status === "fulfilled" ? r4.value : []),
      ...(r5.status === "fulfilled" ? r5.value : []),
    ].filter(j => j.title && j.company);

    // Deduplicate then sort: Fortune 500 / tier-1 companies first, then newest
    const unique = deduplicateJobs(allJobs);
    unique.sort((a, b) => {
      const tier = getTierScore(b.company) - getTierScore(a.company);
      if (tier !== 0) return tier;
      return (b.postedTimestamp || 0) - (a.postedTimestamp || 0);
    });

    const sourceCounts = {
      jsearch:    unique.filter(j => j.sourceType === "jsearch").length,
      greenhouse: unique.filter(j => j.sourceType === "greenhouse").length,
      lever:      unique.filter(j => j.sourceType === "lever").length,
      remotive:   unique.filter(j => j.sourceType === "other").length,
      workday:    unique.filter(j => j.sourceType === "workday").length,
    };

    console.log(
      `Jobs API: "${query}" → ${unique.length} jobs | ` +
      `jsearch:${sourceCounts.jsearch} gh:${sourceCounts.greenhouse} lever:${sourceCounts.lever} remotive:${sourceCounts.remotive}`
    );

    return NextResponse.json({ jobs: unique, count: unique.length, sources: sourceCounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Jobs API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

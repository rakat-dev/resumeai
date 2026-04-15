import { NextRequest, NextResponse } from "next/server";
import {
  expandQuery, shouldExcludeTitle, scoreSponsorshipSignal,
  scoreTitleRelevance, scoreRecency,
} from "@/lib/queryExpansion";

export const maxDuration = 60; // Vercel max: 60s on hobby, 300s on pro
export type JobFilter = "24h" | "7d" | "30d" | "any";
export type SortOption = "date_desc" | "date_asc" | "company_desc" | "company_asc";

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
  sourceType: "jsearch"|"greenhouse"|"lever"|"remotive"|"workday"|"goldman"|"morganstanley"|"cisco"|"oracle"|"adzuna"|"other";
  skills: string[];
  sponsorshipTag: "mentioned"|"not_mentioned";
  experience?: string;
  priorityTier?: "highest"|"high"|"must_apply";
  fortuneRank?: number;
  relevanceScore?: number;
}

// ── Source diagnostics ─────────────────────────────────────────────────────
export interface SourceStatus {
  status: "healthy"|"degraded"|"broken"|"skipped";
  fetched: number;
  kept: number;
  error?: string;
}

export interface SourceDiagnostic {
  source: string;
  called: boolean;
  status: "success"|"degraded"|"error"|"skipped"|"timeout";
  rawCount: number;
  postFilterCount: number;
  error: string|null;
}

// ── Fortune 500 ranking ────────────────────────────────────────────────────
const FORTUNE_RANK: Record<string,number> = {
  "walmart":1,"amazon":2,"apple":3,"unitedhealth":4,"microsoft":5,
  "cvs":6,"elevance":7,"at&t":8,"cigna":9,"costco":10,
  "home depot":11,"jpmorgan":12,"jpmorgan chase":12,"verizon":13,
  "meta":14,"target":15,"fedex":16,"bank of america":17,
  "wells fargo":18,"ups":19,"lowe's":20,"lowes":20,
  "morgan stanley":21,"ibm":22,"intel":23,"cisco":24,
  "oracle":25,"salesforce":26,"adobe":27,"sap":28,"workday":29,
  "servicenow":30,"atlassian":31,"nvidia":32,"capital one":33,
  "t-mobile":34,"google":35,"alphabet":35,
  "stripe":36,"databricks":37,"snowflake":38,
  "cloudflare":39,"mongodb":40,"confluent":41,"hashicorp":42,
  "openai":43,"anthropic":44,"accenture":45,"infosys":46,
  "cognizant":47,"tata consultancy":48,"tcs":48,"capgemini":49,
  "paypal":50,"visa":51,"mastercard":52,
  "goldman sachs":53,"s&p":54,"sp global":54,
};

function getFortuneTier(company: string): number {
  const lc = company.toLowerCase();
  for (const [key, rank] of Object.entries(FORTUNE_RANK)) {
    if (lc === key || lc.includes(key)) return rank;
  }
  return 9999;
}

// ── Priority tiers ─────────────────────────────────────────────────────────
const PRIORITY_MAP: Record<string,"highest"|"high"|"must_apply"> = {
  "microsoft":"highest","amazon":"highest","google":"highest","apple":"highest",
  "meta":"highest","oracle":"highest","intel":"highest","cisco":"highest","ibm":"highest",
  "salesforce":"highest","walmart":"highest","jpmorgan":"highest","goldman sachs":"highest",
  "morgan stanley":"highest","bank of america":"highest","wells fargo":"highest",
  "capital one":"highest","target":"highest","home depot":"highest",
  "lowe's":"highest","lowes":"highest","costco":"highest",
  "unitedhealth":"highest","elevance":"highest","cvs":"highest",
  "nvidia":"high","databricks":"high","snowflake":"high","hashicorp":"high",
  "cloudflare":"high","mongodb":"high","confluent":"high","servicenow":"high",
  "workday":"high","atlassian":"high","sap":"high","adobe":"high",
  "t-mobile":"high","at&t":"high","verizon":"high","s&p":"high","sp global":"high",
  "cigna":"must_apply","openai":"must_apply","anthropic":"must_apply",
  "accenture":"must_apply","cognizant":"must_apply","infosys":"must_apply",
  "tata consultancy":"must_apply","tcs":"must_apply","capgemini":"must_apply",
  "paypal":"must_apply","visa":"must_apply","mastercard":"must_apply",
  "stripe":"must_apply","ups":"must_apply","fedex":"must_apply",
};

function getPriorityTier(company: string): "highest"|"high"|"must_apply"|undefined {
  const lc = company.toLowerCase();
  for (const [key, tier] of Object.entries(PRIORITY_MAP)) {
    if (lc === key || lc.includes(key)) return tier;
  }
  return undefined;
}

// ── Text helpers ───────────────────────────────────────────────────────────
function cleanDescription(html: string): string {
  return html
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'")
    .replace(/&nbsp;/g," ")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))
    .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}

const SKILL_KEYWORDS = [
  "React","Next.js","Vue","TypeScript","JavaScript","Angular",
  "Python","Java","Go","Golang","Rust","Swift","Kotlin","Scala","PHP","Ruby","C++","C#",
  "Spring Boot","Node.js","Django","FastAPI","Express","Flask",
  "AWS","Azure","GCP","Docker","Kubernetes","Terraform","Linux","Ansible","Helm",
  "PostgreSQL","MongoDB","Redis","Elasticsearch","MySQL","SQL","NoSQL","Cassandra","DynamoDB",
  "GraphQL","Kafka","RabbitMQ","Spark","Flink","Airflow",
  "CI/CD","Jenkins","GitHub Actions","ArgoCD",
  "Microservices","DevOps","SRE","DataDog","Prometheus","Grafana",
];

const BASE_RESUME_TEXT = [
  "React Angular TypeScript JavaScript CSS3 React Hooks",
  "Java Spring Boot Spring MVC Spring Security REST Microservices Hibernate OAuth JWT",
  "AWS EC2 ECS EKS S3 RDS Lambda API Gateway IAM VPC Docker Kubernetes CI/CD Jenkins GitLab Maven",
  "Kafka SNS SQS PostgreSQL MySQL Oracle MongoDB Redis",
  "JUnit Mockito Selenium Splunk Dynatrace Kibana CloudWatch",
  "Agile Scrum Jira Git Python GitHub",
].join(" ");

function extractMissingSkills(description: string): string[] {
  return SKILL_KEYWORDS.filter(skill => {
    const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i");
    return regex.test(description) && !regex.test(BASE_RESUME_TEXT);
  }).slice(0,6);
}

function detectSponsorship(description: string): "mentioned"|"not_mentioned" {
  const kw = ["sponsor","h-1b","h1b","visa","work authorization","work permit","ead","opt","cpt","green card"];
  return kw.some(k=>description.toLowerCase().includes(k)) ? "mentioned" : "not_mentioned";
}

function extractExperience(description: string): string {
  const m =
    description.match(/(\d+)\+?\s*(?:to|-)\s*\d+\s*years?\s*(?:of\s*)?(?:relevant\s*)?(?:experience|exp)/i) ||
    description.match(/(\d+)\+\s*years?\s*(?:of\s*)?(?:experience|exp)/i) ||
    description.match(/(?:at\s+least|minimum(?:\s+of)?)\s+(\d+)\s*years?\s*(?:of\s*)?(?:experience|exp)/i) ||
    description.match(/(\d+)\s*years?\s*(?:of\s*)?(?:experience|exp)/i);
  if (!m) return "";
  const y = parseInt(m[1]);
  if (y<=1) return "0-1yr";
  if (y<=3) return "1-3yr";
  if (y<=6) return "4-6yr";
  return "6+yr";
}

function formatPostedDate(ts: number): string {
  const diff = Date.now()-ts*1000;
  const hours = Math.floor(diff/3600000);
  if (hours<1) return "Just now";
  if (hours<24) return `${hours}h ago`;
  const days = Math.floor(hours/24);
  if (days<7) return `${days}d ago`;
  if (days<30) return `${Math.floor(days/7)}w ago`;
  return `${Math.floor(days/30)}mo ago`;
}

// ── US location ────────────────────────────────────────────────────────────
const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
]);

function isUSLocation(location: string): boolean {
  if (!location) return true;
  const loc = location.toLowerCase();
  if (loc.includes("remote")||loc.includes("anywhere")||loc.includes("worldwide")) return true;
  if (loc.includes("united states")||loc.includes(", us")||loc.includes(", usa")) return true;
  const parts = location.split(/[,\s]+/);
  return parts.some(p=>US_STATES.has(p.trim())||US_STATES.has(p.trim().toUpperCase()));
}

// ── Job quality filters ────────────────────────────────────────────────────
function isContractOrPartTime(type: string, desc: string): boolean {
  const lc=(type+" "+desc.slice(0,300)).toLowerCase();
  return /\bcontract(or)?\b|\bpart.?time\b|\bintern(ship)?\b|\bfreelance\b|\btemporary\b|\btemp\b/.test(lc);
}

function requiresSecurityClearance(title: string, desc: string): boolean {
  const text=(title+" "+desc).toLowerCase();
  return /\b(security\s+clearance|secret\s+clearance|top\s+secret|ts\/sci|clearance\s+required|dod\s+clearance|classified|polygraph)\b/.test(text);
}

// Master filter
function shouldKeepJob(title: string, desc: string, type: string, location: string): boolean {
  if (shouldExcludeTitle(title)) return false;
  if (isContractOrPartTime(type, desc)) return false;
  if (!isUSLocation(location)) return false;
  if (requiresSecurityClearance(title, desc)) return false;
  return true;
}

// ── Relevance scoring ──────────────────────────────────────────────────────
function computeRelevanceScore(job: Job): number {
  let score = 0;
  score += scoreTitleRelevance(job.title) * 3;          // 0–30
  score += scoreSponsorshipSignal(job.description);     // -20 to +15
  score += scoreRecency(job.postedTimestamp);            // 0–10
  // Company priority bonus
  const tier = job.priorityTier;
  if (tier==="highest") score += 5;
  else if (tier==="high") score += 3;
  else if (tier==="must_apply") score += 2;
  // Source trust
  if (job.sourceType==="greenhouse"||job.sourceType==="lever"||job.sourceType==="workday") score += 3;
  else if (job.sourceType==="jsearch"||job.sourceType==="adzuna") score += 1;
  return score;
}

// ── Dedup + sort ───────────────────────────────────────────────────────────
function deduplicateJobs(jobs: Job[]): Job[] {
  const seenIds = new Set<string>();
  const seenKey = new Set<string>();
  return jobs.filter(job => {
    const key = `${job.title.toLowerCase().trim()}|||${job.company.toLowerCase().trim()}`;
    if (seenIds.has(job.id)||seenKey.has(key)) return false;
    seenIds.add(job.id); seenKey.add(key);
    return true;
  });
}

function sortJobs(jobs: Job[], sort: SortOption): Job[] {
  return [...jobs].sort((a, b) => {
    switch (sort) {
      case "date_desc": return (b.postedTimestamp||0)-(a.postedTimestamp||0);
      case "date_asc":  return (a.postedTimestamp||0)-(b.postedTimestamp||0);
      case "company_desc": {
        const ra=getFortuneTier(a.company),rb=getFortuneTier(b.company);
        if (ra!==rb) return ra-rb;
        return (b.postedTimestamp||0)-(a.postedTimestamp||0);
      }
      case "company_asc": {
        const ra=getFortuneTier(a.company),rb=getFortuneTier(b.company);
        if (ra!==rb) return rb-ra;
        return (a.postedTimestamp||0)-(b.postedTimestamp||0);
      }
      default:
        // Default: relevance score desc
        return (b.relevanceScore||0)-(a.relevanceScore||0);
    }
  });
}

// ── Per-company cap ────────────────────────────────────────────────────────
const PER_COMPANY_CAP = 30;

function applyPerCompanyCap(jobs: Job[]): Job[] {
  const counts = new Map<string,number>();
  return jobs.filter(j => {
    const co = j.company.toLowerCase().trim();
    const n = counts.get(co)||0;
    if (n >= PER_COMPANY_CAP) return false;
    counts.set(co, n+1);
    return true;
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(res=>setTimeout(()=>res(fallback),ms))]);
}

const DATE_MAP: Record<JobFilter,string> = {
  "24h":"today","7d":"week","30d":"month","any":"",
};

// ── JSearch ────────────────────────────────────────────────────────────────
async function fetchJSearch(query: string, filter: JobFilter): Promise<{jobs:Job[];status:SourceStatus}> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return {jobs:[],status:{status:"skipped",fetched:0,kept:0,error:"RAPIDAPI_KEY not set"}};

  const expansion = expandQuery(query);
  const allJobs: Job[] = [];

  // For broad mode: use a representative subset of terms to avoid too many API calls
  // For focused/exact: use all terms
  const termsToSearch = expansion.mode === "broad"
    ? ["software engineer","backend engineer","frontend engineer","full stack engineer","cloud engineer","devops engineer"].slice(0,4)
    : expansion.terms.slice(0,6);

  let fetched = 0;
  try {
    await Promise.allSettled(
      termsToSearch.slice(0,3).map(async (term) => {
        const params = new URLSearchParams({
          query: `${term} in USA`, page: "1",
          num_pages: "2", country: "us",
          ...(DATE_MAP[filter] && { date_posted: DATE_MAP[filter] }),
        });
        try {
          const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`,{
            headers:{"X-RapidAPI-Key":apiKey,"X-RapidAPI-Host":"jsearch.p.rapidapi.com"},
            cache:"no-store",
          });
          if (!res.ok) return;
          const data = await res.json();
          const raw = (data.data||[]) as Record<string,unknown>[];
          fetched += raw.length;
          raw.forEach((j,i) => {
            const rawDesc=(j.job_description as string)||"";
            const desc=cleanDescription(rawDesc).slice(0,800);
            const ts=(j.job_posted_at_timestamp as number)||0;
            const loc=[j.job_city,j.job_state,j.job_country].filter(Boolean).join(", ")||"Remote";
            const company=(j.employer_name as string)||"";
            const title=(j.job_title as string)||"";
            if (!title||!company||!shouldKeepJob(title,desc,(j.job_employment_type as string)||"",loc)) return;
            const job: Job = {
              id:(j.job_id as string)||`js-${i}`,
              title, company, location:loc,
              type:(j.job_employment_type as string)||"Full-time",
              salary:j.job_min_salary?`$${Math.round(Number(j.job_min_salary)/1000)}k–$${Math.round(Number(j.job_max_salary)/1000)}k`:undefined,
              description:desc,
              applyUrl:(j.job_apply_link as string)||"#",
              postedAt:(j.job_posted_at_datetime_utc as string)||"",
              postedDate:ts?formatPostedDate(ts):"Recently",
              postedTimestamp:ts,
              source:(j.job_publisher as string)||"Job Board",
              sourceType:"jsearch",
              skills:extractMissingSkills(rawDesc),
              sponsorshipTag:detectSponsorship(rawDesc),
              experience:extractExperience(rawDesc),
              priorityTier:getPriorityTier(company),
              fortuneRank:getFortuneTier(company),
            };
            allJobs.push(job);
          });
        } catch { /**/ }
      })
    );
    const kept = allJobs.length;
    return {jobs:allJobs,status:{status:kept>0?"healthy":"degraded",fetched,kept}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── Greenhouse ─────────────────────────────────────────────────────────────
const GREENHOUSE_COMPANIES = [
  "airbnb","stripe","doordash","openai","coinbase","gusto","brex","notion",
  "plaid","lattice","figma","robinhood","benchling","mixpanel","amplitude",
  "segment","flexport","mercury","ramp","checkr",
  "confluent","cloudflare","mongodb","hashicorp","anthropic","databricks",
  "snowflake","atlassian","servicenow","workday","adobe","paypal","visa",
  "mastercard","verizon","infosys","cognizant","accenture","capgemini",
];

async function fetchGreenhouse(expansion: ReturnType<typeof expandQuery>): Promise<{jobs:Job[];status:SourceStatus}> {
  const results: Job[] = [];
  let fetched = 0;
  await Promise.allSettled(
    GREENHOUSE_COMPANIES.map(async company => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
          { next: { revalidate: 3600 } }
        );
        if (!res.ok) return;
        const data = await res.json();
        const jobs = (data.jobs||[]) as Record<string,unknown>[];
        fetched += jobs.length;
        let kept = 0;
        for (const j of jobs) {
          if (kept >= PER_COMPANY_CAP) break;
          const title=(j.title as string)||"";
          const rawContent=(j.content as string)||"";
          const desc=cleanDescription(rawContent).slice(0,800);
          const location=((j.location as Record<string,unknown>)?.name as string)||"Remote";
          if (!shouldKeepJob(title,desc,"",location)) continue;
          // Query relevance check for Greenhouse (title must match expansion)
          const tl=title.toLowerCase();
          const relevant = expansion.terms.some(term=>tl.includes(term.split(" ")[0]));
          if (!relevant) continue;
          const url=(j.absolute_url as string)||"#";
          const updatedAt=(j.updated_at as string)||"";
          const ts=updatedAt?Math.floor(new Date(updatedAt).getTime()/1000):0;
          const displayName=company.charAt(0).toUpperCase()+company.slice(1);
          results.push({
            id:`gh-${company}-${j.id??Math.random()}`,
            title,company:displayName,location,type:"Full-time",
            description:desc,applyUrl:url,postedAt:updatedAt,
            postedDate:ts?formatPostedDate(ts):"Recently",
            postedTimestamp:ts,source:"Greenhouse",sourceType:"greenhouse",
            skills:extractMissingSkills(rawContent),
            sponsorshipTag:detectSponsorship(rawContent),
            experience:extractExperience(rawContent),
            priorityTier:getPriorityTier(displayName),
            fortuneRank:getFortuneTier(displayName),
          });
          kept++;
        }
      } catch { /**/ }
    })
  );
  return {jobs:results,status:{status:results.length>0?"healthy":"degraded",fetched,kept:results.length}};
}

// ── Lever ──────────────────────────────────────────────────────────────────
const LEVER_COMPANIES = [
  "netflix","reddit","webflow","miro","airtable","asana","attentive",
  "loom","superhuman","deel","remote","scale-ai","alchemy",
  "postman","vercel","neo4j","launchdarkly","envoy","sourcegraph",
  "stripe","figma","notion","brex","gusto","ramp","plaid",
];

async function fetchLever(expansion: ReturnType<typeof expandQuery>): Promise<{jobs:Job[];status:SourceStatus}> {
  const results: Job[] = [];
  let fetched = 0;
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
        fetched += jobs.length;
        let kept = 0;
        for (const j of jobs as Record<string,unknown>[]) {
          if (kept >= PER_COMPANY_CAP) break;
          const title=(j.text as string)||"";
          const plainDesc=(j.descriptionPlain as string)||"";
          const rawDesc=(j.description as string)||plainDesc;
          const desc=cleanDescription(plainDesc||rawDesc).slice(0,800);
          const cats=(j.categories as Record<string,unknown>)||{};
          const commitment=(cats.commitment as string)||"";
          const location=(cats.location as string)||"Remote";
          if (!shouldKeepJob(title,desc,commitment,location)) continue;
          const tl=title.toLowerCase();
          const relevant=expansion.terms.some(term=>tl.includes(term.split(" ")[0]));
          if (!relevant) continue;
          const url=(j.hostedUrl as string)||"#";
          const createdAt=(j.createdAt as number)||0;
          const ts=createdAt>1e10?Math.floor(createdAt/1000):createdAt;
          const displayName=company.charAt(0).toUpperCase()+company.slice(1).replace(/-/g," ");
          results.push({
            id:`lever-${company}-${j.id??Math.random()}`,
            title,company:displayName,location,type:commitment||"Full-time",
            description:desc,applyUrl:url,
            postedAt:createdAt?new Date(createdAt>1e10?createdAt:createdAt*1000).toISOString():"",
            postedDate:ts?formatPostedDate(ts):"Recently",
            postedTimestamp:ts,source:"Lever",sourceType:"lever",
            skills:extractMissingSkills(rawDesc),
            sponsorshipTag:detectSponsorship(rawDesc),
            experience:extractExperience(rawDesc),
            priorityTier:getPriorityTier(displayName),
            fortuneRank:getFortuneTier(displayName),
          });
          kept++;
        }
      } catch { /**/ }
    })
  );
  return {jobs:results,status:{status:results.length>0?"healthy":"degraded",fetched,kept:results.length}};
}

// ── Workday adapter ────────────────────────────────────────────────────────
// Config: tenant, site, server (wd1/wd3/wd5/wd12 etc)
const WORKDAY_COMPANIES: Array<{name:string;tenant:string;site:string;server:string}> = [
  {name:"Salesforce",       tenant:"salesforce",       site:"External_Career_Site",       server:"wd12"},
  {name:"ServiceNow",       tenant:"servicenow",        site:"External",                  server:"wd12"},
  {name:"Adobe",            tenant:"adobe",             site:"external_career",            server:"wd5"},
  {name:"Intel",            tenant:"intel",             site:"External",                   server:"wd1"},
  {name:"Wells Fargo",      tenant:"wellsfargo",        site:"WF_External_Careers",        server:"wd1"},
  {name:"Bank of America",  tenant:"bofa",              site:"External",                   server:"wd1"},
  {name:"Capital One",      tenant:"capitalone",        site:"Capital_One_External",       server:"wd1"},
  {name:"AT&T",             tenant:"att",               site:"ATTCareers",                 server:"wd1"},
  {name:"Verizon",          tenant:"verizon",           site:"External",                   server:"wd5"},
  {name:"T-Mobile",         tenant:"tmobile",           site:"External",                   server:"wd1"},
  {name:"S&P Global",       tenant:"spglobal",          site:"Careers",                    server:"wd1"},
  {name:"CVS Health",       tenant:"cvshealth",         site:"CVS_Health_Careers",         server:"wd1"},
  {name:"UnitedHealth",     tenant:"uhg",               site:"External",                   server:"wd5"},
  {name:"Elevance Health",  tenant:"elevancehealth",    site:"ANT",                        server:"wd1"},
  {name:"JPMorgan Chase",   tenant:"jpmc",              site:"External",                   server:"wd5"},
  {name:"Amazon",           tenant:"amazon",            site:"External_Career_Site",       server:"wd1"},
  {name:"Walmart",          tenant:"walmart",           site:"External",                   server:"wd5"},
  {name:"Target",           tenant:"target",            site:"External",                   server:"wd1"},
  {name:"Home Depot",       tenant:"homedepot",         site:"External",                   server:"wd5"},
  {name:"NVIDIA",           tenant:"nvidia",            site:"NVIDIAExternalCareerSite",   server:"wd5"},
];

const WORKDAY_DATE_MAP: Record<JobFilter,number|undefined> = {
  "24h":1,"7d":7,"30d":30,"any":undefined,
};

async function fetchWorkday(expansion: ReturnType<typeof expandQuery>, filter: JobFilter): Promise<{jobs:Job[];status:SourceStatus}> {
  const results: Job[] = [];
  let totalFetched = 0;

  // Use primary term for Workday search text
  const searchText = expansion.primary;

  await Promise.allSettled(
    WORKDAY_COMPANIES.map(async ({name,tenant,site,server}) => {
      try {
        const url = `https://${tenant}.${server}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
        const body: Record<string,unknown> = {
          appliedFacets: {},
          limit: 20,
          offset: 0,
          searchText,
        };
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const jobs = (data.jobPostings||[]) as Record<string,unknown>[];
        totalFetched += jobs.length;
        let kept = 0;
        for (const j of jobs) {
          if (kept >= PER_COMPANY_CAP) break;
          const title=(j.title as string)||"";
          const rawDesc=((j.jobDescription as Record<string,unknown>)?.jobDescription as string)||
                        (j.shortDesc as string)||"";
          const desc=cleanDescription(rawDesc).slice(0,800);
          const locArr = (j.locationsText as string)||(j.location as string)||"United States";
          if (!shouldKeepJob(title,desc,"Full-time",locArr)) continue;
          const externalPath=(j.externalPath as string)||"";
          const applyUrl=externalPath
            ? `https://${tenant}.${server}.myworkdayjobs.com/en-US/${site}/job${externalPath}`
            : `https://${tenant}.${server}.myworkdayjobs.com/en-US/${site}`;
          const postedOn=(j.postedOn as string)||"";
          // Workday postedOn format: "Posted 3 Days Ago" — extract approximate ts
          let ts = 0;
          const dMatch = postedOn.match(/(\d+)\s+day/i);
          const wMatch = postedOn.match(/(\d+)\s+week/i);
          const mMatch = postedOn.match(/(\d+)\s+month/i);
          if (dMatch) ts = Math.floor(Date.now()/1000) - parseInt(dMatch[1])*86400;
          else if (wMatch) ts = Math.floor(Date.now()/1000) - parseInt(wMatch[1])*604800;
          else if (mMatch) ts = Math.floor(Date.now()/1000) - parseInt(mMatch[1])*2592000;
          else if (postedOn.toLowerCase().includes("today")) ts = Math.floor(Date.now()/1000);

          // Apply date filter
          const maxDays = WORKDAY_DATE_MAP[filter];
          if (maxDays && ts) {
            const ageDays = (Date.now()/1000 - ts) / 86400;
            if (ageDays > maxDays) continue;
          }

          results.push({
            id:`wd-${tenant}-${(j.bulletFields as string[]|undefined)?.[0]||Math.random()}`,
            title, company:name, location:locArr, type:"Full-time",
            description:desc, applyUrl, postedAt:"",
            postedDate:ts?formatPostedDate(ts):postedOn||"Recently",
            postedTimestamp:ts, source:"Workday", sourceType:"workday",
            skills:extractMissingSkills(rawDesc),
            sponsorshipTag:detectSponsorship(rawDesc),
            experience:extractExperience(rawDesc),
            priorityTier:getPriorityTier(name),
            fortuneRank:getFortuneTier(name),
          });
          kept++;
        }
      } catch { /**/ }
    })
  );
  return {jobs:results,status:{status:results.length>0?"healthy":"degraded",fetched:totalFetched,kept:results.length}};
}

// ── Goldman Sachs GraphQL ─────────────────────────────────────────────────
async function fetchGoldmanSachs(expansion: ReturnType<typeof expandQuery>, filter: JobFilter): Promise<{jobs:Job[];status:SourceStatus}> {
  try {
    const body = {
      operationName: "RoleSearch",
      variables: {
        criteria: {
          keyword: expansion.primary,
          pageSize: 30,
          pageNumber: 1,
          locations: ["United States"],
        },
      },
      query: `query RoleSearch($criteria: RoleSearchCriteriaInput!) {
        roleSearch(criteria: $criteria) {
          totalCount
          roles {
            id title location { city state country }
            division team description
            postedDate applyUrl
          }
        }
      }`,
    };
    const res = await fetch("https://api-higher.gs.com/gateway/api/v1/graphql", {
      method: "POST",
      headers: {"Content-Type":"application/json","Accept":"application/json"},
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const roles = data?.data?.roleSearch?.roles as Record<string,unknown>[] || [];
    const jobs: Job[] = [];
    for (const r of roles) {
      const title=(r.title as string)||"";
      const locObj=(r.location as Record<string,unknown>)||{};
      const location=[locObj.city,locObj.state,locObj.country].filter(Boolean).join(", ")||"United States";
      const rawDesc=(r.description as string)||"";
      const desc=cleanDescription(rawDesc).slice(0,800);
      if (!shouldKeepJob(title,desc,"Full-time",location)) continue;
      const postedDate=(r.postedDate as string)||"";
      const ts=postedDate?Math.floor(new Date(postedDate).getTime()/1000):0;
      jobs.push({
        id:`gs-${r.id??Math.random()}`,
        title, company:"Goldman Sachs", location, type:"Full-time",
        description:desc, applyUrl:(r.applyUrl as string)||"https://higher.gs.com/roles",
        postedAt:postedDate, postedDate:ts?formatPostedDate(ts):"Recently",
        postedTimestamp:ts, source:"Goldman Sachs", sourceType:"goldman",
        skills:extractMissingSkills(rawDesc),
        sponsorshipTag:detectSponsorship(rawDesc),
        experience:extractExperience(rawDesc),
        priorityTier:"highest", fortuneRank:53,
      });
    }
    return {jobs,status:{status:jobs.length>0?"healthy":"degraded",fetched:roles.length,kept:jobs.length}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── Morgan Stanley Eightfold ───────────────────────────────────────────────
async function fetchMorganStanley(expansion: ReturnType<typeof expandQuery>): Promise<{jobs:Job[];status:SourceStatus}> {
  try {
    const params = new URLSearchParams({
      domain: "morganstanley.com",
      query: expansion.primary,
      location: "United States",
      start: "0",
      num: "30",
      sort_by: "timestamp",
    });
    const res = await fetch(
      `https://morganstanley.eightfold.ai/api/pcsx/search?${params}`,
      { headers:{"Accept":"application/json"}, cache:"no-store" }
    );
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const positions = (data.positions||[]) as Record<string,unknown>[];
    const jobs: Job[] = [];
    for (const p of positions) {
      const title=(p.name as string)||"";
      const rawDesc=(p.description as string)||(p.skills_text as string)||"";
      const desc=cleanDescription(rawDesc).slice(0,800);
      const location=(p.location as string)||(p.city as string)||"United States";
      if (!shouldKeepJob(title,desc,"Full-time",location)) continue;
      const ts=p.t_update?Math.floor(Number(p.t_update)/1000):0;
      jobs.push({
        id:`ms-${p.id??Math.random()}`,
        title, company:"Morgan Stanley", location, type:"Full-time",
        description:desc,
        applyUrl:`https://morganstanley.eightfold.ai/careers?pid=${p.id}&domain=morganstanley.com`,
        postedAt:"", postedDate:ts?formatPostedDate(ts):"Recently",
        postedTimestamp:ts, source:"Morgan Stanley", sourceType:"morganstanley",
        skills:extractMissingSkills(rawDesc),
        sponsorshipTag:detectSponsorship(rawDesc),
        experience:extractExperience(rawDesc),
        priorityTier:"highest", fortuneRank:21,
      });
    }
    return {jobs,status:{status:jobs.length>0?"healthy":"degraded",fetched:positions.length,kept:jobs.length}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── Cisco Phenom ───────────────────────────────────────────────────────────
async function fetchCisco(expansion: ReturnType<typeof expandQuery>): Promise<{jobs:Job[];status:SourceStatus}> {
  try {
    const body = {
      operationName: "getPaginatedJobs",
      variables: {
        filter: {
          keyword: expansion.primary,
          country: ["United States"],
        },
        pageSize: 20,
        pageNo: 0,
        sortBy: "recent",
      },
      query: `query getPaginatedJobs($filter: JobSearchFilterInput, $pageSize: Int, $pageNo: Int, $sortBy: String) {
        paginatedJobs(filter: $filter, pageSize: $pageSize, pageNo: $pageNo, sortBy: $sortBy) {
          jobs { id title location description applyUrl postedDate }
          totalCount
        }
      }`,
    };
    const res = await fetch("https://careers.cisco.com/widgets", {
      method: "POST",
      headers: {"Content-Type":"application/json","Accept":"application/json"},
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const raw = data?.data?.paginatedJobs?.jobs as Record<string,unknown>[] || [];
    const jobs: Job[] = [];
    for (const j of raw) {
      const title=(j.title as string)||"";
      const rawDesc=(j.description as string)||"";
      const desc=cleanDescription(rawDesc).slice(0,800);
      const location=(j.location as string)||"United States";
      if (!shouldKeepJob(title,desc,"Full-time",location)) continue;
      const postedDate=(j.postedDate as string)||"";
      const ts=postedDate?Math.floor(new Date(postedDate).getTime()/1000):0;
      jobs.push({
        id:`cisco-${j.id??Math.random()}`,
        title, company:"Cisco", location, type:"Full-time",
        description:desc, applyUrl:(j.applyUrl as string)||"https://careers.cisco.com",
        postedAt:postedDate, postedDate:ts?formatPostedDate(ts):"Recently",
        postedTimestamp:ts, source:"Cisco", sourceType:"cisco",
        skills:extractMissingSkills(rawDesc),
        sponsorshipTag:detectSponsorship(rawDesc),
        experience:extractExperience(rawDesc),
        priorityTier:"highest", fortuneRank:24,
      });
    }
    return {jobs,status:{status:jobs.length>0?"healthy":"degraded",fetched:raw.length,kept:jobs.length}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── Oracle Cloud HCM ──────────────────────────────────────────────────────
async function fetchOracle(expansion: ReturnType<typeof expandQuery>): Promise<{jobs:Job[];status:SourceStatus}> {
  try {
    // Oracle Fusion HCM — correct endpoint with required fields
    const params = new URLSearchParams({
      "q":       `TITLE='${expansion.primary}'`,
      "limit":   "25",
      "offset":  "0",
      "expand":  "requisitionList",
      "onlyData":"true",
    });
    const res = await fetch(
      `https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?${params}`,
      {
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const items = (data.items||[]) as Record<string,unknown>[];
    const jobs: Job[] = [];
    for (const item of items) {
      const reqs = (item.requisitionList as Record<string,unknown>[])||[];
      for (const r of reqs) {
        const title=(r.Title as string)||"";
        const rawDesc=(r.ExternalDescriptionStr as string)||"";
        const desc=cleanDescription(rawDesc).slice(0,800);
        const location=(r.PrimaryLocation as string)||"United States";
        if (!shouldKeepJob(title,desc,"Full-time",location)) continue;
        const postedDate=(r.PostedDate as string)||"";
        const ts=postedDate?Math.floor(new Date(postedDate).getTime()/1000):0;
        const reqId=(r.Id as string)||String(Math.random());
        jobs.push({
          id:`oracle-${reqId}`,
          title, company:"Oracle", location, type:"Full-time",
          description:desc,
          applyUrl:`https://careers.oracle.com/en/sites/jobsearch/job/${reqId}`,
          postedAt:postedDate, postedDate:ts?formatPostedDate(ts):"Recently",
          postedTimestamp:ts, source:"Oracle", sourceType:"oracle",
          skills:extractMissingSkills(rawDesc),
          sponsorshipTag:detectSponsorship(rawDesc),
          experience:extractExperience(rawDesc),
          priorityTier:"highest", fortuneRank:25,
        });
      }
    }
    return {jobs,status:{status:jobs.length>0?"healthy":"degraded",fetched:items.length,kept:jobs.length}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── Remotive ───────────────────────────────────────────────────────────────
async function fetchRemotive(expansion: ReturnType<typeof expandQuery>): Promise<{jobs:Job[];status:SourceStatus}> {
  try {
    const q = expansion.primary;
    const res = await fetch(
      `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const raw = ((data.jobs||[]) as Record<string,unknown>[]).filter(j => {
      const title=(j.title as string)||"";
      const loc=(j.candidate_required_location as string)||"";
      const isUS=!loc||["usa","united states","us only","remote","worldwide","anywhere"].some(k=>loc.toLowerCase().includes(k));
      return isUS;
    });
    const jobs: Job[] = [];
    for (const j of raw) {
      const title=(j.title as string)||"";
      const rawDesc=(j.description as string)||"";
      const desc=cleanDescription(rawDesc).slice(0,800);
      const location=(j.candidate_required_location as string)||"Remote";
      if (!shouldKeepJob(title,desc,(j.job_type as string)||"Full-time",location)) continue;
      const pubDate=(j.publication_date as string)||"";
      const ts=pubDate?Math.floor(new Date(pubDate).getTime()/1000):0;
      const company=(j.company_name as string)||"";
      jobs.push({
        id:`remotive-${j.id??Math.random()}`,
        title, company, location, type:(j.job_type as string)||"Full-time",
        description:desc, applyUrl:(j.url as string)||"#",
        postedAt:pubDate, postedDate:ts?formatPostedDate(ts):"Recently",
        postedTimestamp:ts, source:"Remotive", sourceType:"remotive",
        skills:extractMissingSkills(rawDesc),
        sponsorshipTag:detectSponsorship(rawDesc),
        experience:extractExperience(rawDesc),
        priorityTier:getPriorityTier(company),
        fortuneRank:getFortuneTier(company),
      });
    }
    return {jobs,status:{status:jobs.length>0?"healthy":"degraded",fetched:raw.length,kept:jobs.length}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── Adzuna ─────────────────────────────────────────────────────────────────
async function fetchAdzuna(expansion: ReturnType<typeof expandQuery>, filter: JobFilter): Promise<{jobs:Job[];status:SourceStatus}> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return {jobs:[],status:{status:"skipped",fetched:0,kept:0,error:"ADZUNA keys not set"}};
  const maxDays: Record<JobFilter,number|undefined> = {"24h":1,"7d":7,"30d":30,"any":undefined};
  const maxDaysOld = maxDays[filter];
  try {
    const params = new URLSearchParams({
      app_id: appId, app_key: appKey,
      results_per_page: "50",
      what: expansion.primary,
      where: "united states",
      "content-type": "application/json",
      full_time: "1",
      ...(maxDaysOld ? { max_days_old: String(maxDaysOld) } : {}),
    });
    const res = await fetch(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`,{cache:"no-store"});
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const raw = (data.results||[]) as Record<string,unknown>[];
    const jobs: Job[] = [];
    for (const j of raw) {
      const title=(j.title as string)||"";
      const rawDesc=(j.description as string)||"";
      const desc=cleanDescription(rawDesc).slice(0,800);
      const locObj=(j.location as Record<string,unknown>)||{};
      const location=(locObj.display_name as string)||"United States";
      const company=((j.company as Record<string,unknown>)?.display_name as string)||"";
      if (!shouldKeepJob(title,desc,"Full-time",location)) continue;
      const createdAt=(j.created as string)||"";
      const ts=createdAt?Math.floor(new Date(createdAt).getTime()/1000):0;
      const salaryMin=j.salary_min?Math.round(Number(j.salary_min)/1000):0;
      const salaryMax=j.salary_max?Math.round(Number(j.salary_max)/1000):0;
      jobs.push({
        id:`az-${j.id??Math.random()}`,
        title, company, location, type:"Full-time",
        salary:salaryMin>0?`$${salaryMin}k–$${salaryMax}k`:undefined,
        description:desc, applyUrl:(j.redirect_url as string)||"#",
        postedAt:createdAt, postedDate:ts?formatPostedDate(ts):"Recently",
        postedTimestamp:ts, source:"Adzuna", sourceType:"adzuna",
        skills:extractMissingSkills(rawDesc),
        sponsorshipTag:detectSponsorship(rawDesc),
        experience:extractExperience(rawDesc),
        priorityTier:getPriorityTier(company),
        fortuneRank:getFortuneTier(company),
      });
    }
    return {jobs,status:{status:jobs.length>0?"healthy":"degraded",fetched:raw.length,kept:jobs.length}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── TheirStack (optional) ─────────────────────────────────────────────────
async function fetchTheirStack(expansion: ReturnType<typeof expandQuery>, filter: JobFilter): Promise<{jobs:Job[];status:SourceStatus}> {
  const apiKey = process.env.THEIRSTACK_API_KEY;
  if (!apiKey) return {jobs:[],status:{status:"skipped",fetched:0,kept:0,error:"THEIRSTACK_API_KEY not set"}};
  const maxAgeDays: Record<JobFilter,number|undefined> = {"24h":1,"7d":7,"30d":30,"any":undefined};
  const ageDays = maxAgeDays[filter];
  try {
    const body: Record<string,unknown> = {
      job_title_or: expansion.terms.slice(0,10),
      job_country_code_or: ["US"],
      order_by: [{desc:true,field:"date_posted"}],
      page: 1,
      limit: 25,
    };
    if (ageDays) body.posted_at_max_age_days = ageDays;
    const res = await fetch("https://api.theirstack.com/v1/jobs/search",{
      method:"POST",
      headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify(body),cache:"no-store",
    });
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const raw = (data.data||[]) as Record<string,unknown>[];
    const jobs: Job[] = [];
    for (const j of raw) {
      const title=(j.job_title as string)||"";
      const rawDesc=(j.description as string)||"";
      const desc=cleanDescription(rawDesc).slice(0,800);
      const companyObj=(j.company as Record<string,unknown>)||{};
      const company=(companyObj.name as string)||(j.company_name as string)||"";
      const location=(j.location as string)||(Array.isArray(j.locations)?(j.locations as string[]).join(", "):"")||"Remote";
      if (!shouldKeepJob(title,desc,"Full-time",location)) continue;
      const datePosted=(j.date_posted as string)||"";
      const ts=datePosted?Math.floor(new Date(datePosted).getTime()/1000):0;
      jobs.push({
        id:`ts-${j.id??Math.random()}`,
        title, company, location, type:"Full-time",
        salary:j.salary_string?(j.salary_string as string):undefined,
        description:desc, applyUrl:(j.url as string)||(j.final_url as string)||"#",
        postedAt:datePosted, postedDate:ts?formatPostedDate(ts):"Recently",
        postedTimestamp:ts, source:"TheirStack", sourceType:"other",
        skills:extractMissingSkills(rawDesc),
        sponsorshipTag:detectSponsorship(rawDesc),
        experience:extractExperience(rawDesc),
        priorityTier:getPriorityTier(company),
        fortuneRank:getFortuneTier(company),
      });
    }
    return {jobs,status:{status:jobs.length>0?"healthy":"degraded",fetched:raw.length,kept:jobs.length}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query  = searchParams.get("q")||"";
  const filter = (searchParams.get("filter") as JobFilter)||"any";
  const sort   = (searchParams.get("sort") as SortOption)||"company_desc";

  if (!query.trim()) return NextResponse.json({error:"query required"},{status:400});

  // Expand query
  const expansion = expandQuery(query);

  try {
    const [
      rJS, rGH, rLV, rWD, rGS, rMS, rCI, rOR, rRM, rAZ, rTS,
    ] = await Promise.allSettled([
      withTimeout(fetchJSearch(query, filter), 20000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchGreenhouse(expansion), 30000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchLever(expansion), 25000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchWorkday(expansion, filter), 30000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchGoldmanSachs(expansion, filter), 15000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchMorganStanley(expansion), 15000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchCisco(expansion), 15000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchOracle(expansion), 15000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchRemotive(expansion), 15000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchAdzuna(expansion, filter), 15000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
      withTimeout(fetchTheirStack(expansion, filter), 20000, {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"timeout"}}),
    ]);

    const getResult = (r: typeof rJS) => r.status==="fulfilled" ? r.value : {jobs:[],status:{status:"broken" as const,fetched:0,kept:0,error:"promise rejected"}};

    const results = [rJS,rGH,rLV,rWD,rGS,rMS,rCI,rOR,rRM,rAZ,rTS].map(getResult);
    const sourceKeys = ["jsearch","greenhouse","lever","workday","goldman","morganstanley","cisco","oracle","remotive","adzuna","theirstack"];

    const allJobs: Job[] = results.flatMap(r => r.jobs).filter(j=>j.title&&j.company);

    // Score all jobs
    const scored = allJobs.map(j => ({...j, relevanceScore: computeRelevanceScore(j)}));

    // Deduplicate
    const unique = deduplicateJobs(scored);

    // Per-company cap
    const capped = applyPerCompanyCap(unique);

    // Sort
    const sorted = sortJobs(capped, sort);

    // Global cap 450
    const final = sorted.slice(0, 450);

    // Build full diagnostics
    const sourceStatus: Record<string,SourceStatus> = {};
    sourceKeys.forEach((k,i) => { sourceStatus[k] = results[i].status; });

    // Build source counts for UI (all sources, including zeros)
    const sources: Record<string,number> = {};
    sourceKeys.forEach(k => {
      sources[k] = final.filter(j=>j.sourceType===k||(k==="theirstack"&&j.sourceType==="other")).length;
    });

    // Build rich sourceDiagnostics array
    const sourceDiagnostics: SourceDiagnostic[] = sourceKeys.map((k, i) => {
      const st = results[i].status;
      const rawCount = st.fetched;
      const postFilterCount = sources[k];
      const called = st.status !== "skipped";
      let status: SourceDiagnostic["status"];
      if (st.status === "skipped") status = "skipped";
      else if (st.error === "timeout") status = "timeout";
      else if (st.status === "healthy" && rawCount > 0) status = "success";
      else if (st.status === "degraded" && rawCount > 0) status = "success";
      else if (st.status === "degraded") status = "degraded";
      else status = "error";
      return {
        source: k,
        called,
        status,
        rawCount,
        postFilterCount,
        error: st.error || null,
      };
    });

    console.log(`Jobs "${query}" (${expansion.mode}) → ${final.length}`);
    console.log("Diagnostics:", JSON.stringify(sourceDiagnostics.map(d=>({s:d.source,st:d.status,raw:d.rawCount,err:d.error}))));

    return NextResponse.json({
      jobs: final,
      count: final.length,
      sources,
      sourceStatus,
      sourceDiagnostics,
      queryMode: expansion.mode,
      expandedTerms: expansion.terms.length,
    });
  } catch(err:unknown) {
    return NextResponse.json({error:err instanceof Error?err.message:"Unknown error"},{status:500});
  }
}

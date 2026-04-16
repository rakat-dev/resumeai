import { NextRequest, NextResponse } from "next/server";
import {
  expandQuery, shouldExcludeTitle, scoreSponsorshipSignal,
  scoreTitleRelevance, scoreRecency,
} from "@/lib/queryExpansion";

export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────
export type JobFilter = "24h" | "3d" | "7d" | "any";
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
  sourceType: "greenhouse"|"workday"|"jsearch"|"adzuna"|"jooble"|"firecrawl"|"other";
  skills: string[];
  sponsorshipTag: "mentioned"|"not_mentioned";
  experience?: string;
  priorityTier?: "highest"|"high"|"must_apply";
  fortuneRank?: number;
  relevanceScore?: number;
}

export interface SourceStatus {
  status: "healthy"|"degraded"|"broken"|"skipped"|"rate_limited";
  fetched: number;
  kept: number;
  error?: string;
}

export interface SourceDiagnostic {
  source: string;
  called: boolean;
  status: "success"|"degraded"|"error"|"skipped"|"timeout"|"rate_limited";
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
  const kw = ["sponsor","h-1b","h1b","visa sponsorship","work authorization","work permit","ead","opt","cpt","green card","immigration"];
  const neg = ["no sponsorship","will not sponsor","cannot sponsor","not able to sponsor","sponsorship not available","without sponsorship"];
  const dl = description.toLowerCase();
  if (neg.some(k=>dl.includes(k))) return "not_mentioned"; // explicit no
  if (kw.some(k=>dl.includes(k))) return "mentioned";
  return "not_mentioned";
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

// ── Filters ────────────────────────────────────────────────────────────────
// From priority list: reject lead/principal/architect/manager/director + pure non-SWE roles
const HARD_EXCLUDE = [
  "lead","principal","architect","manager","director",
  "vice president","vp ","head of","chief","distinguished","fellow",
];
const REJECT_ROLES = [
  ".net developer",".net engineer","asp.net",
  "data engineer","data scientist","data analyst",
  "machine learning","ml engineer","ai engineer","deep learning",
  "nlp engineer","computer vision","research scientist",
  "security engineer","cybersecurity","network engineer",
  "business analyst","scrum master","project manager",
  "recruiter","marketing engineer","finance","legal",
];

function shouldExcludeTitleLocal(title: string): boolean {
  const tl = title.toLowerCase();
  if (HARD_EXCLUDE.some(k => tl.includes(k))) return true;
  if (REJECT_ROLES.some(k => tl.includes(k))) return true;
  return false;
}

function isContractOrPartTime(type: string, desc: string): boolean {
  const lc = (type+" "+desc.slice(0,300)).toLowerCase();
  return /\bcontract(or)?\b|\bpart.?time\b|\bintern(ship)?\b|\bfreelance\b|\btemporary\b|\btemp\b/.test(lc);
}

function requiresSecurityClearance(title: string, desc: string): boolean {
  const text = (title+" "+desc).toLowerCase();
  return /\b(security\s+clearance|secret\s+clearance|top\s+secret|ts\/sci|clearance\s+required|dod\s+clearance|classified|polygraph)\b/.test(text);
}

// Date filter cutoffs (seconds)
const DATE_CUTOFF_S: Record<JobFilter, number|null> = {
  "24h": 86400,
  "3d":  259200,
  "7d":  604800,
  "any": null,
};

function passesDateFilter(ts: number, filter: JobFilter): boolean {
  const cutoff = DATE_CUTOFF_S[filter];
  if (!cutoff) return true;
  if (!ts) return false; // no timestamp → exclude when date filter active
  return (Date.now()/1000 - ts) <= cutoff;
}

function shouldKeepJob(title: string, desc: string, type: string, location: string, ts: number, filter: JobFilter): boolean {
  if (shouldExcludeTitleLocal(title)) return false;
  if (isContractOrPartTime(type, desc)) return false;
  if (!isUSLocation(location)) return false;
  if (requiresSecurityClearance(title, desc)) return false;
  if (!passesDateFilter(ts, filter)) return false;
  return true;
}

// ── Scoring ────────────────────────────────────────────────────────────────
function computeRelevanceScore(job: Job): number {
  let score = 0;
  score += scoreTitleRelevance(job.title) * 3;
  score += scoreSponsorshipSignal(job.description);
  score += scoreRecency(job.postedTimestamp);
  const tier = job.priorityTier;
  if (tier==="highest") score += 5;
  else if (tier==="high") score += 3;
  else if (tier==="must_apply") score += 2;
  if (job.sourceType==="greenhouse"||job.sourceType==="workday") score += 3;
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
  return [...jobs].sort((a,b) => {
    switch (sort) {
      case "date_desc": return (b.postedTimestamp||0)-(a.postedTimestamp||0);
      case "date_asc":  return (a.postedTimestamp||0)-(b.postedTimestamp||0);
      case "company_desc": {
        const ra=getFortuneTier(a.company),rb=getFortuneTier(b.company);
        return ra!==rb ? ra-rb : (b.postedTimestamp||0)-(a.postedTimestamp||0);
      }
      case "company_asc": {
        const ra=getFortuneTier(a.company),rb=getFortuneTier(b.company);
        return ra!==rb ? rb-ra : (a.postedTimestamp||0)-(b.postedTimestamp||0);
      }
      default: return (b.relevanceScore||0)-(a.relevanceScore||0);
    }
  });
}

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

// ── Greenhouse ─────────────────────────────────────────────────────────────
// Priority list companies using Greenhouse ATS
const GREENHOUSE_COMPANIES = [
  // Tech / cloud-native (from priority list)
  "databricks","snowflake","hashicorp","cloudflare","mongodb","confluent",
  "atlassian","openai","anthropic","stripe","figma","notion","brex","gusto",
  "ramp","plaid","airbnb","doordash","coinbase","robinhood","lattice",
  "amplitude","mixpanel","segment","flexport","mercury","ramp","checkr",
  "vercel","webflow","airtable","asana","deel","postman","sourcegraph",
  "launchdarkly","neo4j",
  // Enterprise / Fortune 500 that use Greenhouse
  "paypal","visa","mastercard","verizon","infosys","cognizant","accenture","capgemini",
  "adobe","servicenow","workday",
];

async function fetchGreenhouse(
  expansion: ReturnType<typeof expandQuery>,
  filter: JobFilter
): Promise<{jobs:Job[];status:SourceStatus}> {
  const results: Job[] = [];
  let fetched = 0;
  await Promise.allSettled(
    GREENHOUSE_COMPANIES.map(async company => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
          { next: { revalidate: 1800 } }
        );
        if (!res.ok) return;
        const data = await res.json();
        const jobs = (data.jobs||[]) as Record<string,unknown>[];
        fetched += jobs.length;
        let kept = 0;
        for (const j of jobs) {
          if (kept >= PER_COMPANY_CAP) break;
          const title = (j.title as string)||"";
          const rawContent = (j.content as string)||"";
          const desc = cleanDescription(rawContent).slice(0,800);
          const location = ((j.location as Record<string,unknown>)?.name as string)||"Remote";
          const updatedAt = (j.updated_at as string)||"";
          const ts = updatedAt ? Math.floor(new Date(updatedAt).getTime()/1000) : 0;
          if (!shouldKeepJob(title,desc,"",location,ts,filter)) continue;
          // Title relevance check
          const tl = title.toLowerCase();
          if (!expansion.terms.some(term=>tl.includes(term.split(" ")[0]))) continue;
          const url = (j.absolute_url as string)||"#";
          const displayName = company.charAt(0).toUpperCase()+company.slice(1);
          results.push({
            id:`gh-${company}-${j.id??Math.random()}`,
            title, company:displayName, location, type:"Full-time",
            description:desc, applyUrl:url, postedAt:updatedAt,
            postedDate:ts?formatPostedDate(ts):"Recently",
            postedTimestamp:ts, source:"Greenhouse", sourceType:"greenhouse",
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

// ── Workday ────────────────────────────────────────────────────────────────
// Priority list companies using Workday portals
const WORKDAY_COMPANIES: Array<{name:string;tenant:string;site:string;server:string}> = [
  // Fortune 500 / enterprise — from priority list
  {name:"Salesforce",      tenant:"salesforce",    site:"External_Career_Site",     server:"wd12"},
  {name:"ServiceNow",      tenant:"servicenow",    site:"External",                  server:"wd12"},
  {name:"Adobe",           tenant:"adobe",         site:"external_career",           server:"wd5"},
  {name:"Intel",           tenant:"intel",         site:"External",                  server:"wd1"},
  {name:"Wells Fargo",     tenant:"wellsfargo",    site:"WF_External_Careers",       server:"wd1"},
  {name:"Bank of America", tenant:"bofa",          site:"External",                  server:"wd1"},
  {name:"Capital One",     tenant:"capitalone",    site:"Capital_One_External",      server:"wd1"},
  {name:"AT&T",            tenant:"att",           site:"ATTCareers",                server:"wd1"},
  {name:"Verizon",         tenant:"verizon",       site:"External",                  server:"wd5"},
  {name:"T-Mobile",        tenant:"tmobile",       site:"External",                  server:"wd1"},
  {name:"S&P Global",      tenant:"spglobal",      site:"Careers",                   server:"wd1"},
  {name:"CVS Health",      tenant:"cvshealth",     site:"CVS_Health_Careers",        server:"wd1"},
  {name:"UnitedHealth",    tenant:"uhg",           site:"External",                  server:"wd5"},
  {name:"Elevance Health", tenant:"elevancehealth",site:"ANT",                       server:"wd1"},
  {name:"JPMorgan Chase",  tenant:"jpmc",          site:"External",                  server:"wd5"},
  {name:"Amazon",          tenant:"amazon",        site:"External_Career_Site",      server:"wd1"},
  {name:"Walmart",         tenant:"walmart",       site:"External",                  server:"wd5"},
  {name:"Target",          tenant:"target",        site:"External",                  server:"wd1"},
  {name:"Home Depot",      tenant:"homedepot",     site:"External",                  server:"wd5"},
  {name:"NVIDIA",          tenant:"nvidia",        site:"NVIDIAExternalCareerSite",  server:"wd5"},
  {name:"Lowe's",          tenant:"lowes",         site:"External",                  server:"wd1"},
  {name:"Costco",          tenant:"costco",        site:"External",                  server:"wd5"},
  {name:"FedEx",           tenant:"fedex",         site:"External",                  server:"wd1"},
  {name:"UPS",             tenant:"ups",           site:"External",                  server:"wd1"},
];

async function fetchWorkday(
  expansion: ReturnType<typeof expandQuery>,
  filter: JobFilter
): Promise<{jobs:Job[];status:SourceStatus}> {
  const results: Job[] = [];
  let totalFetched = 0;

  await Promise.allSettled(
    WORKDAY_COMPANIES.map(async ({name,tenant,site,server}) => {
      try {
        const url = `https://${tenant}.${server}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          body: JSON.stringify({ appliedFacets:{}, limit:20, offset:0, searchText:expansion.primary }),
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const jobs = (data.jobPostings||[]) as Record<string,unknown>[];
        totalFetched += jobs.length;
        let kept = 0;
        for (const j of jobs) {
          if (kept >= PER_COMPANY_CAP) break;
          const title = (j.title as string)||"";
          const rawDesc = ((j.jobDescription as Record<string,unknown>)?.jobDescription as string)||(j.shortDesc as string)||"";
          const desc = cleanDescription(rawDesc).slice(0,800);
          const locArr = (j.locationsText as string)||(j.location as string)||"United States";
          // Parse Workday "Posted N Days Ago" → timestamp
          const postedOn = (j.postedOn as string)||"";
          let ts = 0;
          const dM = postedOn.match(/(\d+)\s+day/i);
          const wM = postedOn.match(/(\d+)\s+week/i);
          const mM = postedOn.match(/(\d+)\s+month/i);
          if (dM) ts = Math.floor(Date.now()/1000) - parseInt(dM[1])*86400;
          else if (wM) ts = Math.floor(Date.now()/1000) - parseInt(wM[1])*604800;
          else if (mM) ts = Math.floor(Date.now()/1000) - parseInt(mM[1])*2592000;
          else if (postedOn.toLowerCase().includes("today")) ts = Math.floor(Date.now()/1000);
          if (!shouldKeepJob(title,desc,"Full-time",locArr,ts,filter)) continue;
          const externalPath = (j.externalPath as string)||"";
          const applyUrl = externalPath
            ? `https://${tenant}.${server}.myworkdayjobs.com/en-US/${site}/job${externalPath}`
            : `https://${tenant}.${server}.myworkdayjobs.com/en-US/${site}`;
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

// ── Firecrawl direct company scrapers ─────────────────────────────────────
// Target companies not covered by Greenhouse/Workday — from priority list
// These use Firecrawl's /scrape endpoint to extract job listings from career pages
interface FirecrawlTarget {
  company: string;
  careerUrl: string;
  fortuneRank: number;
}

// ── Firecrawl config ─────────────────────────────────────────────────────
// CONCURRENCY=2: run exactly 2 companies at a time (not all at once)
// TIMEOUT=25000: 25s per company via AbortController
// Tier A always runs first; Tier B only if Tier A kept < FC_TIER_B_THRESHOLD
const FC_CONCURRENCY = 2;
const FC_TIMEOUT_MS  = 25000;
const FC_TIER_B_THRESHOLD = 20; // run Tier B if Tier A kept fewer than this

// Tier A — highest priority, always scraped
const FC_TIER_A: FirecrawlTarget[] = [
  { company:"Microsoft",    careerUrl:"https://careers.microsoft.com/us/en/search-results?keywords={query}&country=United%20States", fortuneRank:5  },
  { company:"Google",       careerUrl:"https://careers.google.com/jobs/results/?q={query}&location=United%20States",                 fortuneRank:35 },
  { company:"Apple",        careerUrl:"https://jobs.apple.com/en-us/search?search={query}&sort=newest&location=united-states-USA",    fortuneRank:3  },
  { company:"Meta",         careerUrl:"https://www.metacareers.com/jobs?q={query}&offices[0]=United%20States",                        fortuneRank:14 },
  { company:"JPMorgan Chase",careerUrl:"https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword={query}&location=United+States", fortuneRank:12 },
];

// Tier B — scraped only if Tier A results are thin
const FC_TIER_B: FirecrawlTarget[] = [
  { company:"IBM",          careerUrl:"https://www.ibm.com/us-en/employment/newhire/jobs/index.html?q={query}&country=US",            fortuneRank:22 },
  { company:"Oracle",       careerUrl:"https://careers.oracle.com/en/sites/jobsearch/jobs?keyword={query}&location=United+States",   fortuneRank:25 },
  { company:"Cisco",        careerUrl:"https://jobs.cisco.com/jobs/SearchJobs/{query}?21178=%5B169482%5D&21178_format=6020&listtype=proximity", fortuneRank:24 },
  { company:"Salesforce",   careerUrl:"https://careers.salesforce.com/en/jobs/?search={query}&region=North+America",                 fortuneRank:26 },
  { company:"Goldman Sachs",careerUrl:"https://www.goldmansachs.com/careers/exploring-careers/students/jobs-search/?region=AMER&q={query}", fortuneRank:53 },
  { company:"Morgan Stanley",careerUrl:"https://www.morganstanley.com/people-opportunities/students-graduates/programs/search/results?q={query}", fortuneRank:21 },
];

// Single-company fetch — 25s AbortController timeout, no outer Promise.all
async function fetchFirecrawlCompany(
  company: string, careerUrl: string, fortuneRank: number,
  expansion: ReturnType<typeof expandQuery>, filter: JobFilter, apiKey: string
): Promise<{jobs:Job[];raw:number;error:string|null}> {
  const url = careerUrl.replace("{query}", encodeURIComponent(expansion.primary));
  console.log(`Firecrawl START ${company} timeout=${FC_TIMEOUT_MS}ms`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FC_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {"Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json"},
      body: JSON.stringify({
        url,
        formats: ["extract"],
        extract: {
          schema: {
            type: "object",
            properties: {
              jobs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title:          { type: "string" },
                    location:       { type: "string" },
                    url:            { type: "string" },
                    postedDate:     { type: "string" },
                    description:    { type: "string" },
                    employmentType: { type: "string" },
                  },
                },
              },
            },
          },
          prompt: "Extract all software engineering job listings. For each: title, location, apply URL, posted date, brief description, employment type.",
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.error(`Firecrawl ${company} HTTP ${res.status}`);
      return {jobs:[], raw:0, error:`HTTP ${res.status}`};
    }
    const data = await res.json();
    const rawJobs = (data?.data?.extract?.jobs || data?.extract?.jobs || []) as Record<string,unknown>[];
    console.log(`Firecrawl ${company}: ${rawJobs.length} raw`);

    const jobs: Job[] = [];
    for (const j of rawJobs) {
      const title = (j.title as string)||"";
      const rawDesc = (j.description as string)||"";
      const desc = cleanDescription(rawDesc).slice(0,800);
      const location = (j.location as string)||"United States";
      const type = (j.employmentType as string)||"Full-time";
      const postedDateStr = (j.postedDate as string)||"";
      let ts = 0;
      if (postedDateStr) {
        const parsed = new Date(postedDateStr);
        if (!isNaN(parsed.getTime())) {
          ts = Math.floor(parsed.getTime()/1000);
        } else {
          const dM = postedDateStr.match(/(\d+)\s+day/i);
          const wM = postedDateStr.match(/(\d+)\s+week/i);
          if (dM) ts = Math.floor(Date.now()/1000) - parseInt(dM[1])*86400;
          else if (wM) ts = Math.floor(Date.now()/1000) - parseInt(wM[1])*604800;
        }
      }
      if (!shouldKeepJob(title, desc, type, location, ts, filter)) continue;
      jobs.push({
        id:`fc-${company.toLowerCase().replace(/\s+/g,"-")}-${Math.random().toString(36).slice(2,8)}`,
        title, company, location, type, description:desc,
        applyUrl:(j.url as string)||url,
        postedAt:postedDateStr,
        postedDate:ts?formatPostedDate(ts):postedDateStr||"Recently",
        postedTimestamp:ts, source:"Firecrawl", sourceType:"firecrawl",
        skills:extractMissingSkills(rawDesc),
        sponsorshipTag:detectSponsorship(rawDesc),
        experience:extractExperience(rawDesc),
        priorityTier:getPriorityTier(company),
        fortuneRank,
      });
    }
    console.log(`Firecrawl ${company}: ${rawJobs.length} raw → ${jobs.length} kept`);
    return {jobs, raw:rawJobs.length, error:null};
  } catch(e:unknown) {
    clearTimeout(timer);
    const isAbort = e instanceof Error && e.name === "AbortError";
    const msg = isAbort ? `timeout (${FC_TIMEOUT_MS}ms)` : String(e);
    console.error(`Firecrawl ${company} FAILED: ${msg}`);
    return {jobs:[], raw:0, error:msg};
  }
}

// Run a list of FirecrawlTargets with strict concurrency=2 (queue-based)
// Returns results in input order; never runs more than FC_CONCURRENCY at once
async function runFirecrawlBatch(
  targets: FirecrawlTarget[],
  expansion: ReturnType<typeof expandQuery>,
  filter: JobFilter,
  apiKey: string
): Promise<Array<{jobs:Job[];raw:number;error:string|null}>> {
  const results: Array<{jobs:Job[];raw:number;error:string|null}> = new Array(targets.length);
  const names = targets.map(t => t.company);
  console.log(`Firecrawl config: concurrency=${FC_CONCURRENCY} timeout=${FC_TIMEOUT_MS}ms companies=[${names.join(", ")}]`);

  // Process in chunks of FC_CONCURRENCY, sequentially between chunks
  for (let i = 0; i < targets.length; i += FC_CONCURRENCY) {
    const chunk = targets.slice(i, i + FC_CONCURRENCY);
    const chunkNames = chunk.map(t => t.company);
    console.log(`Firecrawl batch start: [${chunkNames.join(", ")}]`);

    const settled = await Promise.allSettled(
      chunk.map(({company, careerUrl, fortuneRank}) =>
        fetchFirecrawlCompany(company, careerUrl, fortuneRank, expansion, filter, apiKey)
      )
    );

    settled.forEach((r, j) => {
      const idx = i + j;
      if (r.status === "fulfilled") {
        results[idx] = r.value;
      } else {
        results[idx] = {jobs:[], raw:0, error:"promise rejected"};
      }
    });

    const chunkSummary = settled.map((r, j) => {
      const name = chunk[j].company;
      const val = r.status === "fulfilled" ? r.value : {raw:0, jobs:[], error:"rejected"};
      return `${name}: raw=${val.raw} kept=${val.jobs.length}${val.error ? ` err=${val.error}` : ""}`;
    }).join(" | ");
    console.log(`Firecrawl batch done: ${chunkSummary}`);
  }
  return results;
}

async function fetchFirecrawl(
  expansion: ReturnType<typeof expandQuery>,
  filter: JobFilter
): Promise<{jobs:Job[];status:SourceStatus}> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return {jobs:[],status:{status:"skipped",fetched:0,kept:0,error:"FIRECRAWL_API_KEY not set"}};

  // ── Tier A: always run first, concurrency=2 ───────────────────────────
  const tierAResults = await runFirecrawlBatch(FC_TIER_A, expansion, filter, apiKey);
  const tierAJobs = tierAResults.flatMap(r => r.jobs);
  const tierAKept = tierAJobs.length;
  console.log(`Firecrawl Tier A complete: ${tierAKept} kept`);

  // ── Tier B: only if Tier A came back thin ─────────────────────────────
  let tierBResults: Array<{jobs:Job[];raw:number;error:string|null}> = [];
  if (tierAKept < FC_TIER_B_THRESHOLD) {
    console.log(`Firecrawl Tier A thin (${tierAKept}<${FC_TIER_B_THRESHOLD}) — running Tier B`);
    tierBResults = await runFirecrawlBatch(FC_TIER_B, expansion, filter, apiKey);
  } else {
    console.log(`Firecrawl Tier A sufficient (${tierAKept}>=${FC_TIER_B_THRESHOLD}) — skipping Tier B`);
  }

  // ── Collect results ───────────────────────────────────────────────────
  const allResults = [...tierAResults, ...tierBResults];
  const allTargets = [...FC_TIER_A, ...FC_TIER_B.slice(0, tierBResults.length)];

  const allJobs: Job[] = [];
  let totalFetched = 0;
  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i];
    const company = allTargets[i].company;
    allJobs.push(...r.jobs);
    totalFetched += r.raw;
    if (r.error) {
      failCount++;
      errors.push(`${company}: ${r.error}`);
    } else {
      successCount++;
    }
  }

  const total = allResults.length;
  let overallStatus: SourceStatus["status"];
  if (failCount === 0)       overallStatus = "healthy";
  else if (successCount > 0) overallStatus = "degraded";
  else                       overallStatus = "broken";

  const errorSummary = failCount > 0
    ? `${failCount}/${total} failed: ${errors.slice(0,3).join("; ")}`
    : undefined;

  console.log(`Firecrawl complete: ${successCount}/${total} ok, ${totalFetched} raw, ${allJobs.length} kept`);
  return {
    jobs: allJobs,
    status: {status:overallStatus, fetched:totalFetched, kept:allJobs.length, error:errorSummary},
  };
}

// ── JSearch (fallback aggregator) ─────────────────────────────────────────
const JSEARCH_CACHE = new Map<string,{jobs:Job[],fetched:number,ts:number}>();
const JSEARCH_CACHE_TTL = 25 * 60 * 1000; // 25 min

async function jsearchFetch(
  term: string, filter: JobFilter, apiKey: string
): Promise<{raw:Record<string,unknown>[],rateLimited:boolean}> {
  const dateMap: Record<JobFilter,string> = {"24h":"today","3d":"3days","7d":"week","any":""};
  const params = new URLSearchParams({
    query: term,
    page: "1", num_pages: "2",
    country: "us",
    remote_jobs_only: "false",
    ...(dateMap[filter] && {date_posted:dateMap[filter]}),
  });
  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers:{"X-RapidAPI-Key":apiKey,"X-RapidAPI-Host":"jsearch.p.rapidapi.com"},
    cache:"no-store",
  });
  if (res.status===429) {
    const retryAfter = res.headers.get("retry-after")||res.headers.get("x-ratelimit-reset")||"unknown";
    console.error(`JSearch 429 for "${term}" — retry-after: ${retryAfter}`);
    return {raw:[],rateLimited:true};
  }
  if (!res.ok) { console.error(`JSearch HTTP ${res.status} for "${term}"`); return {raw:[],rateLimited:false}; }
  const data = await res.json();
  return {raw:(data.data||[]) as Record<string,unknown>[],rateLimited:false};
}

function jsearchMapJob(j: Record<string,unknown>, i: number, filter: JobFilter): Job|null {
  const rawDesc = (j.job_description as string)||"";
  const desc = cleanDescription(rawDesc).slice(0,800);
  const ts = (j.job_posted_at_timestamp as number)||0;
  const loc = [j.job_city,j.job_state,j.job_country].filter(Boolean).join(", ")||"Remote";
  const company = (j.employer_name as string)||"";
  const title = (j.job_title as string)||"";
  if (!title||!company) return null;
  if (!shouldKeepJob(title,desc,(j.job_employment_type as string)||"",loc,ts,filter)) return null;
  return {
    id:(j.job_id as string)||`js-${i}`,
    title, company, location:loc,
    type:(j.job_employment_type as string)||"Full-time",
    salary:j.job_min_salary?`$${Math.round(Number(j.job_min_salary)/1000)}k–$${Math.round(Number(j.job_max_salary)/1000)}k`:undefined,
    description:desc,
    applyUrl:(j.job_apply_link as string)||"#",
    postedAt:(j.job_posted_at_datetime_utc as string)||"",
    postedDate:ts?formatPostedDate(ts):"Recently",
    postedTimestamp:ts,
    source:(j.job_publisher as string)||"JSearch",
    sourceType:"jsearch",
    skills:extractMissingSkills(rawDesc),
    sponsorshipTag:detectSponsorship(rawDesc),
    experience:extractExperience(rawDesc),
    priorityTier:getPriorityTier(company),
    fortuneRank:getFortuneTier(company),
  };
}

async function fetchJSearch(
  query: string, filter: JobFilter
): Promise<{jobs:Job[];status:SourceStatus}> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return {jobs:[],status:{status:"skipped",fetched:0,kept:0,error:"RAPIDAPI_KEY not set"}};

  const cacheKey = `${query}::${filter}`;
  const cached = JSEARCH_CACHE.get(cacheKey);
  if (cached && Date.now()-cached.ts < JSEARCH_CACHE_TTL) {
    console.log(`JSearch cache hit: "${query}" (${cached.jobs.length} jobs)`);
    return {jobs:cached.jobs,status:{status:cached.jobs.length>0?"healthy":"degraded",fetched:cached.fetched,kept:cached.jobs.length}};
  }

  const expansion = expandQuery(query);
  const allJobs: Job[] = [];
  let totalFetched = 0;

  try {
    const {raw:primaryRaw,rateLimited:rl} = await jsearchFetch(expansion.primary, filter, apiKey);
    if (rl) return {jobs:[],status:{status:"rate_limited",fetched:0,kept:0,error:"HTTP 429 — rate limited"}};
    totalFetched += primaryRaw.length;
    console.log(`JSearch primary="${expansion.primary}" → ${primaryRaw.length} raw`);
    primaryRaw.forEach((j,i) => { const job=jsearchMapJob(j,i,filter); if(job) allJobs.push(job); });

    // Fallback only if below threshold
    if (primaryRaw.length < 10) {
      const fallbacks = ["backend engineer","frontend engineer","full stack engineer"].slice(0,2);
      for (const term of fallbacks) {
        if (allJobs.length >= 25) break;
        const {raw,rateLimited} = await jsearchFetch(term, filter, apiKey);
        if (rateLimited) { console.warn(`JSearch 429 on fallback "${term}" — stopping`); break; }
        totalFetched += raw.length;
        raw.forEach((j,i) => { const job=jsearchMapJob(j,totalFetched+i,filter); if(job) allJobs.push(job); });
      }
    }

    JSEARCH_CACHE.set(cacheKey, {jobs:allJobs,fetched:totalFetched,ts:Date.now()});
    return {jobs:allJobs,status:{status:allJobs.length>0?"healthy":"degraded",fetched:totalFetched,kept:allJobs.length}};
  } catch(e:unknown) {
    return {jobs:[],status:{status:"broken",fetched:0,kept:0,error:String(e)}};
  }
}

// ── Adzuna (backup/enrichment) ─────────────────────────────────────────────
async function fetchAdzuna(
  query: string, filter: JobFilter
): Promise<{jobs:Job[];status:SourceStatus}> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId||!appKey) return {jobs:[],status:{status:"skipped",fetched:0,kept:0,error:"ADZUNA keys not set"}};

  const maxDaysMap: Record<JobFilter,number|undefined> = {"24h":1,"3d":3,"7d":7,"any":undefined};
  const maxDays = maxDaysMap[filter];
  try {
    const params = new URLSearchParams({
      app_id:appId, app_key:appKey,
      results_per_page:"50",
      what:query,
      where:"united states",
      "content-type":"application/json",
      full_time:"1",
      ...(maxDays?{max_days_old:String(maxDays)}:{}),
    });
    const res = await fetch(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`,{cache:"no-store"});
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const raw = (data.results||[]) as Record<string,unknown>[];
    const jobs: Job[] = [];
    for (const j of raw) {
      const title = (j.title as string)||"";
      const rawDesc = (j.description as string)||"";
      const desc = cleanDescription(rawDesc).slice(0,800);
      const locObj = (j.location as Record<string,unknown>)||{};
      const location = (locObj.display_name as string)||"United States";
      const company = ((j.company as Record<string,unknown>)?.display_name as string)||"";
      const createdAt = (j.created as string)||"";
      const ts = createdAt?Math.floor(new Date(createdAt).getTime()/1000):0;
      if (!shouldKeepJob(title,desc,"Full-time",location,ts,filter)) continue;
      const salMin = j.salary_min?Math.round(Number(j.salary_min)/1000):0;
      const salMax = j.salary_max?Math.round(Number(j.salary_max)/1000):0;
      jobs.push({
        id:`az-${j.id??Math.random()}`,
        title, company, location, type:"Full-time",
        salary:salMin>0?`$${salMin}k–$${salMax}k`:undefined,
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

// ── Jooble (gap filler) ────────────────────────────────────────────────────
async function fetchJooble(
  query: string, filter: JobFilter
): Promise<{jobs:Job[];status:SourceStatus}> {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return {jobs:[],status:{status:"skipped",fetched:0,kept:0,error:"JOOBLE_API_KEY not set"}};

  // Jooble date filter: datePosted in days
  const dateMap: Record<JobFilter,number|undefined> = {"24h":1,"3d":3,"7d":7,"any":undefined};
  const dateDays = dateMap[filter];

  try {
    const body: Record<string,unknown> = {
      keywords: query,
      location: "United States",
      page: 1,
    };
    if (dateDays) body.datecreatedfrom = new Date(Date.now()-dateDays*86400000).toISOString().split("T")[0];

    const res = await fetch(`https://jooble.org/api/${apiKey}`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return {jobs:[],status:{status:"degraded",fetched:0,kept:0,error:`HTTP ${res.status}`}};
    const data = await res.json();
    const raw = (data.jobs||[]) as Record<string,unknown>[];
    const jobs: Job[] = [];
    for (const j of raw) {
      const title = (j.title as string)||"";
      const rawDesc = (j.snippet as string)||(j.description as string)||"";
      const desc = cleanDescription(rawDesc).slice(0,800);
      const location = (j.location as string)||"United States";
      const company = (j.company as string)||"";
      const updatedAt = (j.updated as string)||"";
      const ts = updatedAt?Math.floor(new Date(updatedAt).getTime()/1000):0;
      if (!shouldKeepJob(title,desc,"Full-time",location,ts,filter)) continue;
      const salaryStr = (j.salary as string)||"";
      jobs.push({
        id:`jb-${j.id??Math.random()}`,
        title, company, location, type:"Full-time",
        salary:salaryStr||undefined,
        description:desc, applyUrl:(j.link as string)||"#",
        postedAt:updatedAt, postedDate:ts?formatPostedDate(ts):"Recently",
        postedTimestamp:ts, source:"Jooble", sourceType:"jooble",
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

// ── Shared result type ────────────────────────────────────────────────────
type SourceResult = { jobs: Job[]; status: SourceStatus };

// ── Per-source caps: prevent any single source from monopolizing results ──
const SOURCE_CAPS: Record<string, number> = {
  greenhouse: 140,
  workday:     60,
  firecrawl:   80,
  jsearch:     60,
  adzuna:      30,
  jooble:      20,
};

function applySourceCap(jobs: Job[], sourceType: string): Job[] {
  const cap = SOURCE_CAPS[sourceType] ?? 50;
  return jobs.slice(0, cap);
}

// ── Main Handler ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const {searchParams} = new URL(req.url);
  const query  = searchParams.get("q")||"";
  const filter = (searchParams.get("filter") as JobFilter)||"any";
  const sort   = (searchParams.get("sort") as SortOption)||"company_desc";

  if (!query.trim()) return NextResponse.json({error:"query required"},{status:400});

  const expansion = expandQuery(query);

  try {
    // ── Tier 1: Primary sources (always run in parallel) ─────────────────
    // Firecrawl runs per-company internally — no outer withTimeout needed
    const [rGHp, rWDp, rFCp] = await Promise.allSettled([
      withTimeout(fetchGreenhouse(expansion, filter), 32000, {jobs:[],status:{status:"broken",fetched:0,kept:0,error:"timeout"}} as SourceResult),
      withTimeout(fetchWorkday(expansion, filter),    32000, {jobs:[],status:{status:"broken",fetched:0,kept:0,error:"timeout"}} as SourceResult),
      fetchFirecrawl(expansion, filter), // no outer timeout — managed per-company internally
    ]);

    const getR = (r: PromiseSettledResult<SourceResult>): SourceResult =>
      r.status==="fulfilled" ? r.value : {jobs:[],status:{status:"broken",fetched:0,kept:0,error:"promise rejected"}};

    const rGH = getR(rGHp);
    const rWD = getR(rWDp);
    const rFC = getR(rFCp);

    // Apply per-source caps before threshold calculations
    const ghJobs = applySourceCap(rGH.jobs.filter(j=>j.title&&j.company), "greenhouse");
    const wdJobs = applySourceCap(rWD.jobs.filter(j=>j.title&&j.company), "workday");
    const fcJobs = applySourceCap(rFC.jobs.filter(j=>j.title&&j.company), "firecrawl");

    const tier1Visible = ghJobs.length + wdJobs.length + fcJobs.length;
    const ghShare = ghJobs.length / Math.max(tier1Visible, 1);

    console.log(`Tier 1: GH=${ghJobs.length}(share=${(ghShare*100).toFixed(0)}%) WD=${wdJobs.length} FC=${fcJobs.length} total=${tier1Visible}`);

    // ── Tiered fallback logic — prevents Greenhouse from blocking JSearch ─
    // Run JSearch if: not enough results OR Greenhouse is dominating (>70%)
    const needsJSearch  = tier1Visible < 220 || ghShare > 0.7;
    const needsAdzuna   = tier1Visible < 260;  // computed before JSearch runs (conservative)
    const needsJooble   = tier1Visible < 300;

    let rJS: SourceResult = {jobs:[], status:{status:"skipped",fetched:0,kept:0,error:`tier1=${tier1Visible}≥220 and ghShare=${(ghShare*100).toFixed(0)}%≤70%`}};
    let rAZ: SourceResult = {jobs:[], status:{status:"skipped",fetched:0,kept:0,error:`tier1=${tier1Visible}≥260`}};
    let rJB: SourceResult = {jobs:[], status:{status:"skipped",fetched:0,kept:0,error:`tier1=${tier1Visible}≥300`}};

    // Run needed fallbacks in parallel
    const fallbackPromises: Promise<void>[] = [];

    if (needsJSearch) {
      console.log(`Running JSearch (tier1=${tier1Visible}, ghShare=${(ghShare*100).toFixed(0)}%)`);
      fallbackPromises.push(
        withTimeout(fetchJSearch(query, filter), 20000, {jobs:[],status:{status:"broken",fetched:0,kept:0,error:"timeout"}} as SourceResult)
          .then(r => { rJS = r; })
      );
    }
    if (needsAdzuna) {
      console.log(`Running Adzuna (tier1=${tier1Visible})`);
      fallbackPromises.push(
        withTimeout(fetchAdzuna(query, filter), 15000, {jobs:[],status:{status:"broken",fetched:0,kept:0,error:"timeout"}} as SourceResult)
          .then(r => { rAZ = r; })
      );
    }
    if (needsJooble) {
      console.log(`Running Jooble (tier1=${tier1Visible})`);
      fallbackPromises.push(
        withTimeout(fetchJooble(query, filter), 15000, {jobs:[],status:{status:"broken",fetched:0,kept:0,error:"timeout"}} as SourceResult)
          .then(r => { rJB = r; })
      );
    }

    if (fallbackPromises.length > 0) await Promise.allSettled(fallbackPromises);

    const jsJobs = applySourceCap(rJS.jobs.filter(j=>j.title&&j.company), "jsearch");
    const azJobs = applySourceCap(rAZ.jobs.filter(j=>j.title&&j.company), "adzuna");
    const jbJobs = applySourceCap(rJB.jobs.filter(j=>j.title&&j.company), "jooble");

    const totalVisible = tier1Visible + jsJobs.length + azJobs.length + jbJobs.length;
    console.log(`All sources: JS=${jsJobs.length} AZ=${azJobs.length} JB=${jbJobs.length} total=${totalVisible}`);

    // ── Combine, deduplicate, sort ────────────────────────────────────────
    const allJobs = [...ghJobs, ...wdJobs, ...fcJobs, ...jsJobs, ...azJobs, ...jbJobs];
    const scored  = allJobs.map(j=>({...j, relevanceScore:computeRelevanceScore(j)}));
    const unique  = deduplicateJobs(scored);
    const capped  = applyPerCompanyCap(unique);
    const sorted  = sortJobs(capped, sort);
    const final   = sorted.slice(0, 500);

    // ── Diagnostics ───────────────────────────────────────────────────────
    const sourceKeys = ["greenhouse","workday","firecrawl","jsearch","adzuna","jooble"] as const;
    const allResults: SourceResult[] = [rGH, rWD, rFC, rJS, rAZ, rJB];

    const sourceStatus: Record<string,SourceStatus> = {};
    sourceKeys.forEach((k,i) => { sourceStatus[k] = allResults[i].status; });

    const sources: Record<string,number> = {};
    sourceKeys.forEach(k => {
      sources[k] = final.filter(j => j.sourceType === k).length;
    });

    const sourceDiagnostics: SourceDiagnostic[] = sourceKeys.map((k,i) => {
      const st = allResults[i].status;
      const rawCount = st.fetched;
      const postFilterCount = sources[k];
      const called = st.status !== "skipped";
      let status: SourceDiagnostic["status"];
      if (st.status==="skipped")           status="skipped";
      else if (st.status==="rate_limited") status="rate_limited";
      else if (st.error==="timeout")       status="timeout";
      else if (st.status==="healthy" && rawCount>0) status="success";
      else if (st.status==="degraded" && rawCount>0) status="success"; // partial firecrawl
      else if (st.status==="degraded")     status="degraded";
      else                                 status="error";
      return {source:k, called, status, rawCount, postFilterCount, error:st.error||null};
    });

    console.log(`Final: ${final.length} | Diag: ${JSON.stringify(sourceDiagnostics.map(d=>({s:d.source,st:d.status,raw:d.rawCount,kept:d.postFilterCount})))}`);

    return NextResponse.json({
      jobs: final,
      count: final.length,
      sources,
      sourceStatus,
      sourceDiagnostics,
      queryMode: expansion.mode,
      expandedTerms: expansion.terms.length,
      tier1Visible,
      totalVisible,
      ghShare: Math.round(ghShare * 100),
      usedFallback: needsJSearch || needsAdzuna || needsJooble,
    });

  } catch(err:unknown) {
    return NextResponse.json({error:err instanceof Error?err.message:"Unknown error"},{status:500});
  }
}

import { NextRequest, NextResponse } from "next/server";

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
  sourceType: "jsearch" | "greenhouse" | "lever" | "remotive" | "other";
  skills: string[];
  sponsorshipTag: "mentioned" | "not_mentioned";
  experience?: string;
  priorityTier?: "highest" | "high" | "must_apply";
  fortuneRank?: number;
}

// ── Fortune 500 ranking for sort ───────────────────────────────────────────
const FORTUNE_RANK: Record<string, number> = {
  "walmart":1,"amazon":2,"apple":3,"unitedhealth":4,"berkshire":5,
  "exxon":6,"cvs":7,"elevance":8,"mckesson":9,"at&t":10,
  "cigna":11,"costco":12,"cardinal health":13,"microsoft":14,"kroger":15,
  "home depot":16,"Goldman sachs":17,"jpmorgan":18,"verizon":19,"ford":20,
  "chevron":21,"centene":22,"meta":23,"comcast":24,"target":25,
  "fedex":26,"wellpoint":27,"pfizer":28,"bank of america":29,
  "johnson":30,"general motors":31,"alphabet":32,"google":33,
  "wells fargo":34,"ups":35,"lowe's":36,"lowes":37,"cigna":38,
  "morgan stanley":39,"ibm":40,"intel":41,"cisco":42,"nike":43,
  "oracle":44,"salesforce":45,"adobe":46,"sap":47,"workday":48,
  "servicenow":49,"atlassian":50,"nvidia":51,"capital one":52,
  "t-mobile":53,"stripe":54,"databricks":55,"snowflake":56,
  "cloudflare":57,"mongodb":58,"confluent":59,"hashicorp":60,
  "openai":61,"anthropic":62,"accenture":63,"infosys":64,
  "cognizant":65,"tata consultancy":66,"tcs":66,"capgemini":67,
  "paypal":68,"visa":69,"mastercard":70,"ups":71,"fedex":72,
  "jpmorgan chase":18,
};

function getFortuneTier(company: string): number {
  const lc = company.toLowerCase();
  for (const [key, rank] of Object.entries(FORTUNE_RANK)) {
    if (lc === key || lc.includes(key)) return rank;
  }
  return 9999;
}

// ── Priority tiers ─────────────────────────────────────────────────────────
const PRIORITY_MAP: Record<string, "highest"|"high"|"must_apply"> = {
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
  "t-mobile":"high","at&t":"high",
  "cigna":"must_apply","openai":"must_apply","anthropic":"must_apply",
  "accenture":"must_apply","cognizant":"must_apply","infosys":"must_apply",
  "tata consultancy":"must_apply","tcs":"must_apply","capgemini":"must_apply",
  "paypal":"must_apply","visa":"must_apply","mastercard":"must_apply",
  "stripe":"must_apply","ups":"must_apply","fedex":"must_apply","verizon":"must_apply",
};

function getPriorityTier(company: string): "highest"|"high"|"must_apply"|undefined {
  const lc = company.toLowerCase();
  for (const [key, tier] of Object.entries(PRIORITY_MAP)) {
    if (lc === key || lc.includes(key)) return tier;
  }
  return undefined;
}

// Priority companies that need dedicated JSearch calls (not on Greenhouse/Lever)
const JSEARCH_PRIORITY_COMPANIES = [
  "Microsoft","Amazon","Google","Apple","Meta","Oracle","Intel","Cisco","IBM",
  "Walmart","JPMorgan Chase","Goldman Sachs","Morgan Stanley","Bank of America",
  "Wells Fargo","Capital One","Target","Home Depot","Costco",
  "UnitedHealth Group","Elevance Health","CVS Health","NVIDIA","SAP",
  "T-Mobile","AT&T","Salesforce",
];

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

// ── Job quality filters ────────────────────────────────────────────────────
function isContractOrPartTime(type: string, desc: string): boolean {
  const lc=(type+" "+desc.slice(0,300)).toLowerCase();
  return /\bcontract(or)?\b|\bpart.?time\b|\bintern(ship)?\b|\bfreelance\b|\btemporary\b|\btemp\b/.test(lc);
}

function requiresSecurityClearance(title: string, desc: string): boolean {
  const text=(title+" "+desc).toLowerCase();
  return /\b(security\s+clearance|secret\s+clearance|top\s+secret|ts\/sci|ts-sci|clearance\s+required|active\s+clearance|dod\s+clearance|public\s+trust|nato\s+secret|classified|polygraph)\b/.test(text);
}

function requiresMachineLearning(title: string, desc: string): boolean {
  // Remove job if ML is in the title OR mentioned 3+ times in description
  if (/\b(machine\s+learning|ml\s+engineer|deep\s+learning|data\s+scientist|nlp\s+engineer|computer\s+vision)\b/i.test(title)) return true;
  const mlMatches = (desc.match(/\b(machine\s+learning|deep\s+learning|neural\s+network|pytorch|tensorflow|scikit|ml\s+model)\b/gi)||[]).length;
  return mlMatches >= 3;
}

function requiresGrpc(title: string, desc: string): boolean {
  // Remove if gRPC in title OR mentioned 2+ times in description as primary requirement
  if (/\bgrpc\b/i.test(title)) return true;
  const matches = (desc.match(/\bgrpc\b/gi)||[]).length;
  return matches >= 2;
}

function hasBackgroundMismatch(title: string): boolean {
  return /\b(data\s+scientist|data\s+analyst|bi\s+analyst|business\s+analyst|business\s+intelligence|security\s+engineer|cybersecurity|penetration\s+test|pentest|infosec|network\s+engineer|sysadmin|systems\s+administrator|research\s+scientist|ai\s+researcher)\b/i.test(title);
}

function isAIJob(title: string, desc: string): boolean {
  return /\b(ai\s+engineer|llm|large\s+language|generative\s+ai|gen\s+ai|foundation\s+model|prompt\s+engineer|ai\s+platform|agentic)\b/i.test(title+" "+desc.slice(0,200));
}

// Master filter — returns true if job should be KEPT
function shouldKeepJob(title: string, desc: string, type: string, location: string, aiCount: {n: number}): boolean {
  if (isContractOrPartTime(type, desc)) return false;
  if (!isUSLocation(location)) return false;
  if (requiresSecurityClearance(title, desc)) return false;
  if (requiresMachineLearning(title, desc)) return false;
  if (requiresGrpc(title, desc)) return false;
  if (hasBackgroundMismatch(title)) return false;
  // AI jobs: allow up to 15
  if (isAIJob(title, desc)) {
    if (aiCount.n >= 15) return false;
    aiCount.n++;
  }
  return true;
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

// ── Title relevance ────────────────────────────────────────────────────────
// ── Title filtering — broad allowlist, tight blocklist ────────────────────
// Allowlist: any title indicating software/tech development work
const TITLE_ALLOWLIST = /(engineer|developer|programmer|architect|devops|sre|reliability|infrastructure|platform|backend|back.?end|frontend|front.?end|full.?stack|fullstack|software|systems|cloud|api|integration|distributed|scalable|swe|java|python|javascript|typescript|node\.?js|golang|go|rust|ruby|scala|kotlin|swift|c\+\+|c#|\.net|php|spring|react|angular|vue|ember|next\.?js|nestjs|rails|laravel|django|flask|fastapi|express|mobile|ios|android|embedded|firmware|web\s|web$|application|apps?\s|apps?$)/i;

// Blocklist: non-SWE roles or roles that don't match background
const TITLE_BLOCKLIST = /(manager|director|vp|vice\s+president|head\s+of|staff\s+engineer|principal\s+engineer|distinguished\s+engineer|fellow|machine\s+learning\s+engineer|ml\s+engineer|data\s+scientist|data\s+science|data\s+engineer|data\s+analyst|research\s+scientist|ai\s+researcher|nlp\s+engineer|computer\s+vision|security\s+engineer|cybersecurity|penetration\s+test|pentest|infosec|information\s+security|network\s+engineer|sysadmin|systems\s+administrator|database\s+administrator|dba|recruiter|recruitment|talent\s+acquisition|hr|sales|account\s+executive|account\s+manager|marketing|finance|auditor|accountant|program\s+manager|product\s+manager|product\s+designer|ux\s+designer|ui\s+designer|apprentice|intern|internship|business\s+analyst|scrum\s+master|project\s+manager|relationship\s+manager|chief|officer|legal|web3|blockchain|crypto|defi|nft|solidity|smart\s+contract|salesforce\s+developer|site\s+reliability\s+engineer)/i;

function isRelevantTitle(title: string): boolean {
  return TITLE_ALLOWLIST.test(title) && !TITLE_BLOCKLIST.test(title);
}

function isTitleRelevantToQuery(title: string, query: string): boolean {
  if (!query) return false;
  const qWords = query.toLowerCase().split(/\s+/).filter(w=>w.length>2);
  const tl = title.toLowerCase();
  return qWords.filter(w=>tl.includes(w)).length >= Math.ceil(qWords.length/2);
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
  const TIER_SCORE: Record<string, number> = { highest: 0, high: 1, must_apply: 2 };
  return [...jobs].sort((a, b) => {
    switch (sort) {
      case "date_desc":
        return (b.postedTimestamp||0)-(a.postedTimestamp||0);
      case "date_asc":
        return (a.postedTimestamp||0)-(b.postedTimestamp||0);
      case "company_desc": {
        // Fortune 500 rank ascending (lower = better), then newest
        const ra = getFortuneTier(a.company), rb = getFortuneTier(b.company);
        if (ra!==rb) return ra-rb;
        const ta = TIER_SCORE[a.priorityTier||""] ?? 3;
        const tb = TIER_SCORE[b.priorityTier||""] ?? 3;
        if (ta!==tb) return ta-tb;
        return (b.postedTimestamp||0)-(a.postedTimestamp||0);
      }
      case "company_asc": {
        // Reverse — lowest priority first
        const ra = getFortuneTier(a.company), rb = getFortuneTier(b.company);
        if (ra!==rb) return rb-ra;
        return (a.postedTimestamp||0)-(b.postedTimestamp||0);
      }
      default:
        return (b.postedTimestamp||0)-(a.postedTimestamp||0);
    }
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(res=>setTimeout(()=>res(fallback),ms))]);
}

const DATE_MAP: Record<JobFilter,string> = {
  "24h":"today","7d":"week","30d":"month","any":"",
};

// ── JSearch ────────────────────────────────────────────────────────────────
async function fetchJSearch(query: string, filter: JobFilter, page=1, companyOverride=""): Promise<Job[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return [];

  const searchQuery = companyOverride
    ? `${query} at ${companyOverride}`
    : `${query} in USA`;

  const params = new URLSearchParams({
    query: searchQuery,
    page: String(page),
    num_pages: companyOverride ? "1" : "3",
    country: "us",
    ...(DATE_MAP[filter] && !companyOverride && { date_posted: DATE_MAP[filter] }),
  });

  try {
    const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
      headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data||[]) as Record<string,unknown>[];
  } catch { return []; }
}

async function fetchJSearchRaw(query: string, filter: JobFilter, page=1, companyOverride=""): Promise<Job[]> {
  const raw = await fetchJSearch(query, filter, page, companyOverride) as unknown as Record<string,unknown>[];
  const aiCount = { n: 0 };
  return raw
    .map((j,i): Job => {
      const rawDesc=(j.job_description as string)||"";
      const desc=cleanDescription(rawDesc).slice(0,800);
      const ts=(j.job_posted_at_timestamp as number)||0;
      const loc=[j.job_city,j.job_state,j.job_country].filter(Boolean).join(", ")||"Remote";
      const company=(j.employer_name as string)||"";
      return {
        id:(j.job_id as string)||`js-${page}-${i}`,
        title:(j.job_title as string)||"",
        company, location:loc,
        type:(j.job_employment_type as string)||"Full-time",
        salary:j.job_min_salary?`$${Math.round(Number(j.job_min_salary)/1000)}k–$${Math.round(Number(j.job_max_salary)/1000)}k`:undefined,
        description:desc,
        applyUrl:(j.job_apply_link as string)||"#",
        postedAt:(j.job_posted_at_datetime_utc as string)||"",
        postedDate:ts?formatPostedDate(ts):"Recently",
        postedTimestamp:ts, source:(j.job_publisher as string)||"Job Board",
        sourceType:"jsearch",
        skills:extractMissingSkills(rawDesc),
        sponsorshipTag:detectSponsorship(rawDesc),
        experience:extractExperience(rawDesc),
        priorityTier:getPriorityTier(company),
        fortuneRank:getFortuneTier(company),
      };
    })
    .filter(j=>
      j.title && j.company &&
      (isRelevantTitle(j.title)||isTitleRelevantToQuery(j.title,query)) &&
      shouldKeepJob(j.title,j.description,j.type,j.location,aiCount)
    );
}

// ── Greenhouse ─────────────────────────────────────────────────────────────
const GREENHOUSE_COMPANIES = [
  // Original
  "airbnb","stripe","doordash","openai","coinbase","gusto","brex","notion",
  "plaid","lattice","figma","robinhood","benchling","mixpanel","amplitude",
  "segment","flexport","mercury","ramp","checkr",
  // Priority additions
  "confluent","cloudflare","mongodb","hashicorp","anthropic","databricks",
  "snowflake","atlassian","servicenow","workday","adobe","paypal","visa",
  "mastercard","verizon","infosys","cognizant","accenture","capgemini",
];

async function fetchGreenhouse(query: string): Promise<Job[]> {
  const results: Job[] = [];
  const aiCount = { n: 0 };
  await Promise.allSettled(
    GREENHOUSE_COMPANIES.map(async company => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
          { next: { revalidate: 3600 } }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const j of (data.jobs||[]) as Record<string,unknown>[]) {
          const title=(j.title as string)||"";
          if (!isRelevantTitle(title)&&!isTitleRelevantToQuery(title,query)) continue;
          const rawContent=(j.content as string)||"";
          const desc=cleanDescription(rawContent).slice(0,800);
          const location=((j.location as Record<string,unknown>)?.name as string)||"Remote";
          if (!shouldKeepJob(title,desc,"",location,aiCount)) continue;
          const url=(j.absolute_url as string)||"#";
          const updatedAt=(j.updated_at as string)||"";
          const ts=updatedAt?Math.floor(new Date(updatedAt).getTime()/1000):0;
          const displayName=company.charAt(0).toUpperCase()+company.slice(1);
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
        }
      } catch { /**/ }
    })
  );
  return results;
}

// ── Lever ──────────────────────────────────────────────────────────────────
const LEVER_COMPANIES = [
  // Original
  "netflix","reddit","webflow","miro","airtable","asana","attentive",
  "loom","superhuman","deel","remote","scale-ai","alchemy",
  "postman","vercel","neo4j","launchdarkly","envoy","sourcegraph",
  // Priority additions
  "stripe","figma","notion","brex","gusto","ramp","plaid",
];

async function fetchLever(query: string): Promise<Job[]> {
  const results: Job[] = [];
  const aiCount = { n: 0 };
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
        for (const j of jobs as Record<string,unknown>[]) {
          const title=(j.text as string)||"";
          if (!isRelevantTitle(title)&&!isTitleRelevantToQuery(title,query)) continue;
          const plainDesc=(j.descriptionPlain as string)||"";
          const rawDesc=(j.description as string)||plainDesc;
          const desc=cleanDescription(plainDesc||rawDesc).slice(0,800);
          const cats=(j.categories as Record<string,unknown>)||{};
          const commitment=(cats.commitment as string)||"";
          const location=(cats.location as string)||"Remote";
          if (!shouldKeepJob(title,desc,commitment,location,aiCount)) continue;
          const url=(j.hostedUrl as string)||"#";
          const createdAt=(j.createdAt as number)||0;
          const ts=createdAt>1e10?Math.floor(createdAt/1000):createdAt;
          const displayName=company.charAt(0).toUpperCase()+company.slice(1).replace(/-/g," ");
          results.push({
            id:`lever-${company}-${j.id??Math.random()}`,
            title, company:displayName, location, type:commitment||"Full-time",
            description:desc, applyUrl:url,
            postedAt:createdAt?new Date(createdAt>1e10?createdAt:createdAt*1000).toISOString():"",
            postedDate:ts?formatPostedDate(ts):"Recently",
            postedTimestamp:ts, source:"Lever", sourceType:"lever",
            skills:extractMissingSkills(rawDesc),
            sponsorshipTag:detectSponsorship(rawDesc),
            experience:extractExperience(rawDesc),
            priorityTier:getPriorityTier(displayName),
            fortuneRank:getFortuneTier(displayName),
          });
        }
      } catch { /**/ }
    })
  );
  return results;
}

// ── Remotive ───────────────────────────────────────────────────────────────
async function fetchRemotive(query: string): Promise<Job[]> {
  const aiCount = { n: 0 };
  try {
    const res = await fetch(
      `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=50`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.jobs||[]) as Record<string,unknown>[])
      .filter(j => {
        const title=(j.title as string)||"";
        const loc=(j.candidate_required_location as string)||"";
        const isUS=!loc||["usa","united states","us only","remote","worldwide","anywhere"].some(k=>loc.toLowerCase().includes(k));
        return isRelevantTitle(title)&&isUS;
      })
      .map((j,i): Job => {
        const rawDesc=(j.description as string)||"";
        const desc=cleanDescription(rawDesc).slice(0,800);
        const pubDate=(j.publication_date as string)||"";
        const ts=pubDate?Math.floor(new Date(pubDate).getTime()/1000):0;
        const company=(j.company_name as string)||"";
        return {
          id:`remotive-${j.id??i}`,
          title:(j.title as string)||"",
          company, location:(j.candidate_required_location as string)||"Remote",
          type:(j.job_type as string)||"Full-time",
          description:desc, applyUrl:(j.url as string)||"#",
          postedAt:pubDate, postedDate:ts?formatPostedDate(ts):"Recently",
          postedTimestamp:ts, source:"Remotive", sourceType:"other",
          skills:extractMissingSkills(rawDesc),
          sponsorshipTag:detectSponsorship(rawDesc),
          experience:extractExperience(rawDesc),
          priorityTier:getPriorityTier(company),
          fortuneRank:getFortuneTier(company),
        };
      })
      .filter(j=>shouldKeepJob(j.title,j.description,j.type,j.location,aiCount));
  } catch { return []; }
}

// ── Main Handler ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query  = searchParams.get("q")||"";
  const filter = (searchParams.get("filter") as JobFilter)||"any";
  const sort   = (searchParams.get("sort") as SortOption)||"company_desc";

  if (!query.trim()) return NextResponse.json({ error:"query required" },{ status:400 });

  try {
    // Build JSearch priority company calls (1 per batch of companies)
    const priorityBatches = [
      JSEARCH_PRIORITY_COMPANIES.slice(0,9).join(" OR "),   // enterprise tech
      JSEARCH_PRIORITY_COMPANIES.slice(9,18).join(" OR "),  // finance/retail
      JSEARCH_PRIORITY_COMPANIES.slice(18).join(" OR "),    // telecom/health/other
    ];

    const [
      r1, r2,           // JSearch general pages
      rP1, rP2, rP3,   // JSearch priority company batches
      rGH,             // Greenhouse
      rLV,             // Lever
      rRM,             // Remotive
    ] = await Promise.allSettled([
      withTimeout(fetchJSearchRaw(query, filter, 1), 15000, []),
      withTimeout(fetchJSearchRaw(query, filter, 2), 15000, []),
      withTimeout(fetchJSearchRaw(`${query} ${priorityBatches[0]}`, filter, 1), 15000, []),
      withTimeout(fetchJSearchRaw(`${query} ${priorityBatches[1]}`, filter, 1), 15000, []),
      withTimeout(fetchJSearchRaw(`${query} ${priorityBatches[2]}`, filter, 1), 15000, []),
      withTimeout(fetchGreenhouse(query), 25000, []),
      withTimeout(fetchLever(query), 25000, []),
      withTimeout(fetchRemotive(query), 15000, []),
    ]);

    const allJobs: Job[] = [
      ...(r1.status==="fulfilled"?r1.value:[]),
      ...(r2.status==="fulfilled"?r2.value:[]),
      ...(rP1.status==="fulfilled"?rP1.value:[]),
      ...(rP2.status==="fulfilled"?rP2.value:[]),
      ...(rP3.status==="fulfilled"?rP3.value:[]),
      ...(rGH.status==="fulfilled"?rGH.value:[]),
      ...(rLV.status==="fulfilled"?rLV.value:[]),
      ...(rRM.status==="fulfilled"?rRM.value:[]),
    ].filter(j=>j.title&&j.company);

    const unique = deduplicateJobs(allJobs);
    const sorted = sortJobs(unique, sort);

    const sources = {
      jsearch:    unique.filter(j=>j.sourceType==="jsearch").length,
      greenhouse: unique.filter(j=>j.sourceType==="greenhouse").length,
      lever:      unique.filter(j=>j.sourceType==="lever").length,
      remotive:   unique.filter(j=>j.sourceType==="other").length,
    };

    console.log(`Jobs "${query}" sort:${sort} → ${unique.length} jobs | ${JSON.stringify(sources)}`);

    return NextResponse.json({ jobs:sorted, count:sorted.length, sources });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error:message },{ status:500 });
  }
}

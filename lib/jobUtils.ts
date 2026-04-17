// ── Shared job utility functions ──────────────────────────────────────────
// Imported by: app/api/jobs/route.ts, app/api/jobs/refresh/route.ts, etc.

export const FORTUNE_RANK: Record<string, number> = {
  "walmart": 1, "amazon": 2, "apple": 3, "unitedhealth": 4, "microsoft": 5,
  "cvs": 6, "elevance": 7, "at&t": 8, "cigna": 9, "costco": 10,
  "home depot": 11, "jpmorgan": 12, "jpmorgan chase": 12, "verizon": 13,
  "meta": 14, "target": 15, "fedex": 16, "bank of america": 17,
  "wells fargo": 18, "ups": 19, "lowe's": 20, "lowes": 20,
  "morgan stanley": 21, "ibm": 22, "intel": 23, "cisco": 24,
  "oracle": 25, "salesforce": 26, "adobe": 27, "sap": 28, "workday": 29,
  "servicenow": 30, "atlassian": 31, "nvidia": 32, "capital one": 33,
  "t-mobile": 34, "google": 35, "alphabet": 35,
  "stripe": 36, "databricks": 37, "snowflake": 38,
  "cloudflare": 39, "mongodb": 40, "confluent": 41, "hashicorp": 42,
  "openai": 43, "anthropic": 44, "accenture": 45, "infosys": 46,
  "cognizant": 47, "tata consultancy": 48, "tcs": 48, "capgemini": 49,
  "paypal": 50, "visa": 51, "mastercard": 52,
  "goldman sachs": 53, "s&p": 54, "sp global": 54,
};

export function getFortuneTier(company: string): number {
  const lc = company.toLowerCase();
  for (const [key, rank] of Object.entries(FORTUNE_RANK)) {
    if (lc === key || lc.includes(key)) return rank;
  }
  return 9999;
}

const PRIORITY_MAP: Record<string, "highest" | "high" | "must_apply"> = {
  "microsoft": "highest", "amazon": "highest", "google": "highest", "apple": "highest",
  "meta": "highest", "oracle": "highest", "intel": "highest", "cisco": "highest", "ibm": "highest",
  "salesforce": "highest", "walmart": "highest", "jpmorgan": "highest", "goldman sachs": "highest",
  "morgan stanley": "highest", "bank of america": "highest", "wells fargo": "highest",
  "capital one": "highest", "target": "highest", "home depot": "highest",
  "lowe's": "highest", "lowes": "highest", "costco": "highest",
  "unitedhealth": "highest", "elevance": "highest", "cvs": "highest",
  "nvidia": "high", "databricks": "high", "snowflake": "high", "hashicorp": "high",
  "cloudflare": "high", "mongodb": "high", "confluent": "high", "servicenow": "high",
  "workday": "high", "atlassian": "high", "sap": "high", "adobe": "high",
  "t-mobile": "high", "at&t": "high", "verizon": "high", "s&p": "high", "sp global": "high",
  "cigna": "must_apply", "openai": "must_apply", "anthropic": "must_apply",
  "accenture": "must_apply", "cognizant": "must_apply", "infosys": "must_apply",
  "tata consultancy": "must_apply", "tcs": "must_apply", "capgemini": "must_apply",
  "paypal": "must_apply", "visa": "must_apply", "mastercard": "must_apply",
  "stripe": "must_apply", "ups": "must_apply", "fedex": "must_apply",
};

export function getPriorityTier(company: string): "highest" | "high" | "must_apply" | undefined {
  const lc = company.toLowerCase();
  for (const [key, tier] of Object.entries(PRIORITY_MAP)) {
    if (lc === key || lc.includes(key)) return tier;
  }
  return undefined;
}

export function cleanDescription(html: string): string {
  return html
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function formatPostedDate(ts: number): string {
  const diff = Date.now() - ts * 1000;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const SKILL_KEYWORDS = [
  "React", "Next.js", "Vue", "TypeScript", "JavaScript", "Angular",
  "Python", "Java", "Go", "Golang", "Rust", "Swift", "Kotlin", "Scala", "PHP", "Ruby", "C++", "C#",
  "Spring Boot", "Node.js", "Django", "FastAPI", "Express", "Flask",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Linux", "Ansible", "Helm",
  "PostgreSQL", "MongoDB", "Redis", "Elasticsearch", "MySQL", "SQL", "NoSQL", "Cassandra", "DynamoDB",
  "GraphQL", "Kafka", "RabbitMQ", "Spark", "Flink", "Airflow",
  "CI/CD", "Jenkins", "GitHub Actions", "ArgoCD",
  "Microservices", "DevOps", "SRE", "DataDog", "Prometheus", "Grafana",
];

const BASE_RESUME_TEXT = [
  "React Angular TypeScript JavaScript CSS3 React Hooks",
  "Java Spring Boot Spring MVC Spring Security REST Microservices Hibernate OAuth JWT",
  "AWS EC2 ECS EKS S3 RDS Lambda API Gateway IAM VPC Docker Kubernetes CI/CD Jenkins GitLab Maven",
  "Kafka SNS SQS PostgreSQL MySQL Oracle MongoDB Redis",
  "JUnit Mockito Selenium Splunk Dynatrace Kibana CloudWatch",
  "Agile Scrum Jira Git Python GitHub",
].join(" ");

export function extractMissingSkills(description: string): string[] {
  return SKILL_KEYWORDS.filter(skill => {
    const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return regex.test(description) && !regex.test(BASE_RESUME_TEXT);
  }).slice(0, 6);
}

export function detectSponsorship(description: string): "mentioned" | "not_mentioned" {
  const pos = ["visa sponsorship", "h-1b", "h1b", "work authorization", "will sponsor", "opt", "cpt"];
  const neg = ["no sponsorship", "will not sponsor", "cannot sponsor", "sponsorship not available", "without sponsorship"];
  const dl = description.toLowerCase();
  if (neg.some(k => dl.includes(k))) return "not_mentioned";
  if (pos.some(k => dl.includes(k))) return "mentioned";
  return "not_mentioned";
}

export function extractExperience(description: string): string {
  const m =
    description.match(/(\d+)\+?\s*(?:to|-)\s*\d+\s*years?\s*(?:of\s*)?(?:relevant\s*)?(?:experience|exp)/i) ||
    description.match(/(\d+)\+\s*years?\s*(?:of\s*)?(?:experience|exp)/i) ||
    description.match(/(?:at\s+least|minimum(?:\s+of)?)\s+(\d+)\s*years?\s*(?:of\s*)?(?:experience|exp)/i) ||
    description.match(/(\d+)\s*years?\s*(?:of\s*)?(?:experience|exp)/i);
  if (!m) return "";
  const y = parseInt(m[1]);
  if (y <= 1) return "0-1yr";
  if (y <= 3) return "1-3yr";
  if (y <= 6) return "4-6yr";
  return "6+yr";
}

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
  "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
]);

// 2-letter country codes that are definitively non-US.
// Excludes ambiguous codes that also happen to be US state abbreviations
// (AR/Arkansas/Argentina, CO/Colorado/Colombia, IN/Indiana/India,
//  IL/Illinois/Israel, CA/California/Canada). Those are handled
// contextually below.
const NON_US_COUNTRY_CODES_STRICT = new Set([
  "AE","AT","AU","BE","BR","BG","CH","CL","CN","CY","CZ","DE","DK","EG","ES",
  "EE","FI","FR","GB","GR","HK","HR","HU","IE","IT","JP","KE","KR","LT","LU",
  "LV","MT","MX","MY","NG","NL","NO","NZ","PE","PH","PL","PT","RO","RU","SA",
  "SE","SG","SI","SK","TH","TR","TW","UA","UK","VN","ZA",
]);

// Non-US place names. Entries starting with "\\b" use word-boundary matching
// to avoid false positives (e.g. "india" inside "Indiana"). Plain entries
// use substring matching (safe for multi-word names like "tel aviv").
const NON_US_PLACE_PATTERNS: RegExp[] = [
  "canada","united kingdom","\\bscotland\\b","\\bwales\\b","ireland","dublin",
  "\\blondon\\b","germany","berlin","\\bmunich\\b","\\bfrance\\b","\\bparis\\b",
  "\\bspain\\b","madrid","barcelona","\\bitaly\\b","\\brome\\b","\\bmilan\\b",
  "netherlands","amsterdam","belgium","switzerland","zurich","austria","vienna",
  "sweden","stockholm","norway","oslo","denmark","copenhagen","finland",
  "helsinki","poland","warsaw","czech","prague","portugal","lisbon",
  "\\bgreece\\b","athens","romania","bucharest","hungary","budapest","israel",
  "tel aviv","herzliya","jerusalem","\\bjapan\\b","\\btokyo\\b","\\bosaka\\b",
  "\\bchina\\b","beijing","shanghai","hong kong","singapore","\\bkorea\\b",
  "\\bseoul\\b","taiwan","taipei","malaysia","kuala lumpur","thailand","bangkok",
  "philippines","manila","vietnam","hanoi","ho chi minh","\\bindia\\b",
  "hyderabad","bengaluru","bangalore","chennai","mumbai","\\bpune\\b",
  "\\bdelhi\\b","\\bnoida\\b","gurgaon","gurugram","kolkata","ahmedabad",
  "australia","\\bsydney\\b","melbourne","\\bperth\\b","brisbane","new zealand",
  "auckland","\\bbrazil\\b","sao paulo","são paulo","rio de janeiro",
  "\\bmexico\\b","argentina","buenos aires","\\bchile\\b","santiago",
  "\\bperu\\b","\\blima\\b","colombia","bogota","south africa","cape town",
  "johannesburg","nigeria","lagos","\\begypt\\b","\\bcairo\\b","\\bdubai\\b",
  "abu dhabi","riyadh","saudi arabia","\\bqatar\\b","\\bdoha\\b","turkey",
  "istanbul","\\brussia\\b","\\bmoscow\\b","ukraine","\\bkyiv\\b",
  "vancouver","toronto","montreal","\\bottawa\\b","calgary","edmonton",
  "winnipeg","halifax",
].map(p => {
  if (p.includes("\\b")) return new RegExp(p, "i");
  return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
});

const US_STATE_NAMES_LC = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut",
  "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa",
  "kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan",
  "minnesota","mississippi","missouri","montana","nebraska","nevada",
  "new hampshire","new jersey","new mexico","new york","north carolina",
  "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
  "south carolina","south dakota","tennessee","texas","utah","vermont",
  "virginia","washington","west virginia","wisconsin","wyoming",
  "district of columbia",
]);

const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR",
]);

/**
 * Determine whether a job location string is United States.
 * Ordered, terminating rules. Ambiguous 2-letter codes (AR, CO, IN, IL, CA)
 * are resolved by context: if the segment before the code is also 2 letters,
 * the last is the country; otherwise the last is a US state.
 *
 * Test-covered cases (53 total, 100% passing):
 *   US:     "Redmond, WA, US" · "San Francisco, CA" · "Bentonville, AR" ·
 *           "US, CA, Santa Clara" · "RI - Woonsocket" · "(USA) ..." ·
 *           "Indiana - Indianapolis" · "California - San Francisco" ·
 *           "7000 Target Pkwy,MN 55445"
 *   Non-US: "Vancouver, BC, CA" · "Hyderabad, TS, IN" · "Barcelona, CT, ES" ·
 *           "Herzliya, Tel Aviv District, IL" · "IN KA BANGALORE Home Office" ·
 *           "Peru - Remote" · "Tokyo, JP" · "Dublin, Ireland"
 */
export function isUSLocation(location: string): boolean {
  if (!location || !location.trim()) return true;
  const trimmed = location.trim();
  const lc = trimmed.toLowerCase();

  // 1. Pure remote / worldwide → allow
  if (lc === "remote" || lc === "anywhere" || lc === "worldwide" || lc === "multiple locations") return true;

  // 2. Explicit US markers → allow
  if (/\bunited states\b/.test(lc)) return true;
  if (/\busa\b/.test(lc) || /\(usa\)/.test(lc)) return true;
  if (/,\s*us\s*$/.test(lc) || /\bus\s*-/.test(lc) || lc.startsWith("us,") || lc.startsWith("us ")) return true;

  // 3. Explicit non-US country / city names → reject (word-bounded where needed)
  for (const rx of NON_US_PLACE_PATTERNS) {
    if (rx.test(lc)) return false;
  }

  // 4. Walmart-style "IN KA BANGALORE ..." prefix
  const startMatch = trimmed.match(/^([A-Z]{2})\s+([A-Z]{2})\s+/);
  if (startMatch) {
    const country = startMatch[1];
    if (country !== "US" && !US_STATE_CODES.has(country) && NON_US_COUNTRY_CODES_STRICT.has(country)) return false;
    // Ambiguous leading code (IN for India or Indiana) — skip, fall through
  }

  // 5. Last-segment analysis: "City, State[, Country]"
  const segments = trimmed.split(",").map(s => s.trim()).filter(Boolean);
  if (segments.length >= 1) {
    const last = segments[segments.length - 1];
    const prev = segments.length >= 2 ? segments[segments.length - 2] : "";

    if (/^[A-Z]{2}$/.test(last)) {
      if (last === "US") return true;
      // Strong country signal: prev is also 2-letter → last is definitely a country
      if (/^[A-Z]{2}$/.test(prev)) return false; // last !== "US" already handled
      // Prefer US state interpretation for ambiguous codes (CA, AR, CO, IN, IL, etc.)
      if (US_STATE_CODES.has(last)) return true;
      if (NON_US_COUNTRY_CODES_STRICT.has(last)) return false;
      // Unknown 2-letter last — reject
      return false;
    }

    const lastLc = last.toLowerCase();
    if (US_STATE_NAMES_LC.has(lastLc)) return true;
  }

  // 6. Fallback: any US state code or full state name as a standalone token
  const tokens = trimmed.split(/[\s,\-]+/).filter(Boolean);
  for (const t of tokens) {
    if (US_STATE_CODES.has(t)) return true;
    if (US_STATE_NAMES_LC.has(t.toLowerCase())) return true;
  }

  // 7. No US signal anywhere → reject
  return false;
}

// ── Early-filter helpers (workflow spec §5) ───────────────────────────────
// Lightweight title pre-filter run IMMEDIATELY after fetch — BEFORE any other
// filtering / normalization / dedupe. Drops obvious junk before it touches
// the rest of the pipeline. Used as a fast pre-screen before the strict
// shouldIncludeTitle below.
// Broad keyword match, case-insensitive. Returns true on ANY keyword hit.
const EARLY_TITLE_KEYWORDS = [
  "software", "engineer", "developer", "backend", "java", "full stack", "fullstack", "full-stack",
];
export function isRelevantTitleEarly(title: string): boolean {
  if (!title) return false;
  const tl = title.toLowerCase();
  for (const kw of EARLY_TITLE_KEYWORDS) {
    if (tl.includes(kw)) return true;
  }
  return false;
}

// ── Strict title filter (used by ingest pipeline + Tier A scrapers) ──────
// Single source of truth for "is this a SWE-IC role we want?"
// Promoted from app/api/jobs/refresh/route.ts (2026-04-17) so playwright
// scrapers can apply the SAME strict filter inside their per-company cap
// — otherwise the 80-job cap is wasted on titles that get dropped later.
//
// Strategy:
//   1. Hard-exclude list checked FIRST — always wins
//   2. Include list checked second — must match at least one term
//   3. Default = exclude
//
// INCLUDE terms are intentionally broad single/double words so titles like
// "Java Engineer", "Sr. Software Eng", "Cloud Infrastructure Engineer" all pass.

export const INCLUDE_KEYWORDS = [
  // Core SWE
  "software engineer", "software developer", "software eng",
  // Specialisations
  "backend engineer", "backend developer",
  "frontend engineer", "frontend developer",
  "front end engineer", "front end developer",  // 2026-04-17: catch space-separated variant (CVS uses "Senior Front End Engineer")
  "full stack", "fullstack", "full-stack",
  "cloud engineer", "devops engineer", "platform engineer",
  "site reliability", "sre",
  "distributed systems",
  "application engineer", "application developer",
  "web developer", "product engineer",
  "api engineer", "integration engineer",
  // SWE-IC architect titles — non-SWE architects already excluded below
  "application architect",  // covers "Backend Application Architect", "Cloud Application Architect"
  "backend architect",
  "frontend architect",
  // Language-named engineer/developer roles
  "python engineer", "python developer",
  "java engineer",   "java developer",
  "golang engineer", "go engineer",
  "ruby engineer",   "ruby developer",
  "scala engineer",  "scala developer",
  "kotlin engineer", "kotlin developer",
  "ios engineer",    "ios developer",
  "android engineer","android developer",
  "ui engineer",     "ui developer",
  // Infrastructure / data engineering
  "data engineer",
  "systems engineer",    // "Systems Engineer, Backend" etc.
  "infrastructure engineer",
  "reliability engineer",
  // QA / test engineering
  "qa engineer", "quality engineer", "test engineer", "automation engineer",
];

// Single-word qualifiers: if the title contains one of these AND also contains
// "engineer" or "developer", include it even without an exact phrase match.
// Examples: "Kafka Engineer", "React Developer", "Spark Engineer"
export const INCLUDE_TECH_WORDS = [
  "software", "backend", "frontend", "cloud", "devops", "platform",
  "data", "infrastructure", "reliability", "distributed",
  "java", "python", "golang", "go", "ruby", "scala", "kotlin",
  "ios", "android", "react", "node", "typescript", "javascript",
  "spark", "kafka", "kubernetes", "aws", "azure", "gcp",
  "mobile", "embedded", "firmware",
];

// EXCLUDE: checked BEFORE includes — always wins
export const EXCLUDE_SUBSTRINGS = [
  // Seniority tiers to exclude (per spec)
  "principal",   // kills "Principal Software Engineer"
  "staff",       // kills "Staff Software Engineer"
  "lead",        // kills "Lead Software Engineer", "Tech Lead"
  // Specific non-SWE architect variants (bare "architect" was too broad)
  "solutions architect", "solution architect", "software architect",
  "enterprise architect", "systems architect", "data architect",
  "cloud architect", "technical architect", "information architect",
  // Management / non-IC
  "manager", "director", "vice president", "head of", "chief",
  "intern", "internship",
  // Language-specific we don't target
  ".net developer", "dotnet", "c# developer",
  // Research / clearance
  "research scientist",
  // Non-SWE tech
  "security engineer", "cybersecurity", "network engineer",
  // Business / process
  "business analyst", "scrum master", "project manager",
  "recruiter", "marketing engineer",
  // Junk roles from retail / ops / physical
  "technician", "mechanic", "electrician", "machinist",
  "warehouse", "retail associate", "store associate",
  "robotics engineer", "controls engineer",
  "mechanical engineer", "electrical engineer", "civil engineer",
  "nurse", "pharmacist", "physician", "therapist",
  "sales representative", "account executive", "account manager",
  "data center technician", "field technician", "field service",
  "customer service", "customer support",
];

// Whole-word excludes (regex \b...\b)
export const EXCLUDE_WHOLE_WORDS = ["ml", "vp"];

export function shouldIncludeTitle(title: string): boolean {
  const tl = title.toLowerCase();
  // 1. Hard excludes always win
  for (const kw of EXCLUDE_SUBSTRINGS)  { if (tl.includes(kw))                     return false; }
  for (const kw of EXCLUDE_WHOLE_WORDS) { if (new RegExp(`\\b${kw}\\b`).test(tl)) return false; }
  // 2. Direct phrase match
  if (INCLUDE_KEYWORDS.some(kw => tl.includes(kw))) return true;
  // 3. Broad fallback: title contains "engineer" or "developer" + a tech qualifier
  const hasEngineerOrDev = tl.includes("engineer") || tl.includes("developer");
  if (hasEngineerOrDev && INCLUDE_TECH_WORDS.some(w => tl.includes(w))) return true;
  return false;
}

// Date horizons
// Full workflow (site scrapers): 25 days — stop pagination when oldest job
// on a page crosses this threshold (spec §4).
// Partial workflow (Adzuna Targeted): 30 days — preserved per user directive.
export const EARLY_HORIZON_DAYS_FULL    = 25;
export const EARLY_HORIZON_DAYS_PARTIAL = 30;

export function isWithinEarlyHorizon(isoDate: string | null, days: number): boolean {
  if (!isoDate) return true; // unknown date → don't drop prematurely; downstream horizon decides
  const t = new Date(isoDate).getTime();
  if (isNaN(t)) return true;
  return Date.now() - t <= days * 86_400_000;
}


// ── Company-name canonicalization ──────────────────────────────────────────
// Different job sources return the same company under different display
// names (Adzuna gives "Fidelity" while the job board convention is
// "Fidelity Investments"; Oracle HCM gives "JPMorganChase" without a space;
// Adzuna also gives "Citi" / "Wells Fargo Bank" / "The Cigna Group" /
// "MasterCard" / "Apple Inc." / "Salesforce, Inc." / etc.).
// Without normalization the board fragments into multiple entries per
// company. Map is lowercase-keyed; unmatched inputs are returned as-is.
const COMPANY_CANONICAL_MAP: Record<string, string> = {
  // Adzuna abbreviations / variants
  "fidelity":            "Fidelity Investments",
  "citi":                "Citigroup",
  "wells fargo bank":    "Wells Fargo",
  "the cigna group":     "Cigna Group",
  // Oracle HCM no-space variant
  "jpmorganchase":       "JPMorgan Chase",
  // Case fixes (toLowerCase keys mean these handle ALL case variants of the input)
  "mastercard":          "Mastercard",     // covers "MasterCard"
  "mongodb":             "MongoDB",        // covers "Mongodb"
  "gusto":               "Gusto",          // covers "gusto"
  // Legal-suffix strips
  "salesforce, inc.":    "Salesforce",
  "salesforce, inc":     "Salesforce",
  "salesforce inc":      "Salesforce",
  "servicenow, inc.":    "ServiceNow",
  "servicenow, inc":     "ServiceNow",
  "servicenow inc":      "ServiceNow",
  "apple inc.":          "Apple",
  "apple inc":           "Apple",
};

export function normalizeCompany(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  return COMPANY_CANONICAL_MAP[trimmed.toLowerCase()] ?? trimmed;
}

// ── Quality buckets (spec §19) ───────────────────────────────────────────────────
// hot      → score >= 22  (very recent + high title relevance + Tier A company)
// strong   → score >= 12
// possible → everything else
//
// Ranking signals (spec §19):
//   recency, title relevance, sponsorship score, company priority, source quality

export type QualityBucket = "hot" | "strong" | "possible";

export function computeJobScore(params: {
  title:           string;
  description:     string;
  postedTimestamp: number;
  sourceType:      string;
  company:         string;
}): { score: number; bucket: QualityBucket } {
  const { title, description, postedTimestamp, sourceType, company } = params;
  let score = 0;

  // ── Title relevance (weight x3) ───────────────────────────────
  const tl = title.toLowerCase();
  const TITLE_SCORES: Record<string, number> = {
    "software engineer": 10, "software developer": 10,
    "backend engineer": 9,   "backend developer": 9,
    "full stack engineer": 9, "fullstack engineer": 9,
    "python developer": 8,   "java developer": 8,
    "frontend engineer": 8,  "cloud engineer": 7,
    "platform engineer": 7,  "devops engineer": 6,
    "site reliability engineer": 6, "sre": 6,
  };
  let titleScore = 3; // default
  for (const [term, s] of Object.entries(TITLE_SCORES)) {
    if (tl.includes(term)) { titleScore = s; break; }
  }
  score += titleScore * 3;

  // ── Sponsorship signal ────────────────────────────────────────
  const dl = description.toLowerCase();
  const SPONSOR_POS = ["visa sponsorship","h-1b","h1b","will sponsor","opt","cpt"];
  const SPONSOR_NEG = ["no sponsorship","will not sponsor","cannot sponsor","without sponsorship"];
  if (SPONSOR_NEG.some(k => dl.includes(k)))      score -= 20;
  else if (SPONSOR_POS.some(k => dl.includes(k))) score += 15;

  // ── Recency ───────────────────────────────────────────────
  if (postedTimestamp) {
    const ageDays = (Date.now() - postedTimestamp * 1000) / 86_400_000;
    if      (ageDays <= 1)  score += 10;
    else if (ageDays <= 7)  score += 7;
    else if (ageDays <= 30) score += 3;
  }

  // ── Company priority tier ─────────────────────────────────
  const tier = getPriorityTier(company);
  if      (tier === "highest")    score += 5;
  else if (tier === "high")       score += 3;
  else if (tier === "must_apply") score += 2;

  // ── Source quality ───────────────────────────────────────
  const srcLower = sourceType.toLowerCase();
  if (srcLower.startsWith("playwright"))                      score += 4; // Tier A = premium
  else if (srcLower === "greenhouse" || srcLower === "workday") score += 3;
  else if (srcLower === "jsearch"    || srcLower === "adzuna")  score += 1;

  // ── Bucket assignment ─────────────────────────────────────
  const bucket: QualityBucket =
    score >= 22 ? "hot" :
    score >= 12 ? "strong" : "possible";

  return { score, bucket };
}

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

export function isUSLocation(location: string): boolean {
  if (!location) return true;
  const loc = location.toLowerCase();
  if (loc.includes("remote") || loc.includes("anywhere") || loc.includes("worldwide")) return true;
  if (loc.includes("united states") || loc.includes(", us") || loc.includes(", usa")) return true;
  const parts = location.split(/[,\s]+/);
  return parts.some(p => US_STATES.has(p.trim()) || US_STATES.has(p.trim().toUpperCase()));
}

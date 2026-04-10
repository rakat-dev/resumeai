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
  source: string;
  skills: string[];
}

// Uses JSearch API on RapidAPI — free tier: 200 req/month
// Sign up at https://rapidapi.com/letscrape-6bRB4TkqmJD/api/jsearch
async function fetchFromJSearch(query: string, filter: JobFilter): Promise<Job[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("RAPIDAPI_KEY not set");

  const datePostedMap: Record<JobFilter, string> = {
    "24h": "today",
    "7d":  "week",
    "30d": "month",
    "any": "",
  };
  const datePosted = datePostedMap[filter];

  const params = new URLSearchParams({
    query,
    page: "1",
    num_pages: "2",
    ...(datePosted && { date_posted: datePosted }),
  });

  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    },
    next: { revalidate: 300 }, // cache 5 min
  });

  if (!res.ok) throw new Error(`JSearch API error: ${res.status}`);
  const data = await res.json();

  return (data.data || []).map((j: Record<string, unknown>, i: number): Job => ({
    id: (j.job_id as string) || String(i),
    title: (j.job_title as string) || "",
    company: (j.employer_name as string) || "",
    location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || "Remote",
    type: (j.job_employment_type as string) || "Full-time",
    salary: j.job_min_salary
      ? `$${Math.round(Number(j.job_min_salary) / 1000)}k–$${Math.round(Number(j.job_max_salary) / 1000)}k`
      : undefined,
    description: (j.job_description as string)?.slice(0, 600) || "",
    applyUrl: (j.job_apply_link as string) || "#",
    postedAt: (j.job_posted_at_datetime_utc as string) || "",
    postedDate: (j.job_posted_at_timestamp as number)
      ? formatPostedDate(j.job_posted_at_timestamp as number)
      : "Recently",
    source: (j.job_publisher as string) || "Job Board",
    skills: extractSkills((j.job_description as string) || ""),
  }));
}

function formatPostedDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp * 1000;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

const SKILL_KEYWORDS = [
  "React","Next.js","TypeScript","JavaScript","Python","Java","Spring Boot","Node.js",
  "AWS","Azure","GCP","Docker","Kubernetes","PostgreSQL","MongoDB","Redis","GraphQL",
  "REST","Microservices","CI/CD","Git","Agile","Scrum","Go","Rust","Swift","Kotlin",
  "Angular","Vue","Django","FastAPI","Terraform","Linux","SQL","NoSQL","Machine Learning",
  "AI","LLM","TensorFlow","PyTorch","Kafka","Spark","Hadoop","Elasticsearch",
];

function extractSkills(description: string): string[] {
  return SKILL_KEYWORDS.filter(skill =>
    new RegExp(`\\b${skill.replace(".", "\\.")}\\b`, "i").test(description)
  ).slice(0, 6);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "";
  const filter = (searchParams.get("filter") as JobFilter) || "any";

  if (!query.trim()) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  try {
    const jobs = await fetchFromJSearch(query, filter);
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Jobs API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

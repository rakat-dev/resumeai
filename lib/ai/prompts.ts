// v2 (2026-04-25): section-aware prompt construction, structured trim,
// sponsorship safety appendix, JD-length confidence tiers (lib/ai/enrich-job.ts).
// Bump invalidates the cache key + makes existing enrichments stale on the
// re-enrich eligibility check in app/api/jobs/enrich/route.ts.
export const PROMPT_VERSION = process.env.AI_PROMPT_VERSION ?? "v2";

export const SYSTEM_PROMPT_BASE = `You are a job-ingestion enrichment service.

Rules:
1. Output must strictly match the provided JSON schema.
2. Do not include markdown.
3. Do not include extra keys.
4. Do not invent facts not present in the input.
5. If evidence is missing, use null, 'unknown', or 'unclear' exactly as allowed by schema.
6. Hard source-of-truth fields such as title, URL, requisition ID, company, country, posted date, and description are owned by the deterministic adapter and must not be altered.
7. Prefer conservative classification over aggressive guessing.
8. Reasons and warnings must be short, concrete, and based only on evidence in the input.
9. If a field is ambiguous, reflect that in confidence and warnings.`;

export const NORMALIZATION_PROMPT = `Task: Normalize and classify a fetched job posting.

Return only structured data for:
- normalizedTitle
- roleFamily
- seniority
- skills
- relatedTitleMatches
- sponsorshipSignal
- remoteType
- confidence
- warnings

Classification rules:
- roleFamily must be one of: backend, frontend, fullstack, data, platform, devops, mobile, ml, security, qa, unknown
- seniority must be one of: intern, junior, mid, senior, staff, principal, manager, unknown
- sponsorshipSignal must be one of: explicit_yes, explicit_no, unclear
- remoteType must be one of: remote, hybrid, onsite, unclear

Important:
- Keep normalizedTitle close to the source title unless there is strong evidence for a clearer standard title.
- Only include skills that are explicitly present or strongly evidenced by the title/description.
- relatedTitleMatches should contain search-friendly related role labels.
- Do not infer sponsorship from company reputation alone.
- Do not infer remote type unless stated or clearly implied.

Input job:
{{RAW_JOB_JSON}}`;

export const RELEVANCE_PROMPT = `Task: Decide whether this job should be included for software-engineer-related search results.

Target scope:
- software engineer, backend engineer, frontend engineer, full stack engineer
- platform engineer, distributed systems engineer, developer tools engineer
- infrastructure software engineer, data platform engineer, applied software roles

Usually exclude:
- retail store roles, warehouse roles, pure analyst roles
- HR / legal / finance non-software roles
- hardware-only roles unless the description shows strong software engineering ownership

Output: include, relevanceScore, reasons, warnings

Scoring:
- 90-100 = strong direct software role
- 70-89 = related and likely relevant
- 50-69 = borderline but potentially useful
- below 50 = likely irrelevant

Be cautious about false negatives. If software evidence exists, lean toward inclusion.

Input:
{{RAW_JOB_JSON}}
{{NORMALIZATION_JSON}}`;

export const FIT_SCORE_PROMPT = `Task: Score job fit for this candidate profile.

Candidate profile:
- Senior Software Engineer / Backend Engineer / Full Stack Engineer
- Strongest alignment: Java, Spring Boot, React, microservices, REST APIs, distributed systems, cloud, CI/CD
- Also relevant: platform engineering, Kafka, Spark, scalable backend systems, developer productivity platforms
- Prefer software-heavy roles in the US

Output: fitScore, reasons, missingSignals, confidence

Scoring guidance:
- 85-100 = excellent fit
- 70-84 = strong fit
- 55-69 = decent fit but not ideal
- below 55 = weak fit

Rules:
- Base the score on evidence, not optimism.
- MissingSignals should reflect missing technical alignment or unclear requirements.
- Do not penalize merely because every preferred skill is not listed.

Input:
{{RAW_JOB_JSON}}
{{NORMALIZATION_JSON}}`;

export const DEDUPE_PROMPT = `Task: Compare two job records and decide whether they represent the same underlying job.

This is only for ambiguous cases after deterministic dedupe has already run.

Consider: requisition ID similarity, title similarity, team similarity, location similarity, canonical URL clues, description overlap, posted timing, company match.

Do not force a merge if evidence is weak.

Output: sameJob, confidence, reasons

Input job A:
{{JOB_A_JSON}}

Input job B:
{{JOB_B_JSON}}`;

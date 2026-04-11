import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ATSResult {
  score: number;
  matched: string[];
  missing: string[];
  suggestions: string[];
}

export async function POST(req: NextRequest) {
  try {
    const { resume, jobDescription, jobTitle, company } = await req.json();

    if (!resume || !jobDescription) {
      return NextResponse.json({ error: "resume and jobDescription are required" }, { status: 400 });
    }

    // Step 1: Smart tailoring with deep JD analysis
    const tailorMsg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: `You are a world-class ATS resume strategist with 15+ years placing candidates at top companies.

Your 3-step tailoring process:

STEP 1 - ANALYZE THE JD:
- Extract REQUIRED skills, tools, qualifications
- Extract PREFERRED/bonus skills  
- Identify the top 3 priorities of the role
- Note exact phrases and buzzwords the hiring team uses

STEP 2 - GAP ANALYSIS:
- Compare candidate experience against required and preferred skills
- Identify which JD keywords are missing from the resume
- Identify which existing resume content is most relevant to this role

STEP 3 - PRECISION REWRITE:
- Summary: Rewrite using the JD's exact vocabulary and top 3 priorities
- Skills: Reorder to put JD-matching skills first
- Experience: Reorder bullets to lead with most JD-relevant accomplishments, reframe using JD language where accurate
- Never invent skills or experience not in the base resume
- Every word must serve ATS matching or demonstrate relevant impact

Return ONLY the tailored resume text. No preamble, no commentary, no markdown.`,
      messages: [{
        role: "user",
        content: `ROLE: ${jobTitle || "Position"} at ${company || "Company"}

JOB DESCRIPTION:
${jobDescription}

BASE RESUME:
${resume}

Return the complete tailored resume only.`
      }],
    });

    const tailored = tailorMsg.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => b.text || "")
      .join("\n").trim();

    // Step 2: ATS scoring
    const scoreMsg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      system: `You are an ATS analyzer. Analyze resume vs job description match. Return ONLY raw JSON, no markdown, no explanation.`,
      messages: [{
        role: "user",
        content: `JOB DESCRIPTION:
${jobDescription}

TAILORED RESUME:
${tailored}

Return this exact JSON (raw, no markdown):
{
  "score": <number 0-100>,
  "matched": [<up to 10 key JD terms found in resume>],
  "missing": [<up to 8 important JD terms NOT in resume>],
  "suggestions": [<3 specific actionable improvements>]
}`
      }],
    });

    const scoreRaw = scoreMsg.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => b.text || "")
      .join("").trim();

    let ats: ATSResult = { score: 0, matched: [], missing: [], suggestions: [] };
    try {
      const start = scoreRaw.indexOf("{");
      const end = scoreRaw.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        ats = JSON.parse(scoreRaw.slice(start, end + 1));
      }
    } catch {
      // keep default
    }

    return NextResponse.json({ tailored, ats });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Tailor API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { resume, jobDescription, jobTitle, company } = await req.json();

    if (!resume || !jobDescription) {
      return NextResponse.json({ error: "resume and jobDescription are required" }, { status: 400 });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: `You are an expert ATS resume writer with 10+ years of experience.
Your task is to tailor a resume for a specific job description.

Rules:
- Keep ALL facts accurate — never invent experience, skills, or credentials
- Rewrite the professional summary to directly mirror the JD's language and priorities
- Reorder experience bullets to lead with the most relevant accomplishments first
- Weave in key terms from the JD naturally for ATS keyword matching
- Emphasize technologies and skills that appear in the JD
- Keep the same overall structure and sections
- Return ONLY the tailored resume text — no preamble, no commentary, no markdown headers`,

      messages: [{
        role: "user",
        content: `Please tailor this resume for the following job.

JOB: ${jobTitle || "Role"} at ${company || "Company"}

JOB DESCRIPTION:
${jobDescription}

BASE RESUME:
${resume}

Return the complete tailored resume text only.`
      }],
    });

    const tailored = message.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    return NextResponse.json({ tailored });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Tailor API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

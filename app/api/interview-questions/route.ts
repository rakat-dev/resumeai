import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface InterviewQuestion {
  id: number;
  category: "behavioral" | "technical" | "situational" | "role-specific";
  question: string;
  why: string;
  suggestedAnswer: string;
  keyPoints: string[];
}

export interface InterviewQuestionsResult {
  questions: InterviewQuestion[];
  topTips: string[];
}

export async function POST(req: NextRequest) {
  try {
    const { tailoredResume, jobDescription, jobTitle, company } = await req.json();

    if (!tailoredResume || !jobDescription) {
      return NextResponse.json(
        { error: "tailoredResume and jobDescription are required" },
        { status: 400 }
      );
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      system: `You are a senior technical interviewer and career coach with 15+ years placing engineers at top companies like Amazon, JPMorgan, and Bank of America.

Your job: analyze a job description and a candidate's tailored resume, then predict the 8-10 most likely interview questions with personalized suggested answers.

ALWAYS respond with ONLY valid JSON in this exact structure — no markdown, no preamble:
{
  "questions": [
    {
      "id": 1,
      "category": "behavioral" | "technical" | "situational" | "role-specific",
      "question": "The exact interview question",
      "why": "1 sentence: why interviewers ask this for this specific role",
      "suggestedAnswer": "A 3-5 sentence suggested answer personalized to the candidate's resume. Use STAR format for behavioral. Be specific — reference actual technologies, companies, or projects from their resume.",
      "keyPoints": ["3-4 bullet points of key things to mention in the answer"]
    }
  ],
  "topTips": [
    "3 short interview tips specific to this role/company"
  ]
}

Rules:
- Mix question types: 3-4 behavioral, 2-3 technical/role-specific, 1-2 situational
- Personalize suggested answers using actual details from the resume (company names, tech stack, project outcomes)
- For banking/fintech roles: include at least one question about compliance, risk, or scale
- For senior roles: include at least one leadership/mentoring question
- keyPoints should be 5-10 words each, punchy and memorable
- topTips should be specific to this company/role, not generic advice`,
      messages: [
        {
          role: "user",
          content: `Job Title: ${jobTitle || "Not specified"}
Company: ${company || "Not specified"}

JOB DESCRIPTION:
${jobDescription}

CANDIDATE'S TAILORED RESUME:
${tailoredResume}

Generate 8-10 predicted interview questions with personalized suggested answers.`,
        },
      ],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const clean = raw.replace(/```json|```/g, "").trim();

    let result: InterviewQuestionsResult;
    try {
      result = JSON.parse(clean);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response", raw },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Interview questions error:", error);
    return NextResponse.json(
      { error: "Failed to generate interview questions" },
      { status: 500 }
    );
  }
}

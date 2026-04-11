import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ATSResult } from "@/app/api/tailor/route";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { resume, suggestions, jobDescription } = await req.json();
    if (!resume || !suggestions || !jobDescription) {
      return NextResponse.json({ error: "resume, suggestions and jobDescription are required" }, { status: 400 });
    }

    const improveMsg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: `You are an expert ATS resume writer. Apply ALL provided suggestions into the resume naturally.
Rules:
- Apply every suggestion — do not skip any
- Keep all facts accurate — never invent experience
- Weave missing keywords naturally into existing bullets or summary
- Do not add new fake jobs or credentials
- Return ONLY the improved resume text, no commentary`,
      messages: [{
        role: "user",
        content: `JOB DESCRIPTION:\n${jobDescription}\n\nCURRENT RESUME:\n${resume}\n\nSUGGESTIONS TO APPLY:\n${suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}\n\nReturn the improved resume only.`
      }]
    });

    const improved = improveMsg.content
      .filter((b: {type:string}) => b.type === "text")
      .map((b: {type:string;text?:string}) => b.text || "")
      .join("\n").trim();

    const scoreMsg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      system: `You are an ATS analyzer. Return ONLY raw JSON, no markdown.`,
      messages: [{
        role: "user",
        content: `JOB DESCRIPTION:\n${jobDescription}\n\nRESUME:\n${improved}\n\nReturn this JSON:\n{"score":<0-100>,"matched":[<up to 10 matched terms>],"missing":[<up to 8 missing terms>],"suggestions":[<3 improvements>]}`
      }]
    });

    const scoreRaw = scoreMsg.content.filter((b:{type:string}) => b.type === "text").map((b:{type:string;text?:string}) => b.text||"").join("").trim();
    let ats: ATSResult = { score: 0, matched: [], missing: [], suggestions: [] };
    try {
      const s = scoreRaw.indexOf("{"), e = scoreRaw.lastIndexOf("}");
      if (s !== -1 && e !== -1) ats = JSON.parse(scoreRaw.slice(s, e + 1));
    } catch { /**/ }

    return NextResponse.json({ improved, ats });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

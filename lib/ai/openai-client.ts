if (typeof window !== "undefined") {
  throw new Error("openai-client must only be imported server-side");
}

import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

interface CallResult {
  content: string;
  usage: { input: number; output: number; total: number };
}

interface CallOpts {
  model?: string;
  maxTokens?: number;
  retries?: number;
}

export async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  opts: CallOpts = {}
): Promise<CallResult> {
  const model = opts.model ?? process.env.AI_MODEL_DEFAULT ?? "gpt-4o-mini";
  const maxTokens = opts.maxTokens ?? 500;
  const maxRetries = opts.retries ?? Number(process.env.AI_RETRY_COUNT ?? 1);
  const client = getOpenAIClient();

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
    try {
      const res = await client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      const content = res.choices[0]?.message?.content ?? "{}";
      const usage = {
        input:  res.usage?.prompt_tokens     ?? 0,
        output: res.usage?.completion_tokens ?? 0,
        total:  res.usage?.total_tokens      ?? 0,
      };
      return { content, usage };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

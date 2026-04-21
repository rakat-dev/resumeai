import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

interface CallResult {
  content: string;
  usage: { input: number; output: number; total: number };
  error?: "rate_limited";
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
  const client = getOpenAIClient();
  if (!client) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const model = opts.model ?? process.env.AI_MODEL_DEFAULT ?? "gpt-4o-mini";
  const maxTokens = opts.maxTokens ?? 500;
  const maxRetries = opts.retries ?? Number(process.env.AI_RETRY_COUNT ?? 2);

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
  const isRateLimit = (
    lastError instanceof Error && (
      (lastError as unknown as { status?: number }).status === 429 ||
      lastError.message.toLowerCase().includes("rate limit") ||
      lastError.message.includes("429")
    )
  );
  if (isRateLimit) {
    return { content: "", usage: { input: 0, output: 0, total: 0 }, error: "rate_limited" };
  }
  throw lastError;
}

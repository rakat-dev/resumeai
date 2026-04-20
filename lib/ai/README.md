# AI Layer

OpenAI-powered enrichment layer for job aggregation. All AI is additive and feature-flagged. The app works normally with `AI_ENABLED=false`.

## Modules

| File | Description |
|------|-------------|
| `types.ts` | TypeScript interfaces: `RoleFamily`, `Seniority`, `AiEnrichment`, `AiMeta`, `EnrichedJob`, `AiBatchStats`, and more |
| `schemas.ts` | Strict Zod schemas for all enrichment response shapes — used to validate OpenAI output |
| `prompts.ts` | Versioned prompt constants (`NORMALIZATION_PROMPT`, `RELEVANCE_PROMPT`, `FIT_SCORE_PROMPT`, `DEDUPE_PROMPT`) |
| `openai-client.ts` | Server-side-only singleton OpenAI client; `callOpenAI` with retry/backoff, returns `{content, usage}` |
| `enrich-job.ts` | Single-job enrichment: feature flag check → 7-day in-memory cache → normalization → relevance → fit score |
| `enrich-batch.ts` | Concurrent batch enrichment with budget cap (`AI_MAX_JOBS_PER_REFRESH`) and stats logging |
| `score-job.ts` | Fit scoring via `FIT_SCORE_PROMPT`; returns `FitScoreResult | null`; never throws |
| `dedupe-assist.ts` | AI-assisted deduplication — disabled by default (`AI_DEDUPE_ASSIST_ENABLED=true` to activate) |
| `fallback-recovery.ts` | Emergency fallback scaffold — disabled by default, always non-authoritative, not in normal flow |
| `__tests__/ai-layer.test.ts` | Vitest test suite — 12 tests covering schemas, enrichJob, enrichBatch, dedupeAssist, type shape |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Required for AI features |
| `AI_ENABLED` | `true` | Master switch — set `false` to disable all AI |
| `AI_ENRICHMENT_ENABLED` | `true` | Enable normalization + relevance + fit scoring |
| `AI_DEDUPE_ASSIST_ENABLED` | `false` | AI deduplication (off by default) |
| `AI_FALLBACK_ENABLED` | `false` | Fallback recovery scaffold (off by default) |
| `AI_MODEL_DEFAULT` | `gpt-4o-mini` | OpenAI model to use |
| `AI_MAX_JOBS_PER_REFRESH` | `100` | Budget cap per refresh cycle |
| `AI_MAX_JOBS_PER_SEARCH` | `50` | Budget cap per search request |
| `AI_MAX_CONCURRENCY` | `3` | Concurrent OpenAI calls in enrichBatch |
| `AI_TIMEOUT_MS` | `12000` | Per-call timeout (ms) |
| `AI_RETRY_COUNT` | `1` | Retry attempts on transient failure |
| `AI_PROMPT_VERSION` | `v1` | Prompt version — part of cache key |

## Feature Flags

| Flag | Default | Effect |
|------|---------|--------|
| `AI_ENABLED=false` | — | Disables all AI; app works normally, enrichJob returns `status="skipped"` |
| `AI_ENRICHMENT_ENABLED=false` | — | Skips normalization/relevance/fit scoring only |
| `AI_DEDUPE_ASSIST_ENABLED=true` | — | Activates AI deduplication in `dedupeAssist` |
| `AI_FALLBACK_ENABLED=true` | — | Activates fallback recovery (stub, not yet implemented) |

## Enrichment Pipeline (per job)

```
enrichJob(job)
  ├── 1. Cache lookup (in-memory, 7d TTL)
  ├── 2. Feature flag check (isAiEnabled)
  ├── 3. Normalization prompt → JobNormalizationSchema validation
  ├── 4. Relevance prompt → RelevanceSchema validation
  ├── 5. Fit score prompt → FitScoreSchema validation
  └── Returns EnrichedJob { ai: AiEnrichment | null, aiMeta: AiMeta }
```

## Preservation Guarantees

- AI enrichment is additive only — raw fields (`title`, `url`, `id`, `company`, `postedAt`) are owned by the deterministic adapter and are never modified.
- `AiEnrichment` contains only derived fields; it never includes `id`, `source`, `url`, or `postedAt`.
- All AI calls are wrapped in try/catch — a failure returns `status: "failed"` with `ai: null`, never throws.
- Walmart v2 (`walmart_cxs`) and Amazon v2 (`amazon_jobs`) fetch logic is untouched by this layer.

## Adapter Integration Contract

To plug a new stable adapter into the AI layer: ensure it returns jobs with fields:
`company`, `id`/`url`, `title`, `location`, `description`, `employmentType`.
Then include it in the `enrichBatch` call in the refresh route's post-fetch enrichment block:

```ts
.filter(j => j.source === "walmart_cxs" || j.source === "amazon_jobs" || j.source === "your_new_source")
```

## Running Tests

```bash
npm test
```

# AI Layer

OpenAI-powered enrichment layer for job aggregation. All AI is additive and feature-flagged.

## Modules

| File | Description |
|------|-------------|
| `types.ts` | TypeScript interfaces and type aliases |
| `schemas.ts` | Zod validation schemas |
| `prompts.ts` | Versioned prompt constants |
| `openai-client.ts` | Server-side OpenAI client wrapper with retry |
| `enrich-job.ts` | Single-job normalization + relevance enrichment |
| `enrich-batch.ts` | Concurrent batch enrichment with budget cap |
| `score-job.ts` | Fit scoring against candidate profile |
| `dedupe-assist.ts` | AI-assisted deduplication (disabled by default) |
| `fallback-recovery.ts` | Emergency fallback (disabled by default) |

## Environment Variables

```
OPENAI_API_KEY=              # Required for AI features
AI_ENABLED=true              # Master switch
AI_ENRICHMENT_ENABLED=true   # Enable normalization + relevance
AI_DEDUPE_ASSIST_ENABLED=false  # AI dedupe (off by default)
AI_FALLBACK_ENABLED=false    # Fallback recovery (off by default)
AI_MODEL_DEFAULT=gpt-4o-mini # OpenAI model
AI_MAX_JOBS_PER_REFRESH=100  # Budget cap per refresh cycle
AI_MAX_JOBS_PER_SEARCH=50    # Budget cap per search
AI_MAX_CONCURRENCY=3         # Concurrent OpenAI calls
AI_TIMEOUT_MS=12000          # Per-call timeout
AI_RETRY_COUNT=1             # Retry attempts on failure
AI_PROMPT_VERSION=v1         # Cache key component
```

## Feature Flags

- Set `AI_ENABLED=false` to disable all AI — app works normally.
- Set `AI_ENRICHMENT_ENABLED=false` to skip normalization/relevance only.
- Set `AI_DEDUPE_ASSIST_ENABLED=true` to activate AI deduplication.
- Set `AI_FALLBACK_ENABLED=true` to activate emergency fallback (not yet implemented).

## Adapter Integration Contract

To plug a new stable adapter into the AI layer: ensure it returns jobs with fields:
`company`, `id`/`url`, `title`, `location`, `description`, `employmentType`.
Then include it in the `enrichBatch` call in the refresh route's post-fetch enrichment block.

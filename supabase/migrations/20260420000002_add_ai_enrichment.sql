-- Migration 20260420000002: AI enrichment columns
--
-- ai_enrichment: stores the full AiEnrichment object (normalizedTitle,
--   roleFamily, seniority, skills, fitScore, relevanceScore, etc.)
-- ai_meta: stores enrichment metadata (promptVersion, latencyMs, status,
--   tokenUsage, cacheKey, etc.)
-- Both are nullable so rows without AI enrichment remain valid.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ai_enrichment JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ai_meta       JSONB;

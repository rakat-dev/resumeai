import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobNormalizationSchema, RelevanceSchema, FitScoreSchema, DedupeSchema } from "../schemas";
import { buildCacheKey, enrichJob } from "../enrich-job";
import { dedupeAssist } from "../dedupe-assist";
import { enrichBatch } from "../enrich-batch";
import type { AiEnrichment } from "../types";

// Mock the OpenAI client so no real HTTP calls are made
vi.mock("../openai-client", () => ({
  callOpenAI: vi.fn(),
  getOpenAIClient: vi.fn(),
}));

// Mock score-job to isolate enrichJob from cascading OpenAI calls
vi.mock("../score-job", () => ({
  scoreJobFit: vi.fn().mockResolvedValue(null),
}));

describe("AI Layer — Unit Tests", () => {
  // 1. JobNormalizationSchema valid input passes
  it("1. JobNormalizationSchema accepts valid input", () => {
    const result = JobNormalizationSchema.safeParse({
      normalizedTitle: "Backend Software Engineer",
      roleFamily: "backend",
      seniority: "senior",
      skills: ["Java", "Spring Boot"],
      relatedTitleMatches: ["Software Engineer", "Backend Developer"],
      sponsorshipSignal: "unclear",
      remoteType: "hybrid",
      confidence: 0.9,
      warnings: [],
    });
    expect(result.success).toBe(true);
  });

  // 2. JobNormalizationSchema invalid roleFamily fails
  it("2. JobNormalizationSchema rejects invalid roleFamily", () => {
    const result = JobNormalizationSchema.safeParse({
      normalizedTitle: "Engineer",
      roleFamily: "wizard",
      seniority: "senior",
      skills: [],
      relatedTitleMatches: [],
      sponsorshipSignal: "unclear",
      remoteType: "unclear",
      confidence: 0.5,
      warnings: [],
    });
    expect(result.success).toBe(false);
  });

  // 3. RelevanceSchema valid input passes
  it("3. RelevanceSchema accepts valid input", () => {
    const result = RelevanceSchema.safeParse({
      include: true,
      relevanceScore: 85,
      reasons: ["Strong software role"],
      warnings: [],
    });
    expect(result.success).toBe(true);
  });

  // 4. FitScoreSchema valid input passes
  it("4. FitScoreSchema accepts valid input", () => {
    const result = FitScoreSchema.safeParse({
      fitScore: 78,
      reasons: ["Matches Java background"],
      missingSignals: ["Kubernetes not mentioned"],
      confidence: 0.85,
    });
    expect(result.success).toBe(true);
  });

  // 5. DedupeSchema valid input passes
  it("5. DedupeSchema accepts valid input", () => {
    const result = DedupeSchema.safeParse({
      sameJob: false,
      confidence: 0.3,
      reasons: ["Different requisition IDs"],
    });
    expect(result.success).toBe(true);
  });

  // 6. DedupeSchema out-of-range confidence fails
  it("6. DedupeSchema rejects confidence > 1", () => {
    const result = DedupeSchema.safeParse({
      sameJob: true,
      confidence: 1.5,
      reasons: [],
    });
    expect(result.success).toBe(false);
  });

  // 7. enrichJob returns status=skipped when AI_ENABLED=false
  it("7. enrichJob returns skipped when AI_ENABLED=false", async () => {
    const prev = process.env.AI_ENABLED;
    process.env.AI_ENABLED = "false";
    try {
      const result = await enrichJob({
        company: "TestCo",
        id: `skip-test-${Date.now()}`,
        title: "Software Engineer",
        location: "Remote",
        description: "Build backend services with Java",
      });
      expect(result.aiMeta.status).toBe("skipped");
      expect(result.ai).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = prev;
    }
  });

  // 8. enrichJob handles callOpenAI throwing gracefully
  it("8. enrichJob handles callOpenAI error gracefully", async () => {
    const { callOpenAI } = await import("../openai-client");
    vi.mocked(callOpenAI).mockRejectedValueOnce(new Error("network timeout"));

    const prevEnabled = process.env.AI_ENABLED;
    const prevEnrich = process.env.AI_ENRICHMENT_ENABLED;
    process.env.AI_ENABLED = "true";
    process.env.AI_ENRICHMENT_ENABLED = "true";
    try {
      const result = await enrichJob({
        company: "TestCo",
        id: `throw-test-${Date.now()}`,
        title: "Backend Engineer",
        location: "Austin, TX",
        description: "Build microservices with Java and Spring Boot",
      });
      expect(result.aiMeta.status).toBe("failed");
      expect(result.ai).toBeNull();
    } finally {
      if (prevEnabled === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = prevEnabled;
      if (prevEnrich === undefined) delete process.env.AI_ENRICHMENT_ENABLED;
      else process.env.AI_ENRICHMENT_ENABLED = prevEnrich;
    }
  });

  // 9. dedupeAssist returns null when AI_DEDUPE_ASSIST_ENABLED is not true
  it("9. dedupeAssist returns null when AI_DEDUPE_ASSIST_ENABLED is not set", async () => {
    const prev = process.env.AI_DEDUPE_ASSIST_ENABLED;
    delete process.env.AI_DEDUPE_ASSIST_ENABLED;
    try {
      const result = await dedupeAssist(
        { title: "Software Engineer A", company: "Acme" },
        { title: "Software Engineer B", company: "Acme" },
      );
      expect(result).toBeNull();
    } finally {
      if (prev !== undefined) process.env.AI_DEDUPE_ASSIST_ENABLED = prev;
    }
  });

  // 10. buildCacheKey produces same key for identical inputs
  it("10. buildCacheKey is deterministic for same inputs", () => {
    const job = {
      company: "Acme",
      id: "req-123",
      title: "Software Engineer",
      location: "Austin, TX",
      description: "Build APIs with Java",
    };
    expect(buildCacheKey(job)).toBe(buildCacheKey({ ...job }));
    expect(buildCacheKey({ ...job, id: "req-456" })).not.toBe(buildCacheKey(job));
  });

  // 11. enrichBatch respects maxJobs budget cap — stats.skipped > 0 when over limit
  it("11. enrichBatch skips jobs beyond maxJobs budget cap", async () => {
    const prev = process.env.AI_ENABLED;
    process.env.AI_ENABLED = "false";
    try {
      const jobs = Array.from({ length: 10 }, (_, i) => ({
        company: "Acme",
        id: `batch-job-${i}`,
        title: "Engineer",
        location: "Remote",
        description: "desc",
      }));
      const { stats } = await enrichBatch(jobs, { maxJobs: 3 });
      expect(stats.totalJobs).toBe(10);
      // 7 jobs are beyond the cap
      expect(stats.skipped).toBeGreaterThanOrEqual(7);
    } finally {
      if (prev === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = prev;
    }
  });

  // 12. AiEnrichment has no raw source fields (id/source/url/postedAt)
  it("12. AiEnrichment object has no raw fields (id, source, url, postedAt)", () => {
    const enrichment: AiEnrichment = {
      version: "v1",
      normalizedTitle: "Engineer",
      roleFamily: "backend",
      seniority: "senior",
      skills: [],
      relatedTitleMatches: [],
      sponsorshipSignal: "unclear",
      remoteType: "remote",
      relevanceScore: 80,
      fitScore: 75,
      confidence: 0.9,
      summary: "Strong backend role",
      reasons: [],
      warnings: [],
      enrichedAt: new Date().toISOString(),
      sourceModel: "gpt-4o-mini",
    };
    expect("id" in enrichment).toBe(false);
    expect("source" in enrichment).toBe(false);
    expect("url" in enrichment).toBe(false);
    expect("postedAt" in enrichment).toBe(false);
  });
});

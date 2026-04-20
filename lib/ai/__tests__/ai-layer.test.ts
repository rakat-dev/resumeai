import { describe, it, expect, vi, afterEach } from "vitest";
import { ZodError } from "zod";

// Mock openai-client so no real network calls are made in tests
vi.mock("../openai-client", () => ({
  callOpenAI: vi.fn().mockRejectedValue(new Error("mocked: no API key in tests")),
  getOpenAIClient: vi.fn(),
}));

import { JobNormalizationSchema, RelevanceSchema, FitScoreSchema, DedupeSchema } from "../schemas";
import { enrichJob, buildCacheKey } from "../enrich-job";
import { enrichBatch } from "../enrich-batch";
import { dedupeAssist } from "../dedupe-assist";
import type { AiEnrichment } from "../types";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI layer", () => {
  // 1. JobNormalizationSchema valid parse
  it("1. JobNormalizationSchema.parse with valid data passes", () => {
    expect(() =>
      JobNormalizationSchema.parse({
        normalizedTitle: "Senior Software Engineer",
        roleFamily: "backend",
        seniority: "senior",
        skills: ["Java", "Spring Boot"],
        relatedTitleMatches: ["Backend Engineer"],
        sponsorshipSignal: "unclear",
        remoteType: "hybrid",
        confidence: 0.9,
        warnings: [],
      })
    ).not.toThrow();
  });

  // 2. Invalid roleFamily throws ZodError
  it('2. JobNormalizationSchema.parse with roleFamily "wizard" throws ZodError', () => {
    expect(() =>
      JobNormalizationSchema.parse({
        normalizedTitle: null,
        roleFamily: "wizard",
        seniority: "mid",
        skills: [],
        relatedTitleMatches: [],
        sponsorshipSignal: "unclear",
        remoteType: "unclear",
        confidence: 0.5,
        warnings: [],
      })
    ).toThrow(ZodError);
  });

  // 3. RelevanceSchema valid parse
  it("3. RelevanceSchema.parse with valid data passes", () => {
    expect(() =>
      RelevanceSchema.parse({
        include: true,
        relevanceScore: 85,
        reasons: ["core SWE role"],
        warnings: [],
      })
    ).not.toThrow();
  });

  // 4. FitScoreSchema rejects fitScore out of range
  it("4. FitScoreSchema.parse with fitScore=150 throws", () => {
    expect(() =>
      FitScoreSchema.parse({
        fitScore: 150,
        reasons: [],
        missingSignals: [],
        confidence: 0.8,
      })
    ).toThrow(ZodError);
  });

  // 5. DedupeSchema rejects confidence out of range
  it("5. DedupeSchema.parse with confidence=1.5 throws", () => {
    expect(() =>
      DedupeSchema.parse({
        sameJob: false,
        confidence: 1.5,
        reasons: [],
      })
    ).toThrow(ZodError);
  });

  // 6. enrichJob with AI_ENABLED=false returns skipped
  it('6. enrichJob with AI_ENABLED=false returns aiMeta.status === "skipped"', async () => {
    vi.stubEnv("AI_ENABLED", "false");
    const result = await enrichJob({
      company: "Acme",
      title: "Software Engineer",
      location: "United States",
      description: "Build systems at scale.",
    });
    expect(result.aiMeta.status).toBe("skipped");
    expect(result.ai).toBeNull();
  });

  // 7. buildCacheKey is deterministic for same inputs
  it("7. buildCacheKey same inputs return identical strings", () => {
    const job = {
      company: "Meta",
      id: "job-42",
      title: "Staff Engineer",
      location: "Menlo Park, CA",
      description: "Build the metaverse.",
    };
    const key1 = buildCacheKey(job);
    const key2 = buildCacheKey({ ...job });
    expect(key1).toBe(key2);
    expect(typeof key1).toBe("string");
    expect(key1.length).toBeGreaterThan(0);
  });

  // 8. enrichBatch with 5 jobs and maxJobs=2 skips 3 due to budget cap
  it("8. enrichBatch with 5 jobs and maxJobs=2 — stats.skipped === 3", async () => {
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_ENRICHMENT_ENABLED", "true");
    const jobs = Array.from({ length: 5 }, (_, i) => ({
      company: "Corp",
      id: `batch-test-job-${i}`,
      title: `Engineer ${i}`,
      location: "United States",
      description: `Job description ${i}`,
    }));
    const { stats } = await enrichBatch(jobs, { maxJobs: 2 });
    expect(stats.totalJobs).toBe(5);
    expect(stats.skipped).toBe(3);
  });

  // 9. dedupeAssist returns null when flag not set
  it("9. dedupeAssist without AI_DEDUPE_ASSIST_ENABLED returns null", async () => {
    const result = await dedupeAssist(
      { id: "job-a", title: "SWE", company: "FAANG" },
      { id: "job-b", title: "SWE", company: "FAANG" }
    );
    expect(result).toBeNull();
  });

  // 10. AiEnrichment type has no raw adapter fields
  it("10. AiEnrichment shape has no id, source, url, or postedAt fields", () => {
    type HasId      = "id"      extends keyof AiEnrichment ? true : false;
    type HasSource  = "source"  extends keyof AiEnrichment ? true : false;
    type HasUrl     = "url"     extends keyof AiEnrichment ? true : false;
    type HasPostedAt = "postedAt" extends keyof AiEnrichment ? true : false;

    const id_absent:       HasId      = false;
    const source_absent:   HasSource  = false;
    const url_absent:      HasUrl     = false;
    const postedAt_absent: HasPostedAt = false;

    expect(id_absent).toBe(false);
    expect(source_absent).toBe(false);
    expect(url_absent).toBe(false);
    expect(postedAt_absent).toBe(false);
  });
});

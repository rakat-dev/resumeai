export type RoleFamily = "backend" | "frontend" | "fullstack" | "data" | "platform" | "devops" | "mobile" | "ml" | "security" | "qa" | "unknown";
export type Seniority = "intern" | "junior" | "mid" | "senior" | "staff" | "principal" | "manager" | "unknown";
export type SponsorshipSignal = "explicit_yes" | "explicit_no" | "unclear";
export type RemoteType = "remote" | "hybrid" | "onsite" | "unclear";
export type AiStatus = "success" | "failed" | "cached" | "skipped";

export interface JobNormalization {
  normalizedTitle: string | null;
  roleFamily: RoleFamily;
  seniority: Seniority;
  skills: string[];
  relatedTitleMatches: string[];
  sponsorshipSignal: SponsorshipSignal;
  remoteType: RemoteType;
  confidence: number;
  warnings: string[];
}

export interface RelevanceResult {
  include: boolean;
  relevanceScore: number;
  reasons: string[];
  warnings: string[];
}

export interface FitScoreResult {
  fitScore: number;
  reasons: string[];
  missingSignals: string[];
  confidence: number;
}

export interface DedupeResult {
  sameJob: boolean;
  confidence: number;
  reasons: string[];
}

export interface AiEnrichment {
  version: string;
  normalizedTitle: string | null;
  roleFamily: RoleFamily;
  seniority: Seniority;
  skills: string[];
  relatedTitleMatches: string[];
  sponsorshipSignal: SponsorshipSignal;
  remoteType: RemoteType;
  relevanceScore: number;
  fitScore: number;
  confidence: number;
  summary: string;
  reasons: string[];
  warnings: string[];
  enrichedAt: string;
  sourceModel: string;
}

export interface AiMeta {
  cacheKey: string;
  promptVersion: string;
  rawHash: string;
  latencyMs: number;
  status: AiStatus;
  tokenUsage?: { input: number; output: number; total: number };
  error?: string;
}

export interface EnrichedJob {
  ai: AiEnrichment | null;
  aiMeta: AiMeta;
}

export interface AiBatchStats {
  totalJobs: number;
  enriched: number;
  cacheHits: number;
  failed: number;
  skipped: number;
  totalLatencyMs: number;
  totalTokens: number;
}

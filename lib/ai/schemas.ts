import { z } from "zod";

const RoleFamilyEnum = z.enum(["backend","frontend","fullstack","data","platform","devops","mobile","ml","security","qa","unknown"]);
const SeniorityEnum = z.enum(["intern","junior","mid","senior","staff","principal","manager","unknown"]);
const SponsorshipEnum = z.enum(["explicit_yes","explicit_no","unclear"]);
const RemoteTypeEnum = z.enum(["remote","hybrid","onsite","unclear"]);

export const JobNormalizationSchema = z.object({
  normalizedTitle: z.string().nullable(),
  roleFamily: RoleFamilyEnum,
  seniority: SeniorityEnum,
  skills: z.array(z.string()),
  relatedTitleMatches: z.array(z.string()),
  sponsorshipSignal: SponsorshipEnum,
  remoteType: RemoteTypeEnum,
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
}).strict();

export const RelevanceSchema = z.object({
  include: z.boolean(),
  relevanceScore: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
}).strict();

export const FitScoreSchema = z.object({
  fitScore: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  missingSignals: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}).strict();

export const DedupeSchema = z.object({
  sameJob: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
}).strict();

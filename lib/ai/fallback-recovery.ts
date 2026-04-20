export interface FallbackRecoveryResult {
  recovered: boolean;
  jobs: unknown[];
  nonAuthoritative: true;
  reason: string;
}

interface FallbackContext {
  lastKnownCount?: number;
  errorReason?: string;
}

export async function attemptFallbackRecovery(
  company: string,
  context: FallbackContext = {}
): Promise<FallbackRecoveryResult> {
  if (process.env.AI_FALLBACK_ENABLED !== "true") {
    return { recovered: false, jobs: [], nonAuthoritative: true, reason: "AI_FALLBACK_ENABLED is not set" };
  }

  console.warn(
    `[AI fallback] WARNING: output is NON-AUTHORITATIVE. company=${company}`,
    `lastKnownCount=${context.lastKnownCount ?? "unknown"}`,
    `errorReason=${context.errorReason ?? "unknown"}`
  );

  // Stub — full implementation is future work. This scaffold is never part of
  // the normal Walmart/Amazon ingest flow.
  return { recovered: false, jobs: [], nonAuthoritative: true, reason: "not_implemented" };
}

import type { AtsType } from "./companyAtsRegistry";

// ── ATS Detection from URL ─────────────────────────────────────────────────
// Used to verify or auto-detect ATS from a careers page URL.
// Does NOT replace the registry — the registry is authoritative.
// Use this only when you have a URL and need to confirm ATS type.

export function detectAts(url: string): AtsType {
  const u = url.toLowerCase();

  if (u.includes("myworkdayjobs"))   return "workday";
  if (u.includes("oraclecloud"))     return "oracle_hcm";
  if (u.includes("greenhouse"))      return "greenhouse";
  if (u.includes("lever.co"))        return "lever";
  if (u.includes("ashbyhq"))         return "ashby";
  if (u.includes("taleo"))           return "taleo";
  if (u.includes("brassring"))       return "brassring";
  if (u.includes("eightfold"))       return "eightfold";
  if (u.includes("successfactors"))  return "successfactors";
  if (u.includes("icims"))           return "icims";

  return "custom";
}

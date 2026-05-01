# Location Normalization Design Proposal

**Status:** Design only — NOT implemented  
**Author:** ResumeAI pipeline  
**Date:** 2026-04-30  
**Requires approval before any implementation**

---

## Problem

`isUSLocation()` in `lib/jobUtils.ts` uses substring matching on a raw location string.
This works well for `"Seattle, WA"` but fails on two distinct failure modes:

| Failure mode | Examples | Current behavior | Impact |
|---|---|---|---|
| Work-arrangement strings | `"Hybrid"`, `"In-Office"`, `"Distributed"` | Drop (no US signal) | Cloudflare (GH) loses 445/447 jobs |
| Multi-location placeholder | `"2 Locations"`, `"4 Locations"` | Drop (no US signal) | Zendesk loses 116/128 jobs |
| Explicit non-US | `"Pune, India"`, `"Copenhagen, Denmark"` | Drop (correct) | None — working as intended |

The goal is to handle these WITHOUT:
- Weakening US-only enforcement
- Whitelisting specific companies
- Making `"Hybrid"` automatically pass

---

## Proposed Function

### Name
```typescript
normalizeLocationClass(raw: string): LocationClass
```

### Input / Output Shape

```typescript
type LocationClass =
  | "definite_us"      // Strong US signal — pass
  | "definite_non_us"  // Strong non-US signal — reject
  | "ambiguous"        // Weak or mixed signal — reject unless metadata available
  | "unusable";        // No geographic information at all — reject

interface LocationNormResult {
  classification: LocationClass;
  confidence:     "high" | "low";
  matched_signal: string | null;  // which pattern matched
  raw:            string;
}
```

### Enforcement Rule (STRICT)
- `definite_us` → **pass**
- `definite_non_us` → **reject**
- `ambiguous` → **reject** (not promoted to pass automatically)
- `unusable` → **reject** unless source provides structured country metadata separately

---

## Classification Examples Table

| Input string | Classification | Confidence | Reason |
|---|---|---|---|
| `"Seattle (WA)"` | `definite_us` | high | State abbreviation in parens |
| `"San Jose (CA)"` | `definite_us` | high | State abbreviation in parens |
| `"New York City"` | `definite_us` | high | Known US city |
| `"Remote US"` | `definite_us` | high | "US" suffix after "Remote" |
| `"Remote (US)"` | `definite_us` | high | "(US)" qualifier |
| `"Remote - US"` | `definite_us` | high | "- US" qualifier |
| `"Remote in US"` | `definite_us` | high | "in US" qualifier |
| `"United States"` | `definite_us` | high | Full country name |
| `"Austin, TX"` | `definite_us` | high | State code suffix |
| `"Pune, India"` | `definite_non_us` | high | Known non-US country |
| `"Copenhagen, Denmark"` | `definite_non_us` | high | Known non-US country |
| `"London, UK"` | `definite_non_us` | high | Known non-US country |
| `"Bangalore, Karnataka"` | `definite_non_us` | high | Known non-US state/region |
| `"Tokyo, Japan"` | `definite_non_us` | high | Known non-US country |
| `"Remote"` | `ambiguous` | low | No country qualifier — could be anywhere |
| `"Remote - EMEA"` | `definite_non_us` | high | EMEA region explicitly non-US |
| `"Remote - Americas"` | `ambiguous` | low | Americas includes non-US countries |
| `"Hybrid"` | `unusable` | — | Work arrangement only, no geography |
| `"In-Office"` | `unusable` | — | Work arrangement only, no geography |
| `"Distributed"` | `unusable` | — | Work arrangement only, no geography |
| `"2 Locations"` | `unusable` | — | Placeholder, no geography |
| `"4 Locations"` | `unusable` | — | Placeholder, no geography |
| `""` (blank) | `unusable` | — | No data |

---

## Key Design Decisions

### 1. `"Hybrid"` / `"In-Office"` / `"Distributed"` → `unusable`, NOT `ambiguous`

These strings contain **zero geographic signal**. Promoting them to `ambiguous` would invite 
future relaxation ("just pass ambiguous"). They must be `unusable` to make the rejection reason clear:
the data is missing, not uncertain.

### 2. `"Remote"` alone → `ambiguous`, NOT `definite_us`

A bare "Remote" could mean remote from India, Germany, or the US. It must NOT pass 
unless accompanied by a US qualifier. This is intentionally conservative.

### 3. `unusable` without metadata → reject

If a source like Cloudflare/Greenhouse returns `"Hybrid"` for all its jobs, and no separate  
country metadata is available via the detail endpoint, ALL those jobs must be rejected.
The fix is to fetch structured metadata (country field from the detail API), not to relax classification.

### 4. No company-specific rules

The function takes only the raw location string. No company name, no ATS type. 
Global rules only.

---

## Where `isUSLocation` Is Today vs. After

```typescript
// CURRENT (lib/jobUtils.ts) — unchanged by this design
export function isUSLocation(location: string): boolean {
  // substring-based US signal check
}

// PROPOSED ADDITION (separate function, does NOT replace isUSLocation)
export function normalizeLocationClass(raw: string): LocationNormResult {
  // structured classification into definite_us / definite_non_us / ambiguous / unusable
}
```

`isUSLocation` is **not modified**. `normalizeLocationClass` is a new, separate function.  
Adapters that currently pass through `isUSLocation` keep doing so.  
The new function would only be wired in at the adapter level after explicit approval of a
migration plan.

---

## Migration Plan

1. **Add function** — implement `normalizeLocationClass` in `lib/locationNormalization.ts` (new file, not in `jobUtils`)
2. **Add tests** — cover the full examples table above plus edge cases (see Regression Tests section)
3. **Shadow mode** — run both `isUSLocation` and `normalizeLocationClass` in parallel on live data; log disagreements without changing behavior
4. **Review disagreement log** — measure how many jobs currently passing `isUSLocation` would be reclassified, and vice versa
5. **Approval gate** — present disagreement stats before any behavior change
6. **Staged rollout** — enable `normalizeLocationClass` as the gate for one source at a time; verify adapter_kept ≈ final_stored
7. **Structured metadata path** (Zendesk / Cloudflare) — for sources where locationsText is `"N Locations"` or `"Hybrid"`, add optional fallback to a detail-endpoint country field; classify those separately ONLY after explicit approval

---

## Regression Tests Required

All tests must be written before implementation is merged.

| Test | Input | Expected output |
|---|---|---|
| US city + state | `"Seattle (WA)"` | `definite_us` |
| US state code | `"Austin, TX"` | `definite_us` |
| Remote with US qualifier | `"Remote US"` | `definite_us` |
| Remote with paren qualifier | `"Remote (US)"` | `definite_us` |
| Remote with dash qualifier | `"Remote - US"` | `definite_us` |
| Full country name | `"United States"` | `definite_us` |
| India | `"Pune, India"` | `definite_non_us` |
| Europe | `"Copenhagen, Denmark"` | `definite_non_us` |
| EMEA region | `"Remote - EMEA"` | `definite_non_us` |
| Bare remote | `"Remote"` | `ambiguous` |
| Americas region | `"Remote - Americas"` | `ambiguous` |
| Hybrid | `"Hybrid"` | `unusable` |
| In-Office | `"In-Office"` | `unusable` |
| Distributed | `"Distributed"` | `unusable` |
| N Locations | `"2 Locations"` | `unusable` |
| Empty | `""` | `unusable` |
| No false US pass | `"Hampshire, UK"` | `definite_non_us` (not confused by "shire") |
| No false US pass | `"New South Wales, Australia"` | `definite_non_us` |
| Mixed-case | `"remote us"` | `definite_us` |
| Casing | `"HYBRID"` | `unusable` |

**Regression gate:** `isUSLocation` existing behavior must be fully preserved for all inputs
that currently pass through it. Shadow mode disagreement rate must be < 2% before rollout.

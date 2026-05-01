# Date Normalization Design Proposal

**Status:** Design only — NOT implemented  
**Author:** ResumeAI pipeline  
**Date:** 2026-04-30  
**Requires approval before any implementation**

---

## Problem

`parsePostedAt()` in `app/api/jobs/refresh/route.ts` handles a fixed set of date formats.
Baxter (Workday CXS) returned HTTP 200 with 61 jobs, all dropped on date filter because
`postedOn` was present but in a format not handled by the current parser. adapter_kept = 0.

The 14-day freshness rule is correct and must NOT be relaxed. The problem is that the
parser silently treats unparseable dates as "no date", and the pipeline then rejects
no-date jobs (except for the explicitly approved no-date source, Meta). Result: a valid
source with real recent US jobs produces zero yield.

---

## Current Parser (for reference — not modified by this design)

```typescript
// app/api/jobs/refresh/route.ts — parsePostedAt()
function parsePostedAt(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(raw).toISOString();  // ISO
  const hM = raw.match(/(\d+)\s+hour/i);
  const dM = raw.match(/(\d+)\s+day/i);
  const wM = raw.match(/(\d+)\s+week/i);
  const mM = raw.match(/(\d+)\s+month/i);
  if (/today|just now/i.test(raw)) return new Date(now).toISOString();
  if (hM) return new Date(now - +hM[1] * 3_600_000).toISOString();
  if (dM) return new Date(now - +dM[1] * 86_400_000).toISOString();
  if (wM) return new Date(now - +wM[1] * 604_800_000).toISOString();
  if (mM) return new Date(now - +mM[1] * 2_592_000_000).toISOString();
  const p = new Date(raw);
  return isNaN(p.getTime()) ? null : p.toISOString();
}
```

When `parsePostedAt` returns `null`, the pipeline rejects the job (because only Meta is
approved to have `posted_at = null`).

---

## Observed Date Formats (from ATS probes)

| Source | Format example | Parseable by current parser | Classification |
|---|---|---|---|
| Workday CXS (most) | `"2026-04-25T18:00:00.000Z"` | ✅ Yes (ISO) | valid_recent |
| Workday CXS postedOn | `"Posted Today"` | ✅ Yes (today match) | valid_recent |
| Workday CXS postedOn | `"Posted Yesterday"` | ❌ No — not matched | unparseable |
| Workday CXS postedOn | `"Posted 3 Days Ago"` | ✅ Yes (N day) | valid_recent |
| Workday CXS postedOn | `"Posted 30+ Days Ago"` | ❌ No — "30+" not a number | unparseable |
| Workday CXS postedOn | `"Posted about 2 hours ago"` | ✅ Yes (N hour) | valid_recent |
| Workday CXS startDate | `"2026-04-25"` (date only) | ✅ Yes (ISO prefix) | valid_recent |
| Greenhouse | `"2026-04-25T18:00:00.000Z"` | ✅ Yes | valid_recent |
| Baxter WD | Unknown format — all 61 dropped | ❌ Unknown | unparseable |
| Missing | `null` or `""` | N/A | missing |

---

## Proposed Function

### Name
```typescript
parseDateSafe(raw: string | null, sourceHint?: string): DateParseResult
```

### Input / Output Shape

```typescript
type DateClass =
  | "valid_recent"    // Parsed, within 14-day horizon — pass
  | "valid_old"       // Parsed, outside 14-day horizon — reject
  | "missing"         // null/empty input — reject
  | "unparseable";    // Non-null input, no parser matched — reject

interface DateParseResult {
  classification: DateClass;
  iso:            string | null;  // ISO string if parseable, null otherwise
  raw:            string | null;  // original input for logging
  parser_used:    string | null;  // which rule matched (for diagnostics)
}
```

### Enforcement Rule (STRICT)
- `valid_recent` → **pass** to pipeline
- `valid_old` → **reject** (outside 14-day window)
- `missing` → **reject** (no date at all)
- `unparseable` → **reject** AND **log** the raw value for parser gap analysis

The key improvement over the current parser: instead of silently returning `null` for
unparseable inputs (which causes a confusing cascade through no-date rejection logic),
the new function explicitly classifies the reason and logs the raw value.

---

## Source-Specific Parser Registry (Design Only)

Some sources use formats that require explicit registration. The pattern avoids
company-specific hacks by registering at the **format** level:

```typescript
// DESIGN ONLY — not implemented
interface DateParserEntry {
  name:    string;          // human label for diagnostics
  pattern: RegExp;          // matches the raw string
  parse:   (raw: string, now: number) => number | null;  // returns ms epoch or null
}

const DATE_PARSERS: DateParserEntry[] = [
  // Built-in parsers (already covered by current parsePostedAt)
  { name: "iso_full",      pattern: /^\d{4}-\d{2}-\d{2}T/, parse: r => new Date(r).getTime() },
  { name: "iso_date_only", pattern: /^\d{4}-\d{2}-\d{2}$/, parse: r => new Date(r).getTime() },
  { name: "today",         pattern: /^today$|just now/i,   parse: (_, now) => now },
  { name: "n_hours",       pattern: /(\d+)\s+hour/i,       parse: (r, now) => now - +r.match(/(\d+)\s+hour/i)![1] * 3_600_000 },
  { name: "n_days",        pattern: /(\d+)\s+day/i,        parse: (r, now) => now - +r.match(/(\d+)\s+day/i)![1] * 86_400_000 },
  { name: "n_weeks",       pattern: /(\d+)\s+week/i,       parse: (r, now) => now - +r.match(/(\d+)\s+week/i)![1] * 604_800_000 },
  { name: "n_months",      pattern: /(\d+)\s+month/i,      parse: (r, now) => now - +r.match(/(\d+)\s+month/i)![1] * 2_592_000_000 },
  // Gaps identified from probes (would add after approval):
  { name: "yesterday",     pattern: /yesterday/i,           parse: (_, now) => now - 86_400_000 },
  { name: "30_plus_days",  pattern: /30\+\s*days?/i,        parse: (_, now) => now - 31 * 86_400_000 }, // treat as 31d → always old → reject
];
```

**Important:** `"30+ Days Ago"` should parse to > 14 days, making it `valid_old` and
rejecting it — the correct behavior. It is NOT an error; the 14-day rule works as intended.

---

## Date Pattern → Classification Examples Table

| Input | parser_used | iso | Classification | Notes |
|---|---|---|---|---|
| `"2026-04-28T10:00:00Z"` | iso_full | `2026-04-28T10:00:00.000Z` | valid_recent | Standard Workday |
| `"2026-04-28"` | iso_date_only | `2026-04-28T00:00:00.000Z` | valid_recent | Workday startDate |
| `"2026-04-01"` | iso_date_only | `2026-04-01T00:00:00.000Z` | valid_old | Outside 14d |
| `"Posted Today"` | today | now ISO | valid_recent | Workday postedOn |
| `"Posted Yesterday"` | yesterday* | yesterday ISO | valid_recent | *gap in current parser |
| `"Posted 3 Days Ago"` | n_days | 3d ago ISO | valid_recent | Current parser handles |
| `"Posted about 2 hours ago"` | n_hours | 2h ago ISO | valid_recent | Current handles "about" implicitly |
| `"Posted 30+ Days Ago"` | 30_plus_days* | 31d ago ISO | valid_old | *gap; rejection is correct |
| `"Posted 30+ Days Ago"` | *(current)* | `null` | unparseable→rejected | Silent fail today |
| `null` | — | null | missing | No date provided |
| `""` | — | null | missing | Blank |
| `"Baxter format X"` | — | null | unparseable | Logged for analysis |

(*) = not currently implemented, would add only after approval and with regression tests.

---

## Gap Analysis: What Baxter Most Likely Returns

The raw `postedOn` format from Baxter's Workday instance was not captured during the probe
(only the drop count of 61 was recorded). Before implementing any parser:

1. **Capture raw values**: Add a logging pass to record Baxter's actual `postedOn` strings
   to the diagnostics sample store (no behavior change)
2. **Identify the pattern**: Is it `"Posted Yesterday"`, `"30+ Days Ago"`, a locale string,
   or something else entirely?
3. **Decide**: If it's `"Yesterday"` → add `yesterday` parser (trivial, safe).
   If it's a locale string like `"Vor 3 Tagen"` → different problem, may indicate
   wrong locale in the API request.

**Do NOT add a Baxter-specific hack.** Add the parser at the format level if the format
is generic and safe to handle globally.

---

## Migration Plan

1. **Capture step** — add raw `postedOn` logging to the ATS probe diagnostic store (no behavior change)
2. **Identify gaps** — run a one-time probe against Baxter and other blocked sources to capture raw date strings
3. **Design parser additions** — for each identified gap, propose a named parser entry with test cases
4. **Approval gate** — each new parser entry requires explicit approval before merge
5. **Implement `parseDateSafe`** — wrap existing `parsePostedAt` logic, add explicit classification, add logging for `unparseable` cases
6. **Shadow mode** — run both `parsePostedAt` and `parseDateSafe` in parallel; log disagreements without changing behavior
7. **Rollout** — replace `parsePostedAt` calls with `parseDateSafe` one source at a time after shadow-mode review

---

## Regression Tests Required

| Test | Input | Expected classification | Notes |
|---|---|---|---|
| ISO with time | `"2026-04-28T10:00:00Z"` | valid_recent | Core path |
| ISO date only | `"2026-04-28"` | valid_recent | Workday startDate |
| Old ISO | `"2026-04-01"` | valid_old | 27 days ago > 14d |
| "Today" | `"Posted Today"` | valid_recent | |
| "N Days Ago" recent | `"Posted 3 Days Ago"` | valid_recent | |
| "N Days Ago" old | `"Posted 20 Days Ago"` | valid_old | |
| "N Weeks Ago" | `"2 weeks ago"` | valid_old | 14 days exactly = old |
| Null | `null` | missing | |
| Empty string | `""` | missing | |
| Unparseable | `"Freitag, 28 April"` | unparseable | Logs raw value |
| "Yesterday" | `"Posted Yesterday"` | valid_recent | Gap — add after approval |
| "30+ Days" | `"Posted 30+ Days Ago"` | valid_old | Gap — rejection is correct |
| 14-day boundary | exactly 14d ago ISO | valid_old | Boundary is exclusive |

**Regression gate:** `parsePostedAt` existing behavior preserved for all currently-handled
formats. No currently-passing job should be reclassified. Only previously-`null` (unparseable)
outputs may change classification.

// Strip page chrome, embedded analytics scripts, EEO/legal boilerplate, and
// other noise from a job description before it is included in an AI prompt.
//
// Why this exists: scrapers like Amazon's strip <script> *tags* but keep the
// JS *body* as plain text, so JDs in the DB regularly start with Boomerang /
// UE analytics blobs and end with `var CXT = ...; dispatchEvent(...)`. That
// pads each prompt by 5-10KB of garbage that the model has to read.

// ── Prompt assembly budgets ───────────────────────────────────────────────
// Total budget for the description block before fallback head/tail trimming.
const PROMPT_BUDGET_CHARS = 5500;
// `rest` (any prose outside the canonical sections) gets trimmed first.
const REST_TRIM_CHARS = 500;
// `preferredQuals` is nice-to-have detail; trim before falling back.
const PREFERRED_QUALS_TRIM_CHARS = 800;

// Fallback head/tail trim (only if structured trimming can't fit budget).
const FALLBACK_HEAD_CHARS = 3000;
const FALLBACK_TAIL_CHARS = 1500;
const FALLBACK_SEPARATOR = "\n\n[...]\n\n";

// Common JD section openers. Matched as proper headers only — preceded by
// whitespace or start of string, and followed by something header-like (colon,
// whitespace + uppercase letter starting a sentence). This prevents matching
// substrings inside JS object keys like "pageDescription".
const SECTION_OPENERS = [
  "Key job responsibilities",
  "Job responsibilities",
  "About the team",
  "About the role",
  "Position Summary",
  "Job Summary",
  "Job Description",
  "What you'll do",
  "What you will do",
  "Description",
];

// Markers that reliably indicate the JD body is over and analytics / footer
// chrome has begun. We only honor these once we are past at least 500 chars
// of cleaned text — otherwise an early `var CXT` in the page-chrome JS would
// truncate the entire JD to nothing.
const TAIL_NOISE_MARKERS = [
  "var CXT",
  "var pageAnalyticsEvent",
  "window.dispatchEvent",
  "pageAnalyticsEvent =",
  "dispatchEvent(pageAnalyticsEvent)",
  "Similar Jobs",
  "Related Jobs",
  "Recommended Jobs",
  "© 1996",
  "© Amazon",
];

const TAIL_MIN_BODY_CHARS = 500;

// Repeated legal / accommodations / EEO paragraphs. Stripped wholesale —
// they don't help classification and they appear on every Amazon job.
const BOILERPLATE_PATTERNS: RegExp[] = [
  /Amazon is committed to a diverse[\s\S]{0,600}/gi,
  /Amazon is an equal opportunity employer[\s\S]{0,500}/gi,
  /Our inclusive culture empowers Amazonians[\s\S]{0,400}/gi,
  /If you would like to request an accommodation[\s\S]{0,500}/gi,
  /Pursuant to the [\w\s]+?(Fair Chance|Initiative|Act|Ordinance)[\s\S]{0,500}/gi,
  /Please visit https:\/\/amazon\.jobs\/content\/en\/how-we-hire\/accommodations[\s\S]{0,300}/gi,
  /For more information, please visit https:\/\/www\.aboutamazon\.com[\s\S]{0,300}/gi,
];

// Surgical patterns for analytics / tracking JS that scrapers leave behind
// after stripping <script> tags. Order matters: inner blocks first.
function stripJsBlobs(text: string): string {
  let out = text;

  // 1. IIFE wrappers: `!function(...) { ... }(window, document);` or
  //    `(function(){...})(window);`. Bound the inner body to ≤8KB to avoid
  //    catastrophic regex backtracking on adversarial inputs.
  out = out.replace(/!?\(?function\s*\([^)]*\)\s*\{[\s\S]{0,8000}?\}\s*\)?\s*\([^)]*\)\s*[;,]?/g, " ");

  // 2. Function declarations: `function foo(args) { ... }`. Body matched
  //    non-greedily to first balanced `}` heuristic (single-level only).
  out = out.replace(/\bfunction\s+\w+\s*\([^)]*\)\s*\{[^{}]{0,3000}\}/g, " ");

  // 3. `var BOOMR = ...;` / `var CXT = CXT || {...};` / similar single-statement
  //    var/let/const declarations holding object literals or initializers.
  out = out.replace(/\b(?:var|let|const)\s+\w+\s*=\s*[^;]{0,4000};/g, " ");

  // 4. Namespaced assignments: `CXT.X = ...;`, `window.X = ...;`,
  //    `I18n.locale = ...;`, etc. Two or more dotted segments anchors it as
  //    code rather than prose.
  out = out.replace(/\b\w+(?:\.\w+){1,4}\s*=\s*[^;]{0,4000};/g, " ");

  // 5. Namespaced function/method calls: `CXT.ANALYTICS.captureEvent({...});`,
  //    `gtag('js', new Date());`, `window.dispatchEvent(...);`,
  //    `loadChatWidget();`. Two or more dotted segments OR known analytics
  //    bare names.
  out = out.replace(/\b\w+(?:\.\w+){1,4}\s*\([^)]{0,3000}\)\s*;?/g, " ");
  out = out.replace(/\b(gtag|dataLayer|talentbrew_pixel|loadChatWidget|moment)\s*[(.][^;]{0,1000};?/g, " ");

  // 6. jQuery / DOM selectors: `$('#xxx').click(function(){...});`. Match
  //    selector + chained method + whole statement.
  out = out.replace(/\$\([^)]{0,500}\)(?:\.\w+\([^)]{0,2000}\))+\s*;?/g, " ");

  // 7. Control structures with bodies: `if (...) { ... }`, `for (...) { ... }`,
  //    `while (...) { ... }`. Single-level bodies only.
  out = out.replace(/\b(?:if|for|while|switch)\s*\([^)]{0,500}\)\s*\{[^{}]{0,3000}\}/g, " ");

  // 8. Bare `console.log/.warn/.error(...)` calls.
  out = out.replace(/\bconsole\.\w+\s*\([^)]{0,1000}\)\s*;?/g, " ");

  // 9. JSON-shaped object literal residue: `{"key":value, ...}` blocks
  //    longer than 100 chars are almost always config / analytics, never
  //    prose.
  out = out.replace(/\{(?:\s*"[\w-]+"\s*:[^{}]{0,200},?\s*){2,}\}/g, " ");

  // 10. Stranded HTML fragments: opening `<div class="...">` etc. that
  //     survived because their closing `>` was followed by another `<` from
  //     a stripped element.
  out = out.replace(/<\w+[^>]*$/gm, " ");
  out = out.replace(/^[^<]*<\/\w+>/gm, " ");

  return out;
}

// Build a single regex that matches any opener as a real header. Word boundary
// at the start prevents `pageDescription` etc. from matching `Description`.
const OPENER_REGEX = new RegExp(
  `(?:^|[\\s>])(${SECTION_OPENERS
    .map(o => o.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"))
    .join("|")})(?=\\s*[:\\.\\-]|\\s+[A-Z])`,
  "i",
);

export function cleanJobDescription(raw: string): string {
  if (!raw) return "";
  let text = raw;

  // 1. Strip <script>/<style>/<noscript>/<nav>/<header>/<footer> blocks
  //    BEFORE removing tags — otherwise the inner content survives.
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");

  // 2. Strip remaining HTML tags and common entity escapes.
  text = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, " ");

  // 3. Strip surviving JS-code blobs (Amazon analytics, etc.) BEFORE looking
  //    for section headers — otherwise an opener-substring inside JS chrome
  //    would short-circuit the search.
  text = stripJsBlobs(text);

  // 4. Cut leading chrome by slicing from the first real section header.
  //    Triggers whenever an opener is found ≥50 chars in AND the prefix
  //    before it contains JS-shape characters that real JD prose never has
  //    (`{`, `}`, `;`). This catches broken JS fragments like `=0){return}`
  //    that survived stripJsBlobs because their opening `function(...){`
  //    was already gone.
  const openerMatch = OPENER_REGEX.exec(text);
  if (openerMatch && openerMatch.index >= 50) {
    const prefix = text.slice(0, openerMatch.index);
    if (/[{};]/.test(prefix)) {
      text = text.slice(openerMatch.index);
    }
  }

  // 5. Trim trailing chrome at the first analytics/footer marker — but only
  //    if we're past TAIL_MIN_BODY_CHARS of body, so an early `var CXT` in
  //    JS chrome that survived stripJsBlobs doesn't kill the whole JD.
  let cutTail = text.length;
  for (const marker of TAIL_NOISE_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx === -1) continue;
    if (idx >= TAIL_MIN_BODY_CHARS && idx < cutTail) cutTail = idx;
  }
  text = text.slice(0, cutTail);

  // 6. Drop repeated EEO / accommodations / legal paragraphs.
  for (const pattern of BOILERPLATE_PATTERNS) {
    text = text.replace(pattern, " ");
  }

  // 7. Collapse whitespace.
  text = text.replace(/\s+/g, " ").trim();

  // Trimming is no longer done here — the caller runs `parseJobSections` on
  // this output and then `assemblePromptDescription` to do structured trim.
  return text;
}

// ── Section parser ────────────────────────────────────────────────────────
// Splits a cleaned JD into named groups (responsibilities / basicQuals /
// preferredQuals / rest). Headers are matched as proper headings — preceded
// by whitespace, followed by header-style punctuation or a capital letter.
// Multiple headers in the same group are concatenated.

export type SectionGroup = "responsibilities" | "basicQuals" | "preferredQuals";

export interface ParsedSections {
  responsibilities?: string;
  basicQuals?: string;
  preferredQuals?: string;
  rest?: string;
}

interface SectionDef {
  group: SectionGroup;
  patterns: string[];
}

const SECTION_DEFINITIONS: SectionDef[] = [
  {
    group: "responsibilities",
    patterns: [
      "Key job responsibilities",
      "Job responsibilities",
      "Responsibilities",
      "What you'll do",
      "What you will do",
      "About the role",
      "Position Summary",
      "Job Summary",
      "Job Description",
      "Description",
    ],
  },
  {
    group: "basicQuals",
    patterns: [
      "Basic Qualifications",
      "Minimum Qualifications",
      "Required Qualifications",
      "Requirements",
    ],
  },
  {
    group: "preferredQuals",
    patterns: [
      "Preferred Qualifications",
      "Nice to have",
      "Bonus qualifications",
    ],
  },
];

interface HeaderMatch {
  start: number;       // start of header word in source text
  end: number;         // end of header word
  group: SectionGroup;
  name: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function parseJobSections(text: string): ParsedSections {
  if (!text) return {};

  // Build a flat (longest-first) list so "Key job responsibilities" wins
  // over the shorter "Responsibilities" when both could match.
  const allPatterns = SECTION_DEFINITIONS.flatMap(d =>
    d.patterns.map(name => ({ group: d.group, name })),
  ).sort((a, b) => b.name.length - a.name.length);

  const matches: HeaderMatch[] = [];
  const claimed = new Array(text.length).fill(false);

  for (const { group, name } of allPatterns) {
    // Header must be at start, after whitespace, or after `>`; followed by
    // header-style punctuation OR uppercase-starting word OR end.
    const re = new RegExp(
      `(?:^|[\\s>])(${escapeRegex(name)})(?=\\s*[:.\\-]|\\s+[A-Z]|$)`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const headerWordStart = m.index + (m[0].length - m[1].length);
      const headerWordEnd = headerWordStart + m[1].length;
      if (claimed[headerWordStart]) continue;
      for (let i = headerWordStart; i < headerWordEnd; i++) claimed[i] = true;
      matches.push({ start: headerWordStart, end: headerWordEnd, group, name });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  const result: ParsedSections = {};

  if (matches.length === 0) {
    const trimmed = text.trim();
    if (trimmed.length > 0) result.rest = trimmed;
    return result;
  }

  // Anything before the first header → rest
  if (matches[0].start > 0) {
    const pre = text.slice(0, matches[0].start).trim();
    if (pre.length >= 20) result.rest = pre;
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : text.length;
    let body = text.slice(cur.end, nextStart).trim();
    // Drop a leading punctuation char (`:` / `-` / `.`) immediately after the
    // header word so the body reads naturally.
    body = body.replace(/^[:.\-]\s*/, "").trim();
    if (body.length < 5) continue;
    const existing = result[cur.group];
    result[cur.group] = existing ? `${existing} ${body}` : body;
  }

  return result;
}

// ── Sponsorship safety: extract visa / work-auth lines ────────────────────
// These lines must appear at the END of every prompt regardless of trimming.

const SPONSORSHIP_KEYWORDS_RE =
  /\b(?:sponsorship|sponsor|visa|work\s+authorization|H-?1B|OPT|CPT|EAD|STEM\s+OPT)\b/i;

// If a captured sponsorship "sentence" is very long (run-on prose without a
// period between sections), trim it down to a window centered on the keyword.
// Keeps the appended sponsorship block bounded.
const SPONSORSHIP_LINE_MAX_CHARS = 300;

export function extractSponsorshipLines(text: string): string[] {
  if (!text) return [];
  // The cleaner collapses whitespace, so split on sentence-end punctuation
  // (preserving the punctuation in each sentence).
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of sentences) {
    let s = raw.trim();
    if (s.length < 5) continue;
    const m = s.match(SPONSORSHIP_KEYWORDS_RE);
    if (!m || m.index === undefined) continue;
    if (s.length > SPONSORSHIP_LINE_MAX_CHARS) {
      // Window the sentence around the keyword: ~80 chars before, ~220 after.
      const start = Math.max(0, m.index - 80);
      const end = Math.min(s.length, m.index + 220);
      s = (start > 0 ? "…" : "") + s.slice(start, end) + (end < s.length ? "…" : "");
    }
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ── Prompt-description assembler with structured trim ─────────────────────
// Builds the final description text for the AI prompt, in priority order:
//   1. responsibilities / description
//   2. basicQuals
//   3. preferredQuals
//   4. rest
// Followed always by a "Sponsorship / Work Authorization" block built from
// `sponsorshipLines` (so visa info is never lost to trimming).
//
// If total exceeds PROMPT_BUDGET_CHARS, structured trim runs:
//   step 1: trim rest to REST_TRIM_CHARS
//   step 2: drop rest entirely
//   step 3: trim preferredQuals to PREFERRED_QUALS_TRIM_CHARS
//   step 4 (last resort): head(FALLBACK_HEAD_CHARS) + [...] + tail(FALLBACK_TAIL_CHARS)
//                         — sponsorship block still appended at end.
// basicQuals is never removed; sponsorship lines are never removed.

function build(s: ParsedSections, sponsor: string[]): string {
  const parts: string[] = [];
  if (s.responsibilities) parts.push(`Description / Responsibilities\n${s.responsibilities}`);
  if (s.basicQuals)       parts.push(`Basic Qualifications\n${s.basicQuals}`);
  if (s.preferredQuals)   parts.push(`Preferred Qualifications\n${s.preferredQuals}`);
  if (s.rest)             parts.push(`Other\n${s.rest}`);
  if (sponsor.length > 0) parts.push(`Sponsorship / Work Authorization\n${sponsor.join(" ")}`);
  return parts.join("\n\n");
}

export function assemblePromptDescription(
  sections: ParsedSections,
  sponsorshipLines: string[] = [],
): string {
  // No structure detected and no body — return empty so the < 1000 guard
  // upstream catches it.
  const hasAny =
    sections.responsibilities || sections.basicQuals ||
    sections.preferredQuals || sections.rest;
  if (!hasAny) return sponsorshipLines.length > 0
    ? `Sponsorship / Work Authorization\n${sponsorshipLines.join(" ")}`
    : "";

  let working: ParsedSections = { ...sections };
  let assembled = build(working, sponsorshipLines);
  if (assembled.length <= PROMPT_BUDGET_CHARS) return assembled;

  // Step 1: trim rest to REST_TRIM_CHARS.
  if (working.rest && working.rest.length > REST_TRIM_CHARS) {
    working = { ...working, rest: working.rest.slice(0, REST_TRIM_CHARS) };
    assembled = build(working, sponsorshipLines);
    if (assembled.length <= PROMPT_BUDGET_CHARS) return assembled;
  }

  // Step 2: drop rest entirely.
  if (working.rest) {
    working = { ...working, rest: undefined };
    assembled = build(working, sponsorshipLines);
    if (assembled.length <= PROMPT_BUDGET_CHARS) return assembled;
  }

  // Step 3: trim preferredQuals.
  if (working.preferredQuals && working.preferredQuals.length > PREFERRED_QUALS_TRIM_CHARS) {
    working = { ...working, preferredQuals: working.preferredQuals.slice(0, PREFERRED_QUALS_TRIM_CHARS) };
    assembled = build(working, sponsorshipLines);
    if (assembled.length <= PROMPT_BUDGET_CHARS) return assembled;
  }

  // Step 4 (fallback): head + tail of the sections-only text, then sponsor
  //                    block always appended at the end.
  const sectionsOnly = build(working, []);
  const head = sectionsOnly.slice(0, FALLBACK_HEAD_CHARS);
  const tail = sectionsOnly.slice(-FALLBACK_TAIL_CHARS);
  let out = head + FALLBACK_SEPARATOR + tail;
  if (sponsorshipLines.length > 0) {
    out += `\n\nSponsorship / Work Authorization\n${sponsorshipLines.join(" ")}`;
  }
  return out;
}

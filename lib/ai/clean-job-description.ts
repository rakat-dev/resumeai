// Strip page chrome, embedded analytics scripts, EEO/legal boilerplate, and
// other noise from a job description before it is included in an AI prompt.
//
// Why this exists: scrapers like Amazon's strip <script> *tags* but keep the
// JS *body* as plain text, so JDs in the DB regularly start with Boomerang /
// UE analytics blobs and end with `var CXT = ...; dispatchEvent(...)`. That
// pads each prompt by 5-10KB of garbage that the model has to read.

// Smart trim threshold + head/tail sizes. Preserves the first ~3KB of content
// (responsibilities + basic qualifications usually) AND the last ~1.5KB
// (preferred quals, sponsorship/visa clauses, salary range). The middle is
// the part most likely to be EEO/legal/repeated boilerplate the AI doesn't
// need.
const SMART_TRIM_THRESHOLD = 5500;
const SMART_TRIM_HEAD_CHARS = 3000;
const SMART_TRIM_TAIL_CHARS = 1500;
const SMART_TRIM_SEPARATOR = "\n\n[...]\n\n";

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

  // 8. Smart trim — preserve head + tail, drop middle. Keeps the leading
  //    sections (description + responsibilities + basic quals) AND the
  //    trailing sections (preferred quals + sponsorship/visa + salary), at
  //    the cost of any boilerplate-heavy middle.
  if (text.length > SMART_TRIM_THRESHOLD) {
    const head = text.slice(0, SMART_TRIM_HEAD_CHARS);
    const tail = text.slice(-SMART_TRIM_TAIL_CHARS);
    text = head + SMART_TRIM_SEPARATOR + tail;
  }
  return text;
}

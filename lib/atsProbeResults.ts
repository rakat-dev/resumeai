// ── ATS Expansion Probe Results ───────────────────────────────────────────────
// Static record of every candidate source probed during the Workday/Greenhouse
// expansion effort. Updated manually after each probe batch.
//
// Purpose: purely observational — feeds the /diagnostics UI so failures are
// visible and classified. Does NOT affect any adapter, pipeline, or validator.
//
// Last updated: 2026-04-30

export type FailureBucket =
  | "viable"              // HTTP 200, parseable dates, usable US locations, real adapter_kept
  | "cloudflare_blocked"  // HTTP 401/422 — Cloudflare bot protection on Workday CXS endpoint
  | "location_unusable"   // HTTP 200 but location field has no usable city/state/country signal
  | "date_unparseable"    // HTTP 200 but postedOn/date field format not handled by current parser
  | "not_on_ats"          // HTTP 404 — company is not on the probed ATS
  | "endpoint_unknown";   // Not yet probed — ATS confirmed but correct URL not found

export interface AtsProbeResult {
  company:                  string;
  ats:                      string;
  endpoint:                 string;
  http_status:              number | string;
  fetched:                  number;
  dropped_by_date:          number;
  dropped_by_location:      number;
  dropped_by_title:         number;
  dropped_by_desc:          number;
  adapter_kept:             number;
  failure_bucket:           FailureBucket;
  reason:                   string;
  recommended_next_action:  string;
  probed_at:                string;
}

export const ATS_PROBE_RESULTS: AtsProbeResult[] = [

  // ── VIABLE ──────────────────────────────────────────────────────────────────
  {
    company: "Zoom",
    ats: "workday",
    endpoint: "zoom.wd5.myworkdayjobs.com/wday/cxs/zoom/Zoom/jobs",
    http_status: 200,
    fetched: 28,
    dropped_by_date: 0,
    dropped_by_location: 2,
    dropped_by_title: 2,
    dropped_by_desc: 0,
    adapter_kept: 24,
    failure_bucket: "viable",
    reason: "HTTP 200. Parseable ISO dates. Clean city/state locations (Seattle WA, San Jose CA, Remote US). adapter_kept=24.",
    recommended_next_action: "Added to registry as workday/enabled:true (2026-04-30). Run workday refresh to verify production funnel.",
    probed_at: "2026-04-30",
  },

  // ── CLOUDFLARE_BLOCKED ───────────────────────────────────────────────────────
  {
    company: "DoorDash",
    ats: "workday",
    endpoint: "doordash.wd5.myworkdayjobs.com — all site variants",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 on wd5/External, wd1/External, wd5/DoorDash, wd1/doordash. Cloudflare Bot Management rejects server-side CXS requests.",
    recommended_next_action: "Source via Adzuna targeted until Cloudflare bypass strategy (ScrapingBee, Playwright proxy, etc.) is approved.",
    probed_at: "2026-04-30",
  },
  {
    company: "Snowflake",
    ats: "workday",
    endpoint: "snowflake.wd1.myworkdayjobs.com — all site variants",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422/401 on wd1/External, wd5/External, wd1/Snowflake, wd1/snowflake. Not on Greenhouse (404). Cloudflare-blocked.",
    recommended_next_action: "Source via Adzuna targeted until bypass approved.",
    probed_at: "2026-04-30",
  },
  {
    company: "Wells Fargo",
    ats: "workday",
    endpoint: "wellsfargo.wd1.myworkdayjobs.com/WF_External_Careers",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 — Cloudflare blocks server-side CXS fetches. Currently sourced via Adzuna targeted.",
    recommended_next_action: "Keep on Adzuna targeted. Revisit if Cloudflare bypass available.",
    probed_at: "2026-04-16",
  },
  {
    company: "Capital One",
    ats: "workday",
    endpoint: "capitalone.wd1.myworkdayjobs.com/Capital_One_External",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 — Cloudflare blocks server-side CXS fetches. Currently sourced via Adzuna targeted.",
    recommended_next_action: "Keep on Adzuna targeted. Revisit if Cloudflare bypass available.",
    probed_at: "2026-04-16",
  },
  {
    company: "Morgan Stanley",
    ats: "workday",
    endpoint: "morganstanley.wd5.myworkdayjobs.com/External",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 — Cloudflare blocks CXS. Currently sourced via Adzuna targeted.",
    recommended_next_action: "Keep on Adzuna targeted.",
    probed_at: "2026-04-16",
  },
  {
    company: "Uber",
    ats: "workday",
    endpoint: "uber.wd5.myworkdayjobs.com/External",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 on wd5/External and wd1/Uber_Careers. Cloudflare-blocked.",
    recommended_next_action: "No current coverage. Add to Adzuna targeted if confirmed indexed there.",
    probed_at: "2026-04-30",
  },
  {
    company: "DocuSign",
    ats: "workday",
    endpoint: "docusign.wd5.myworkdayjobs.com/External",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 on wd5/External and wd1/External. Cloudflare-blocked.",
    recommended_next_action: "No current coverage. Probe Adzuna or Greenhouse for alternate source.",
    probed_at: "2026-04-30",
  },
  {
    company: "Twilio",
    ats: "workday",
    endpoint: "twilio.wd5.myworkdayjobs.com/Twilio",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 on wd5/Twilio and wd1/External. Cloudflare-blocked.",
    recommended_next_action: "Currently sourced via Greenhouse adapter (enabled). Workday blocked.",
    probed_at: "2026-04-30",
  },
  {
    company: "Block (Square)",
    ats: "workday",
    endpoint: "block.wd5.myworkdayjobs.com/Block",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 on wd5/Block and squareup.wd5/External. Cloudflare-blocked.",
    recommended_next_action: "No current coverage. Probe Greenhouse slug 'square' or 'block'.",
    probed_at: "2026-04-30",
  },
  {
    company: "Snap",
    ats: "workday",
    endpoint: "snap.wd5.myworkdayjobs.com/External",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422. Cloudflare-blocked.",
    recommended_next_action: "No current coverage. Probe Greenhouse slug 'snapchat' or 'snap'.",
    probed_at: "2026-04-30",
  },
  {
    company: "Pinterest",
    ats: "workday",
    endpoint: "pinterest.wd5.myworkdayjobs.com/External",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422. Cloudflare-blocked.",
    recommended_next_action: "No current coverage. Probe Greenhouse slug 'pinterest'.",
    probed_at: "2026-04-30",
  },
  {
    company: "Qualcomm",
    ats: "workday",
    endpoint: "qualcomm.wd5.myworkdayjobs.com/External",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422 on wd5 and wd1. Cloudflare-blocked.",
    recommended_next_action: "No current coverage. Low priority — mostly chip-design roles.",
    probed_at: "2026-04-30",
  },
  {
    company: "Roblox",
    ats: "workday",
    endpoint: "roblox.wd5.myworkdayjobs.com/External",
    http_status: 422,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 422. Cloudflare-blocked.",
    recommended_next_action: "Probe Greenhouse slug 'roblox'.",
    probed_at: "2026-04-30",
  },
  {
    company: "Nutanix",
    ats: "workday",
    endpoint: "nutanix.wd5.myworkdayjobs.com/External",
    http_status: 401,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "cloudflare_blocked",
    reason: "HTTP 401 — auth challenge, effectively same result as Cloudflare 422.",
    recommended_next_action: "No current coverage. Probe Greenhouse slug 'nutanix'.",
    probed_at: "2026-04-30",
  },

  // ── LOCATION_UNUSABLE ────────────────────────────────────────────────────────
  {
    company: "Zendesk",
    ats: "workday",
    endpoint: "zendesk.wd1.myworkdayjobs.com/wday/cxs/zendesk/Zendesk/jobs",
    http_status: 200,
    fetched: 128,
    dropped_by_date: 0,
    dropped_by_location: 116,
    dropped_by_title: 12,
    dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "location_unusable",
    reason: "Workday multi-location field returns '2 Locations', 'Pune, India', 'Copenhagen, Denmark'. Primary US office not surfaced in the CXS listing locationsText field.",
    recommended_next_action: "Requires location normalization layer (see design doc). locationsText='N Locations' needs detail-endpoint fallback to extract primary US city.",
    probed_at: "2026-04-30",
  },
  {
    company: "Cloudflare",
    ats: "greenhouse",
    endpoint: "boards-api.greenhouse.io/v1/boards/cloudflare/jobs",
    http_status: 200,
    fetched: 447,
    dropped_by_date: 0,
    dropped_by_location: 445,
    dropped_by_title: 1,
    dropped_by_desc: 0,
    adapter_kept: 1,
    failure_bucket: "location_unusable",
    reason: "Greenhouse location field is work-arrangement only: 'Hybrid' (300x), 'In-Office' (91x), 'Distributed' (40x). No city/state/country. isUSLocation cannot classify these.",
    recommended_next_action: "Requires location normalization design decision. 'Hybrid' and 'In-Office' are not automatically US — Cloudflare is a global company. Need structured fallback (e.g. country metadata from detail endpoint).",
    probed_at: "2026-04-30",
  },

  // ── DATE_UNPARSEABLE ─────────────────────────────────────────────────────────
  {
    company: "Baxter",
    ats: "workday",
    endpoint: "baxter.wd1.myworkdayjobs.com/wday/cxs/baxter/Baxter/jobs",
    http_status: 200,
    fetched: 61,
    dropped_by_date: 61,
    dropped_by_location: 0,
    dropped_by_title: 0,
    dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "date_unparseable",
    reason: "postedOn field present but in a format the current parsePostedAt() cannot resolve to a valid Date. All 61 jobs drop on date filter. Locations include Round Lake IL and Batesville IN (real US), so location would pass.",
    recommended_next_action: "Requires date normalization layer (see design doc). Capture raw postedOn format to determine parser gap. Do NOT add Baxter-specific hack.",
    probed_at: "2026-04-30",
  },

  // ── NOT_ON_ATS ───────────────────────────────────────────────────────────────
  {
    company: "DoorDash",
    ats: "greenhouse",
    endpoint: "boards-api.greenhouse.io/v1/boards/doordash/jobs",
    http_status: 404,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "not_on_ats",
    reason: "All slug variants return 404. DoorDash is not on Greenhouse.",
    recommended_next_action: "Reclassified to Workday (done). Currently Cloudflare-blocked.",
    probed_at: "2026-04-30",
  },
  {
    company: "Snowflake",
    ats: "greenhouse",
    endpoint: "boards-api.greenhouse.io/v1/boards/snowflake/jobs",
    http_status: 404,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "not_on_ats",
    reason: "All slug variants return 404. Snowflake is not on Greenhouse.",
    recommended_next_action: "Reclassified to Workday (done). Currently Cloudflare-blocked.",
    probed_at: "2026-04-30",
  },
  {
    company: "HashiCorp",
    ats: "greenhouse",
    endpoint: "boards-api.greenhouse.io/v1/boards/hashicorp/jobs",
    http_status: 404,
    fetched: 0,
    dropped_by_date: 0, dropped_by_location: 0, dropped_by_title: 0, dropped_by_desc: 0,
    adapter_kept: 0,
    failure_bucket: "not_on_ats",
    reason: "All slug variants return 404. HashiCorp ATS unconfirmed — may use Lever or IBM Kenexa post-acquisition.",
    recommended_next_action: "Probe Lever (jobs.lever.co/hashicorp) and IBM Kenexa. Low priority post-IBM acquisition.",
    probed_at: "2026-04-30",
  },
];

// ── Summary helpers ───────────────────────────────────────────────────────────

export function groupProbesByBucket(
  results: AtsProbeResult[],
): Record<FailureBucket, AtsProbeResult[]> {
  const out: Record<FailureBucket, AtsProbeResult[]> = {
    viable: [], cloudflare_blocked: [], location_unusable: [],
    date_unparseable: [], not_on_ats: [], endpoint_unknown: [],
  };
  for (const r of results) out[r.failure_bucket].push(r);
  return out;
}

export const BUCKET_META: Record<FailureBucket, { label: string; color: string; description: string }> = {
  viable: {
    label: "Viable",
    color: "green",
    description: "HTTP 200, parseable dates, usable US locations, real adapter_kept count.",
  },
  cloudflare_blocked: {
    label: "Cloudflare Blocked",
    color: "orange",
    description: "HTTP 401/422 from Cloudflare Bot Management. Cannot scrape from serverless.",
  },
  location_unusable: {
    label: "Location Unusable",
    color: "yellow",
    description: "HTTP 200 but location field has no usable city/state/country signal (e.g. 'Hybrid', '2 Locations').",
  },
  date_unparseable: {
    label: "Date Unparseable",
    color: "yellow",
    description: "HTTP 200 but postedOn/date field format not handled by current parser. All jobs drop on date filter.",
  },
  not_on_ats: {
    label: "Not on ATS",
    color: "gray",
    description: "HTTP 404 — company is not on the probed ATS. Needs reclassification.",
  },
  endpoint_unknown: {
    label: "Endpoint Unknown",
    color: "gray",
    description: "ATS confirmed but correct URL/site path not yet found.",
  },
};

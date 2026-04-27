// ── Company → ATS Registry ─────────────────────────────────────────────────
// Single source of truth. Each company appears EXACTLY ONCE.
// enabled: false = configured but adapter not yet buildable/working.

export type AtsType =
  | "workday"
  | "oracle_hcm"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "taleo"
  | "brassring"
  | "eightfold"
  | "successfactors"
  | "icims"
  | "phenom"
  | "custom";

export interface CompanyAtsConfig {
  company:     string;
  ats:         AtsType;
  careersUrl?: string;
  hostHint?:   string;
  adapter:     string;
  enabled:     boolean;
  note?:       string;
}

export const COMPANY_ATS_REGISTRY: CompanyAtsConfig[] = [

  // ── WORKDAY ───────────────────────────────────────────────────────────────
  { company: "Salesforce",      ats: "workday", careersUrl: "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site",    adapter: "workday", enabled: true  },
  { company: "ServiceNow",      ats: "workday", careersUrl: "https://servicenow.wd12.myworkdayjobs.com/External",                adapter: "workday", enabled: true  },
  { company: "Adobe",           ats: "workday", careersUrl: "https://adobe.wd5.myworkdayjobs.com/external_experienced",          adapter: "workday", enabled: true,
    note: "Site name is 'external_experienced', not the usual 'External' or 'external_career' (probe 2026-04-16)." },
  { company: "Intel",           ats: "workday", careersUrl: "https://intel.wd1.myworkdayjobs.com/External",                      adapter: "workday", enabled: true  },
  { company: "Wells Fargo",     ats: "workday", careersUrl: "https://wellsfargo.wd1.myworkdayjobs.com/WF_External_Careers",      adapter: "workday", enabled: false,
    note: "HTTP 422 — Cloudflare bot protection blocks server-side fetches. Jobs sourced via JSearch/Adzuna instead." },
  { company: "Capital One",     ats: "workday", careersUrl: "https://capitalone.wd1.myworkdayjobs.com/Capital_One_External",     adapter: "workday", enabled: false,
    note: "HTTP 422 — Cloudflare bot protection blocks server-side fetches. Jobs sourced via JSearch/Adzuna instead." },
  { company: "Verizon",         ats: "workday", careersUrl: "https://verizon.wd5.myworkdayjobs.com/External",                   adapter: "workday", enabled: false,
    note: "HTTP 422 on both wd5/External and wd1/VerizonCareers (2026-04-16 probe). Cloudflare bot protection. No direct ATS source currently working; Adzuna also has 0 matches. TODO: find real endpoint or accept no Verizon coverage." },
  { company: "T-Mobile",        ats: "workday", careersUrl: "https://tmobile.wd1.myworkdayjobs.com/External",                   adapter: "workday", enabled: true  },
  { company: "S&P Global",      ats: "workday", careersUrl: "https://spglobal.wd1.myworkdayjobs.com/Careers",                   adapter: "workday", enabled: false,
    note: "HTTP 422/404 on spglobal/spgi × wd1/wd5 × Careers/External variants (probe 2026-04-16). Cloudflare bot protection. Jobs sourced via Adzuna." },
  { company: "CVS Health",      ats: "workday", careersUrl: "https://cvshealth.wd1.myworkdayjobs.com/CVS_Health_Careers",        adapter: "workday", enabled: false,
    note: "Switched to direct Phenom scrape 2026-04-17 (jobs.cvshealth.com). Phenom returns 215 IT jobs (ground truth) vs Workday SWE-keyword search returning 53 with worse coverage. Apply URLs from Phenom point to the same cvshealth.wd1.myworkdayjobs.com tenant, so candidates land in the identical Workday application flow." },
  { company: "UnitedHealth",    ats: "workday", careersUrl: "https://uhg.wd5.myworkdayjobs.com/External",                       adapter: "workday", enabled: true  },
  { company: "Elevance Health", ats: "workday", careersUrl: "https://elevancehealth.wd1.myworkdayjobs.com/ANT",                 adapter: "workday", enabled: true  },
  { company: "Walmart",         ats: "custom", careersUrl: "https://walmart.wd5.myworkdayjobs.com/WalmartExternal",            adapter: "walmart_cxs", enabled: true,
    note: "Direct Workday CXS backend (2026-04-18). POST to /wday/cxs/walmart/WalmartExternal/jobs with Job_Profiles facet. 4 profiles: Senior SWE InfoSec, Senior SWE, SWE III, SWE II. 265 jobs total. ats=custom so getWorkdayConfigs() skips it. Apply URL: /details/{slug} from externalPath last segment." },
  { company: "Target",          ats: "workday", careersUrl: "https://target.wd5.myworkdayjobs.com/targetcareers",               adapter: "workday", enabled: true  },
  { company: "Home Depot",      ats: "workday", careersUrl: "https://homedepot.wd5.myworkdayjobs.com/External",                 adapter: "workday", enabled: false,
    note: "HTTP 404 — site name 'External' is wrong for this tenant. Jobs sourced via JSearch/Adzuna instead." },
  { company: "NVIDIA",          ats: "workday", careersUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",    adapter: "workday", enabled: true  },
  { company: "Lowe's",          ats: "workday", careersUrl: "https://lowes.wd1.myworkdayjobs.com/External",                     adapter: "workday", enabled: false,
    note: "HTTP 422 on all wd1/wd5 × External/Lowes/LowesCareers variants (probe 2026-04-16). Cloudflare bot protection. Jobs sourced via JSearch/Adzuna instead." },
  { company: "Costco",          ats: "workday", careersUrl: "https://costco.wd5.myworkdayjobs.com/External",                    adapter: "workday", enabled: false,
    note: "HTTP 422 (2026-04-16 probe). Cloudflare bot protection. www.costco.com/jobs has no JSON API (SPA only). No direct source currently working; Adzuna also returns 0." },
  { company: "FedEx",           ats: "workday", careersUrl: "https://fedex.wd1.myworkdayjobs.com/External",                     adapter: "workday", enabled: false,
    note: "HTTP 404/422 on all wd1/wd5 × External/FedExCareers/FedEx_Careers variants (probe 2026-04-16). Cloudflare bot protection. Jobs sourced via JSearch/Adzuna instead." },
  { company: "UPS",             ats: "workday", careersUrl: "https://ups.wd1.myworkdayjobs.com/External",                       adapter: "workday", enabled: false,
    note: "HTTP 422 on all wd1/wd5 × External/UPSCareers/UPSJobs variants (probe 2026-04-16). Cloudflare bot protection. Jobs sourced via JSearch/Adzuna instead." },
  { company: "Morgan Stanley",  ats: "workday", careersUrl: "https://morganstanley.wd5.myworkdayjobs.com/External",             adapter: "workday", enabled: false,
    note: "HTTP 422 — Cloudflare bot protection blocks server-side fetches. Jobs sourced via JSearch/Adzuna instead." },
  { company: "Fidelity",        ats: "workday", careersUrl: "https://fmr.wd1.myworkdayjobs.com/FidelityCareers",                adapter: "workday", enabled: true  },
  // Added: major companies previously missing
  { company: "Citi",            ats: "workday", careersUrl: "https://citi.wd5.myworkdayjobs.com/2",                             adapter: "workday", enabled: true  },
  { company: "American Express",ats: "workday", careersUrl: "https://aexp.wd5.myworkdayjobs.com/globalcareers",                 adapter: "workday", enabled: false,
    note: "HTTP 422 on aexp.wd5/globalcareers, aexp.wd1/External, americanexpress.wd1/External (2026-04-16 probe). Cloudflare bot protection. No direct source currently working; Adzuna also returns 0. TODO: try Oracle HCM (may require careersUrl like careers.americanexpress.com exposed via browser)." },
  { company: "Deloitte",        ats: "workday", careersUrl: "https://deloitte.wd5.myworkdayjobs.com/DTUSCareers",               adapter: "workday", enabled: true  },
  { company: "Lockheed Martin", ats: "workday", careersUrl: "https://lmcocareers.wd5.myworkdayjobs.com/LMCareers",              adapter: "workday", enabled: true  },

  // ── ORACLE HCM ────────────────────────────────────────────────────────────
  {
    company: "JPMorgan Chase", ats: "oracle_hcm",
    careersUrl: "https://jpmc.fa.oraclecloud.com", hostHint: "jpmc",
    adapter: "oracle_hcm", enabled: true,
  },
  {
    company: "Goldman Sachs", ats: "oracle_hcm",
    careersUrl: "https://hdpc.fa.us2.oraclecloud.com", hostHint: "goldmansachs",
    adapter: "oracle_hcm", enabled: true,
  },
  {
    company: "Bank of America", ats: "oracle_hcm",
    careersUrl: "https://bofa.fa.oraclecloud.com", hostHint: "bofa",
    adapter: "oracle_hcm", enabled: false,
    note: "Endpoint not verified — enable after confirming Oracle HCM REST path",
  },

  // ── TALEO ─────────────────────────────────────────────────────────────────
  {
    company: "Oracle", ats: "taleo",
    careersUrl: "https://oracle.taleo.net",
    adapter: "taleo", enabled: false,
    note: "Taleo adapter not yet implemented",
  },

  // ── GREENHOUSE ────────────────────────────────────────────────────────────
  { company: "Databricks",   ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/databricks",   adapter: "greenhouse", enabled: true },
  { company: "Snowflake",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/snowflake",    adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s — Snowflake is not on Greenhouse. Sourced via Adzuna targeted." },
  { company: "HashiCorp",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/hashicorp",    adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s — HashiCorp not on Greenhouse. Adzuna has no real matches either. TODO: find real ATS." },
  { company: "Cloudflare",   ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/cloudflare",   adapter: "greenhouse", enabled: true },
  { company: "MongoDB",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/mongodb",      adapter: "greenhouse", enabled: true },
  { company: "Confluent",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/confluent",    adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s. Adzuna has no real matches either. TODO: find real ATS." },
  { company: "Atlassian",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/atlassian",    adapter: "greenhouse", enabled: true },
  { company: "Anthropic",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/anthropic",    adapter: "greenhouse", enabled: true },
  { company: "Stripe",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/stripe",       adapter: "greenhouse", enabled: true },
  { company: "Figma",        ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/figma",        adapter: "greenhouse", enabled: true },
  { company: "Notion",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/notion",       adapter: "greenhouse", enabled: true },
  { company: "Brex",         ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/brex",         adapter: "greenhouse", enabled: true },
  { company: "Gusto",        ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/gusto",        adapter: "greenhouse", enabled: true },
  { company: "Ramp",         ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/ramp",         adapter: "greenhouse", enabled: true },
  { company: "Plaid",        ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/plaid",        adapter: "greenhouse", enabled: true },
  { company: "Airbnb",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/airbnb",       adapter: "greenhouse", enabled: true },
  { company: "DoorDash",     ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/doordash",     adapter: "greenhouse", enabled: true },
  { company: "Coinbase",     ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/coinbase",     adapter: "greenhouse", enabled: true },
  { company: "Robinhood",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/robinhood",    adapter: "greenhouse", enabled: true },
  { company: "Amplitude",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/amplitude",    adapter: "greenhouse", enabled: true },
  { company: "Segment",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/segment",      adapter: "greenhouse", enabled: true },
  { company: "Flexport",     ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/flexport",     adapter: "greenhouse", enabled: true },
  { company: "Mercury",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/mercury",      adapter: "greenhouse", enabled: true },
  { company: "Checkr",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/checkr",       adapter: "greenhouse", enabled: true },
  { company: "Vercel",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/vercel",       adapter: "greenhouse", enabled: true },
  { company: "Webflow",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/webflow",      adapter: "greenhouse", enabled: true },
  { company: "Airtable",     ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/airtable",     adapter: "greenhouse", enabled: true },
  { company: "Asana",        ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/asana",        adapter: "greenhouse", enabled: true },
  { company: "Deel",         ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/deel",         adapter: "greenhouse", enabled: true },
  { company: "Postman",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/postman",      adapter: "greenhouse", enabled: true },
  { company: "Sourcegraph",  ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/sourcegraph",  adapter: "greenhouse", enabled: true },
  { company: "LaunchDarkly", ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/launchdarkly", adapter: "greenhouse", enabled: true },
  { company: "Neo4j",        ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/neo4j",        adapter: "greenhouse", enabled: true },
  // PayPal — verified 2026-04-16: paypal.wd1.myworkdayjobs.com/jobs returns
  // HTTP 200 with 255 SWE jobs. Moved from Greenhouse (404) to Workday.
  // NOTE: the site path is "jobs" (not "External" like most tenants) —
  // visible in the Workday URL scheme as /wday/cxs/paypal/jobs/jobs.
  { company: "PayPal",       ats: "workday", careersUrl: "https://paypal.wd1.myworkdayjobs.com/jobs",            adapter: "workday", enabled: true,
    note: "Unusual site path 'jobs' — do not rewrite to 'External'." },
  { company: "Visa",         ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/visa",         adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s. Sourced via Adzuna targeted." },
  { company: "Mastercard",   ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/mastercard",   adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s. Sourced via Adzuna targeted." },
  { company: "Infosys",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/infosys",      adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s. Adzuna 400s on name. TODO: Infosys uses SAP SuccessFactors." },
  { company: "Cognizant",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/cognizant",    adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s. Sourced via Adzuna targeted (314 jobs indexed)." },
  { company: "Accenture",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/accenture",    adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s. Sourced via Adzuna targeted (273 jobs indexed)." },
  { company: "Capgemini",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/capgemini",    adapter: "greenhouse", enabled: false, note: "Greenhouse slug 404s. Sourced via Adzuna targeted (94 jobs indexed)." },
  // Added: more tech companies confirmed on Greenhouse
  { company: "Lyft",         ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/lyft",         adapter: "greenhouse", enabled: true },
  { company: "Instacart",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/instacart",    adapter: "greenhouse", enabled: true },
  { company: "Twilio",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/twilio",       adapter: "greenhouse", enabled: true },
  { company: "HubSpot",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/hubspot",      adapter: "greenhouse", enabled: true },
  { company: "Datadog",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/datadog",      adapter: "greenhouse", enabled: true },
  { company: "PagerDuty",    ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/pagerduty",    adapter: "greenhouse", enabled: true },
  { company: "Okta",         ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/okta",         adapter: "greenhouse", enabled: true },
  { company: "Splunk",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/splunk",       adapter: "greenhouse", enabled: true },
  { company: "Zendesk",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/zendesk",      adapter: "greenhouse", enabled: true },
  { company: "Twitch",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/twitch",       adapter: "greenhouse", enabled: true },
  { company: "Reddit",       ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/reddit",       adapter: "greenhouse", enabled: true },
  { company: "Dropbox",      ats: "greenhouse", careersUrl: "https://boards.greenhouse.io/dropbox",      adapter: "greenhouse", enabled: true },

  // ── ASHBY ─────────────────────────────────────────────────────────────────
  { company: "OpenAI",  ats: "ashby", careersUrl: "https://jobs.ashbyhq.com/openai",  adapter: "ashby", enabled: true },
  { company: "Perplexity", ats: "ashby", careersUrl: "https://jobs.ashbyhq.com/perplexity-ai", adapter: "ashby", enabled: true },

  // ── LEVER ─────────────────────────────────────────────────────────────────
  { company: "Netflix", ats: "lever", careersUrl: "https://jobs.lever.co/netflix", adapter: "lever", enabled: true },

  // ── BRASSRING ─────────────────────────────────────────────────────────────
  {
    company: "AT&T", ats: "brassring",
    careersUrl: "https://sjobs.brassring.com",
    adapter: "brassring", enabled: false,
    note: "BrassRing requires CSRF token + session cookies — cannot be automated server-side without browser",
  },

  // ── EIGHTFOLD ─────────────────────────────────────────────────────────────
  {
    company: "Cisco", ats: "eightfold",
    careersUrl: "https://jobs.cisco.com",
    adapter: "eightfold", enabled: false,
    note: "Eightfold adapter not yet implemented",
  },

  // ── PHENOM PEOPLE ─────────────────────────────────────────────────────────
  // Direct scrape of Phenom-hosted careers sites. Adapter implemented in
  // lib/scrapers/phenom.ts — tenant config (refNum, hostname, category) lives
  // in PHENOM_TENANTS over there, this entry is just for registry visibility
  // and Adzuna exclusion logic (see PHENOM_ONLY_COMPANIES below).
  { company: "CVS Health",     ats: "phenom", careersUrl: "https://jobs.cvshealth.com",          adapter: "phenom", enabled: true,
    note: "Replaced Workday adapter on 2026-04-17. Phenom returns 215 IT jobs (ground truth from CVS's own site) with real cvshealth.wd1.myworkdayjobs.com apply URLs and no Adzuna geo-fanout." },

  // META (sitemap + JSON-LD). Direct sitemap-based scrape of metacareers.com.
  // Adapter implemented in lib/scrapers/meta.ts. Replaces the broken
  // playwright_meta scraper (the playwright entry below is set enabled:false).
  // Sitemap exposes ~918 job URLs each with full JSON-LD JobPosting; ~78%
  // are US-anchored. Excluded from Adzuna by META_DIRECT_COMPANIES below to
  // prevent re-import of the 89%-duplicate Adzuna data we observed for Meta.
  { company: "Meta",           ats: "custom", careersUrl: "https://www.metacareers.com/jobs/sitemap.xml", adapter: "meta",   enabled: true,
    note: "Sitemap+JSON-LD scrape added 2026-04-17. Replaces playwright_meta (HTTP 400 since Meta added per-request anti-replay tokens to GraphQL)." },

  // ── PLAYWRIGHT / CUSTOM CAREER PAGE APIs (Tier A) ─────────────────────────
  { company: "Microsoft",      ats: "custom", careersUrl: "https://jobs.careers.microsoft.com/global/en/search",   adapter: "microsoft_v2", enabled: true },
  { company: "Google",         ats: "custom", careersUrl: "https://careers.google.com/api/v3/search",              adapter: "playwright_google",    enabled: true },
  { company: "Apple",          ats: "custom", careersUrl: "https://jobs.apple.com/api/role/search",                adapter: "playwright_apple",     enabled: true },
  { company: "Meta",           ats: "custom", careersUrl: "https://www.metacareers.com/graphql",                   adapter: "playwright_meta",      enabled: false,
    note: "Disabled 2026-04-17 — Meta added per-request anti-replay tokens to its GraphQL endpoint, breaking server-side replay (returns HTTP 400 / noncoercible_variable_value). Replaced by the meta sitemap+JSON-LD adapter (above, adapter:'meta')." },
  { company: "Amazon",         ats: "custom", careersUrl: "https://www.amazon.jobs/en/search.json",               adapter: "amazon_jobs",    enabled: true },
];

// ── Lookup helpers ─────────────────────────────────────────────────────────
export function getEnabledByAdapter(adapter: string): CompanyAtsConfig[] {
  return COMPANY_ATS_REGISTRY.filter(c => c.enabled && c.adapter === adapter);
}

export function getEnabledByAts(ats: AtsType): CompanyAtsConfig[] {
  return COMPANY_ATS_REGISTRY.filter(c => c.enabled && c.ats === ats);
}

export interface WorkdayConfig {
  name:   string;
  tenant: string;
  site:   string;
  server: string;
}

export function getWorkdayConfigs(): WorkdayConfig[] {
  return getEnabledByAts("workday").map(c => {
    const url   = c.careersUrl ?? "";
    const match = url.match(/https?:\/\/([^.]+)\.([^.]+)\.myworkdayjobs\.com\/(.+)/);
    if (!match) return null;
    const [, tenant, server, site] = match;
    return { name: c.company, tenant, server, site };
  }).filter((x): x is WorkdayConfig => x !== null);
}

export function getGreenhouseSlugs(): Array<{ company: string; slug: string }> {
  return getEnabledByAts("greenhouse").map(c => {
    const url  = c.careersUrl ?? "";
    const slug = url.split("/").pop() ?? "";
    return { company: c.company, slug };
  }).filter(x => x.slug !== "");
}

// ── Adzuna exclusion list ───────────────────────────────────────────────
// Companies whose primary source is a direct adapter (Phenom, Workday, etc.)
// AND whose Adzuna data is unreliable enough to want excluded entirely.
// CVS Health: Adzuna fans out a single requisition across 30+ state capitals,
// each with a broken /land/ad/ apply URL pointing back to Adzuna's own site.
// Direct Phenom scrape returns one row per real requisition with the actual
// Workday apply URL.
//
// Names must match the EXACT strings used by ADZUNA_TARGETED_COMPANIES in
// app/api/jobs/refresh/route.ts AND the company names returned by Adzuna's
// API in `company.display_name` (which is what gets stored in `company`).
export const PHENOM_ONLY_COMPANIES: ReadonlySet<string> = new Set([
  "CVS Health",
  "CVS",          // legacy variant Adzuna sometimes returns
]);

export function isPhenomOnly(company: string): boolean {
  return PHENOM_ONLY_COMPANIES.has(company)
      || PHENOM_ONLY_COMPANIES.has(company.trim());
}

// Meta is sourced directly from www.metacareers.com via sitemap+JSON-LD
// (lib/scrapers/meta.ts). Adzuna's Meta data was 89% duplicates from feed
// fanout (124 rows collapsing to 13 unique fingerprints, observed 2026-04-17),
// so we exclude it the same way CVS is excluded above.
// Adzuna's company.display_name returns "Meta" for Meta Platforms postings;
// keep the variants list small and exact so we don't accidentally drop
// genuinely-different companies (e.g. "MetaBank", "Meta Financial").
export const META_DIRECT_COMPANIES: ReadonlySet<string> = new Set([
  "Meta",
  "Meta Platforms",
  "Meta Platforms, Inc.",
]);

export function isMetaDirect(company: string): boolean {
  return META_DIRECT_COMPANIES.has(company)
      || META_DIRECT_COMPANIES.has(company.trim());
}


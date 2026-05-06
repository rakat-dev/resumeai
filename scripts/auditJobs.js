#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Live careers-site audit for ResumeAI job coverage.
 *
 * The script compares jobs currently returned by /api/jobs (or a JSON snapshot)
 * with a fresh scrape of enabled official company career pages. It intentionally
 * does not write to Supabase or mutate application state.
 *
 * Usage:
 *   node scripts/auditJobs.js --dry-run --company Amazon
 *   node scripts/auditJobs.js --snapshot ./jobs.json --company Walmart --dry-run
 *   node scripts/auditJobs.js --api-url http://localhost:3000/api/jobs --out-dir ./tmp
 *   node scripts/auditJobs.js --include-registry --max-companies 3 --dry-run
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = process.cwd();
const SEARCH_KEYWORD = "software";
const SEARCH_LOCATION = "United States";
const MAX_AGE_DAYS = 14;
const DEFAULT_DELAY_MS = Number(process.env.AUDIT_RATE_LIMIT_MS || 1500);
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36";

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const args = {
    apiUrl: process.env.AUDIT_JOBS_API_URL || "http://localhost:3000/api/jobs?filter=any&sort=date_desc",
    snapshot: process.env.AUDIT_JOBS_SNAPSHOT || "",
    outDir: process.env.AUDIT_OUT_DIR || ROOT,
    company: "",
    maxCompanies: 0,
    delayMs: DEFAULT_DELAY_MS,
    includeRegistry: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--api-url") args.apiUrl = next, i++;
    else if (a === "--snapshot") args.snapshot = next, i++;
    else if (a === "--out-dir") args.outDir = next, i++;
    else if (a === "--company") args.company = next, i++;
    else if (a === "--max-companies") args.maxCompanies = Number(next), i++;
    else if (a === "--delay-ms") args.delayMs = Number(next), i++;
    else if (a === "--include-registry") args.includeRegistry = true;
    else if (a === "--individual-only") args.includeRegistry = false;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/auditJobs.js [--snapshot jobs.json] [--api-url URL] [--company NAME] [--out-dir DIR]\n\nExamples:\n  node scripts/auditJobs.js --dry-run --company Amazon\n  node scripts/auditJobs.js --snapshot ./jobs.json --company Walmart --dry-run\n  node scripts/auditJobs.js --include-registry --max-companies 3 --dry-run\n\nOptions:\n  --snapshot FILE       Read app jobs from a JSON file instead of /api/jobs\n  --api-url URL         API URL to fetch app jobs from (default localhost:3000/api/jobs)\n  --company NAME        Audit only one company; useful for smoke runs\n  --max-companies N     Limit companies for smoke tests\n  --delay-ms N          Minimum delay between requests to the same domain (default ${DEFAULT_DELAY_MS})\n  --include-registry    Also audit enabled generic registry tenants (Workday/Greenhouse/etc.)\n  --individual-only     Default scope: custom individual adapters only\n  --dry-run             Print console output only; do not write audit-report files\n`);
      process.exit(0);
    }
  }
  return args;
}

function loadTsExports(relativeFile) {
  const file = path.join(ROOT, relativeFile);
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  const sandboxRequire = (request) => {
    if (request.startsWith("@/")) return require(path.join(ROOT, request.slice(2)));
    if (request.startsWith(".")) return require(path.join(path.dirname(file), request));
    return require(request);
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: sandboxRequire, console }, { filename: file });
  return module.exports;
}

const jobUtils = loadTsExports("lib/jobUtils.ts");
const registryExports = loadTsExports("lib/companyAtsRegistry.ts");
const shouldIncludeTitle = jobUtils.shouldIncludeTitle;
const isUSLocation = jobUtils.isUSLocation;
const classifySponsorship = jobUtils.classifySponsorship;
const cleanDescription = jobUtils.cleanDescription;
const REQUIRED_APP_LOGIC = { shouldIncludeTitle, isUSLocation, classifySponsorship, cleanDescription };
for (const [name, fn] of Object.entries(REQUIRED_APP_LOGIC)) {
  if (typeof fn !== "function") throw new Error(`Required app job logic export is unavailable: ${name}`);
}
const APP_LOGIC_STATUS = "loaded app job filtering helpers from lib/jobUtils.ts";

class RateLimiter {
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.lastByHost = new Map();
  }
  async wait(url) {
    const host = new URL(url).host;
    const now = Date.now();
    const last = this.lastByHost.get(host) || 0;
    const waitMs = Math.max(0, this.delayMs - (now - last));
    if (waitMs > 0) await sleep(waitMs);
    this.lastByHost.set(host, Date.now());
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url, opts = {}, limiter) {
  if (limiter) await limiter.wait(url);
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": opts.accept || "text/html,application/json;q=0.9,*/*;q=0.8",
        ...(opts.headers || {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs || 20000),
    });
  } catch (err) {
    const cause = err && err.cause ? `: ${err.cause.message || err.cause}` : "";
    throw new Error(`fetch failed for ${url}${cause}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function fetchJson(url, opts = {}, limiter) {
  const text = await fetchText(url, { ...opts, accept: "application/json" }, limiter);
  return JSON.parse(text);
}

function htmlToText(html) {
  return cleanDescription(String(html || ""));
}

function toIso(raw) {
  if (!raw) return null;
  if (typeof raw === "number") {
    const ms = raw > 10_000_000_000 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function ageDays(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function classifyPostedDate(job) {
  const source = job.postedDateSource || (job.postedAt ? "posted_at" : "unknown");
  const age = ageDays(job.postedAt);
  if (age === null) return { ok: false, reason: "dateUnknown", warning: `missing posted date (${source})` };
  if (age > MAX_AGE_DAYS || age < -1) return { ok: false, reason: "date", warning: null };
  return { ok: true, reason: null, warning: null };
}

function parseRelativeDate(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const now = Date.now();
  if (/just now|today|moments? ago/.test(s)) return new Date(now).toISOString();
  if (/yesterday/.test(s)) return new Date(now - 86_400_000).toISOString();
  const m = s.match(/(\d+)\s*(minute|hour|day|week|month)s?/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const mul = unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : unit === "day" ? 86_400_000 : unit === "week" ? 7 * 86_400_000 : 30 * 86_400_000;
    return new Date(now - n * mul).toISOString();
  }
  return toIso(raw);
}

function normalizeLocation(loc) {
  return String(loc || "")
    .toLowerCase()
    .replace(/\busa\b|\bu\.s\.a\.\b|\bunited states(?: of america)?\b/g, "us")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();
}

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function matchKey(job) {
  return `${normalizeTitle(job.title)}|${normalizeLocation(job.location)}`;
}

function canonicalCompany(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isSameCompany(appCompany, auditCompany) {
  const a = canonicalCompany(appCompany);
  const b = canonicalCompany(auditCompany);
  return a === b || a.includes(b) || b.includes(a);
}

function applyAuditFilters(jobs) {
  const out = [];
  const drops = { title: 0, location: 0, sponsorship: 0, date: 0, dateUnknown: 0, duplicate: 0 };
  const warnings = [];
  const seen = new Set();
  for (const job of jobs) {
    if (!shouldIncludeTitle(job.title)) { drops.title++; continue; }
    if (job.location && !isUSLocation(job.location)) { drops.location++; continue; }
    const sponsorship = classifySponsorship(job.fullDescription || job.description || "");
    if (sponsorship === "not_supported") { drops.sponsorship++; continue; }
    const dateStatus = classifyPostedDate(job);
    if (!dateStatus.ok) {
      drops[dateStatus.reason]++;
      if (dateStatus.warning && warnings.length < 25) warnings.push(`${job.title || "Untitled"}: ${dateStatus.warning}`);
      continue;
    }
    const key = matchKey(job);
    if (seen.has(key)) { drops.duplicate++; continue; }
    seen.add(key);
    out.push({ ...job, sponsorshipStatus: sponsorship, postedAgeDays: ageDays(job.postedAt) });
  }
  return { jobs: out, drops, warnings };
}

async function enrichDetails(listingJobs, limiter, detailFetcher) {
  const detailed = [];
  for (const job of listingJobs) {
    try {
      const detail = await detailFetcher(job);
      detailed.push({ ...job, ...detail });
    } catch (err) {
      detailed.push({ ...job, error: `detail failed: ${err.message}` });
    }
  }
  return detailed;
}

function workdayInfo(careersUrl) {
  const u = new URL(careersUrl);
  const [, tenant, site] = u.pathname.match(/^\/([^/]+)\/([^/]+)/) || [];
  return { base: `${u.protocol}//${u.host}`, tenant, site: site || tenant || "External" };
}

function workdayDetailUrl(cxsBase, job) {
  const externalPath = job.externalPath || "";
  if (externalPath.startsWith("/")) return `${cxsBase}${externalPath}`;
  if (externalPath) return `${cxsBase}/${externalPath}`;
  if (job.sourceId) return `${cxsBase}/job/${encodeURIComponent(job.sourceId)}`;
  return null;
}

async function scrapeWorkday(company, careersUrl, limiter) {
  const { base, tenant, site } = workdayInfo(careersUrl);
  if (!tenant || !site) throw new Error(`Cannot parse Workday tenant/site from ${careersUrl}`);
  const cxsBase = `${base}/wday/cxs/${tenant}/${site}`;
  const endpoint = `${cxsBase}/jobs`;
  const body = {
    appliedFacets: { locationCountry: ["bc33aa3152ec42d4995f4791a106ed09"] },
    limit: 20,
    offset: 0,
    searchText: SEARCH_KEYWORD,
  };
  const data = await fetchJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
  }, limiter);
  const listing = (data.jobPostings || data.jobs || []).map((j) => {
    const externalPath = j.externalPath || j.external_path || j.url || "";
    const applyUrl = externalPath.startsWith("http") ? externalPath : `${base}${externalPath.startsWith("/") ? "" : "/"}${externalPath}`;
    return {
      title: j.title || j.jobTitle || "",
      company,
      location: j.locationsText || j.location || j.primaryLocation || SEARCH_LOCATION,
      applyUrl,
      postedAt: toIso(j.postedOn || j.startDate || j.postedDate || j.externalPostedStartDate),
      postedDateSource: j.postedOn ? "postedOn" : j.startDate ? "startDate" : j.postedDate ? "postedDate" : j.externalPostedStartDate ? "externalPostedStartDate" : "unknown",
      description: htmlToText(j.bulletFields?.join(" ") || j.description || ""),
      source: "official_workday",
      sourceId: j.id || j.jobReqId || j.requisitionId || j.jobRequisitionId || "",
      externalPath,
    };
  });
  return enrichDetails(listing, limiter, async (job) => {
    const detailUrl = workdayDetailUrl(cxsBase, job);
    if (!detailUrl) return { detailWarning: "missing Workday externalPath/sourceId for detail lookup" };
    const detail = await fetchJson(detailUrl, {}, limiter);
    const jd = detail.jobPostingInfo || detail;
    const detailDate = toIso(jd.startDate || jd.postedOn || jd.postedDate || jd.externalPostedStartDate);
    return {
      fullDescription: htmlToText([jd.jobDescription, jd.qualifications, jd.responsibilities].filter(Boolean).join("\n")),
      postedAt: detailDate || job.postedAt,
      postedDateSource: detailDate ? (jd.startDate ? "detail.startDate" : jd.postedOn ? "detail.postedOn" : jd.postedDate ? "detail.postedDate" : "detail.externalPostedStartDate") : job.postedDateSource,
      location: jd.location || jd.locationsText || job.location,
    };
  });
}

function greenhouseSlug(careersUrl) {
  const u = new URL(careersUrl);
  return u.pathname.split("/").filter(Boolean).pop();
}

async function scrapeGreenhouse(company, careersUrl, limiter) {
  const slug = greenhouseSlug(careersUrl);
  if (!slug) throw new Error(`Cannot parse Greenhouse slug from ${careersUrl}`);
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const data = await fetchJson(url, {}, limiter);
  const listing = (data.jobs || []).map((j) => ({
    title: j.title || "",
    company,
    location: j.location?.name || SEARCH_LOCATION,
    applyUrl: j.absolute_url || `${careersUrl}/jobs/${j.id}`,
    postedAt: toIso(j.created_at),
    postedDateSource: j.created_at ? "created_at" : (j.updated_at ? "updated_at_available_but_not_used_as_posted_date" : "unknown"),
    updatedAt: toIso(j.updated_at),
    description: htmlToText(j.content || ""),
    fullDescription: htmlToText(j.content || ""),
    source: "official_greenhouse",
  }));
  return listing.filter((j) => /software/i.test(`${j.title} ${j.fullDescription}`));
}

async function scrapeAmazon(_company, _careersUrl, limiter) {
  const base = "https://www.amazon.jobs/en/search.json";
  const url = `${base}?base_query=${encodeURIComponent(SEARCH_KEYWORD)}&loc_query=${encodeURIComponent("United States")}&sort=recent&offset=0&result_limit=50`;
  const data = await fetchJson(url, {}, limiter);
  const listing = (data.jobs || []).map((j) => ({
    title: j.title || "",
    company: "Amazon",
    location: j.normalized_location || j.location || j.city || SEARCH_LOCATION,
    applyUrl: `https://www.amazon.jobs/en/jobs/${j.id_icims || j.id}`,
    postedAt: parseRelativeDate(j.updated_time) || toIso(j.posted_date),
    postedDateSource: j.updated_time ? "updated_time" : j.posted_date ? "posted_date" : "unknown",
    description: htmlToText(j.description_short || j.description || ""),
    source: "official_amazon",
  }));
  return enrichDetails(listing, limiter, async (job) => {
    const html = await fetchText(job.applyUrl, {}, limiter);
    return { fullDescription: htmlToText(html) };
  });
}

async function scrapeMicrosoft(_company, _careersUrl, limiter) {
  const url = new URL("https://apply.careers.microsoft.com/api/pcsx/search");
  url.searchParams.set("search", SEARCH_KEYWORD);
  url.searchParams.set("location", "United States");
  url.searchParams.set("sortBy", "Date");
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "50");
  const data = await fetchJson(url.toString(), {}, limiter);
  const positions = data.data?.positions || data.operationResult?.result?.jobs || [];
  const listing = positions.map((p) => {
    const id = p.id || p.displayJobId || p.jobId;
    const path = p.positionUrl || (id ? `/careers/job/${id}` : "");
    return {
      title: p.name || p.title || "",
      company: "Microsoft",
      location: (p.standardizedLocations || p.locations || [SEARCH_LOCATION])[0],
      applyUrl: path.startsWith("http") ? path : `https://apply.careers.microsoft.com${path}`,
      postedAt: toIso(p.postedTs || p.postedDate || p.createdDate),
      postedDateSource: p.postedTs ? "postedTs" : p.postedDate ? "postedDate" : p.createdDate ? "createdDate" : "unknown",
      description: "",
      source: "official_microsoft",
      sourceId: id,
    };
  });
  return enrichDetails(listing, limiter, async (job) => {
    if (!job.sourceId) return {};
    const detail = await fetchJson(`https://apply.careers.microsoft.com/api/apply/v2/jobs/${job.sourceId}`, {}, limiter);
    const detailDate = toIso(detail.posted_date || detail.postedDate || detail.t_create);
    return { fullDescription: htmlToText(detail.job_description || detail.description || ""), postedAt: detailDate || job.postedAt, postedDateSource: detailDate ? (detail.posted_date ? "detail.posted_date" : detail.postedDate ? "detail.postedDate" : "detail.t_create") : job.postedDateSource };
  });
}

async function scrapeJpmorgan(_company, _careersUrl, limiter) {
  const base = "https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions";
  const finder = `findReqs;siteNumber=CX_1001,facetsList=LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS,limit=50,offset=0,sortBy=POSTING_DATES_DESC,keyword=${encodeURIComponent(SEARCH_KEYWORD)},locationId=300000000289738`;
  const data = await fetchJson(`${base}?onlyData=true&expand=requisitionList.secondaryLocations,flexFieldsFacet.values&finder=${finder}`, {}, limiter);
  const reqs = (data.items || []).flatMap((i) => i.requisitionList || []);
  const listing = reqs.map((r) => ({
    title: r.Title || "",
    company: "JPMorgan Chase",
    location: r.PrimaryLocation || SEARCH_LOCATION,
    applyUrl: `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${r.Id}`,
    postedAt: toIso(r.PostedDate || r.ExternalPostedStartDate),
    postedDateSource: r.PostedDate ? "PostedDate" : r.ExternalPostedStartDate ? "ExternalPostedStartDate" : "unknown",
    description: "",
    source: "official_jpmorgan",
    sourceId: r.Id,
  }));
  return enrichDetails(listing, limiter, async (job) => {
    const detail = await fetchJson(`${base}?finder=ById;Id=${encodeURIComponent(job.sourceId)},siteNumber=CX_1001&expand=all`, {}, limiter);
    const item = detail.items?.[0] || {};
    return {
      fullDescription: htmlToText([item.ExternalDescriptionStr, item.ExternalResponsibilitiesStr, item.ExternalQualificationsStr].filter(Boolean).join("\n")),
      postedAt: toIso(item.ExternalPostedStartDate || item.PostedDate) || job.postedAt,
      postedDateSource: item.ExternalPostedStartDate ? "detail.ExternalPostedStartDate" : item.PostedDate ? "detail.PostedDate" : job.postedDateSource,
      location: item.PrimaryLocation || job.location,
    };
  });
}

async function scrapeGoogle(_company, _careersUrl, limiter) {
  const url = `https://www.google.com/about/careers/applications/jobs/results/?q=${encodeURIComponent(SEARCH_KEYWORD)}&location=${encodeURIComponent(SEARCH_LOCATION)}&sort_by=date&page=1`;
  const html = await fetchText(url, {}, limiter);
  // Conservative SSR fallback: extract visible result links/titles. Details are fetched from each page when possible.
  const jobs = [];
  const re = /<a[^>]+href="([^"]*\/about\/careers\/applications\/jobs\/results\/[^"#?]+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) && jobs.length < 50) {
    const href = m[1].startsWith("http") ? m[1] : `https://www.google.com${m[1]}`;
    const title = htmlToText(m[2]);
    if (!title || seen.has(href) || !/software|engineer|developer/i.test(title)) continue;
    seen.add(href);
    jobs.push({ title, company: "Google", location: SEARCH_LOCATION, applyUrl: href, postedAt: null, postedDateSource: "unknown", description: "", source: "official_google" });
  }
  return enrichDetails(jobs, limiter, async (job) => {
    const detailHtml = await fetchText(job.applyUrl, {}, limiter);
    const text = htmlToText(detailHtml);
    const dateMatch = text.match(/(?:posted|published)\s*(?:on)?\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
    const postedAt = dateMatch ? toIso(dateMatch[1]) : null;
    return { fullDescription: text, postedAt, postedDateSource: postedAt ? "detail_text" : "unknown" };
  });
}

async function scrapeViaPlaywright(company, careersUrl, limiter) {
  let playwrightPath = "";
  try {
    playwrightPath = require.resolve("playwright");
  } catch {
    // Optional fallback dependency: the script has direct API auditors for known ATSs,
    // but JS-only unknown sites need Playwright if users choose to audit them.
  }
  if (!playwrightPath) {
    throw new Error("No direct auditor for this ATS/site and Playwright is not installed. Install with `npm i -D playwright` for JS-heavy fallback scraping.");
  }
  const { chromium } = await import("playwright");
  await limiter.wait(careersUrl);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(careersUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const searchBox = page.getByRole("textbox").first();
    if (await searchBox.count()) await searchBox.fill(SEARCH_KEYWORD);
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(3000);
    const links = await page.locator("a").evaluateAll((as) => as.slice(0, 100).map((a) => ({ text: a.textContent || "", href: a.href || "" })));
    return links
      .filter((l) => /software|engineer|developer/i.test(l.text) && l.href)
      .map((l) => ({ title: l.text.trim(), company, location: SEARCH_LOCATION, applyUrl: l.href, postedAt: null, postedDateSource: "unknown", description: "", fullDescription: "", source: "official_playwright_fallback" }));
  } finally {
    await browser.close();
  }
}

async function scrapeCompany(config, limiter) {
  const name = config.company;
  if (/^amazon$/i.test(name)) return scrapeAmazon(name, config.careersUrl, limiter);
  if (/^microsoft$/i.test(name)) return scrapeMicrosoft(name, config.careersUrl, limiter);
  if (/^google$/i.test(name)) return scrapeGoogle(name, config.careersUrl, limiter);
  if (/jpmorgan/i.test(name)) return scrapeJpmorgan(name, config.careersUrl, limiter);
  if (config.adapter === "greenhouse") return scrapeGreenhouse(name, config.careersUrl, limiter);
  if (config.adapter === "workday" || config.adapter === "walmart_v2") return scrapeWorkday(name, config.careersUrl, limiter);
  return scrapeViaPlaywright(name, config.careersUrl, limiter);
}

const DEFAULT_INDIVIDUAL_COMPANIES = new Set(["amazon", "google", "microsoft", "jpmorgan chase", "walmart"]);

function buildCompanyConfigs(args) {
  const enabledRegistry = (registryExports.COMPANY_ATS_REGISTRY || []).filter((c) => c.enabled && c.careersUrl);
  const customIndividuals = enabledRegistry.filter((c) => c.ats === "custom" || DEFAULT_INDIVIDUAL_COMPANIES.has(c.company.toLowerCase()));
  const registry = args.includeRegistry ? enabledRegistry : customIndividuals;
  const hardcoded = [
    { company: "Amazon", ats: "custom", adapter: "amazon_v2", careersUrl: "https://www.amazon.jobs/en/" },
    { company: "Google", ats: "custom", adapter: "google_v2", careersUrl: "https://www.google.com/about/careers/applications/jobs/results/" },
    { company: "Microsoft", ats: "custom", adapter: "microsoft_v2", careersUrl: "https://jobs.careers.microsoft.com/global/en/search" },
    { company: "JPMorgan Chase", ats: "oracle_hcm", adapter: "oracle_hcm", careersUrl: "https://jpmc.fa.oraclecloud.com" },
    { company: "Walmart", ats: "custom", adapter: "walmart_v2", careersUrl: "https://walmart.wd5.myworkdayjobs.com/WalmartExternal" },
  ];
  const byCompany = new Map();
  for (const c of [...registry, ...hardcoded]) byCompany.set(c.company.toLowerCase(), c);
  let configs = [...byCompany.values()].sort((a, b) => a.company.localeCompare(b.company));
  if (args.company) configs = configs.filter((c) => c.company.toLowerCase() === args.company.toLowerCase());
  if (args.maxCompanies > 0) configs = configs.slice(0, args.maxCompanies);
  return configs;
}

async function loadAppJobs(args) {
  let data;
  if (args.snapshot) {
    data = JSON.parse(fs.readFileSync(path.resolve(args.snapshot), "utf8"));
  } else {
    data = await fetchJson(args.apiUrl, {}, null);
  }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.jobs)) return data.jobs;
  if (Array.isArray(data.data)) return data.data;
  throw new Error("Could not find jobs array in API/snapshot payload");
}

function compareCompany(company, siteJobs, appJobs) {
  const appForCompany = appJobs.filter((j) => isSameCompany(j.company, company));
  const appMap = new Map(appForCompany.map((j) => [matchKey(j), j]));
  const siteMap = new Map(siteJobs.map((j) => [matchKey(j), j]));
  const matched = [];
  const missedByApp = [];
  const extraInApp = [];
  for (const [key, siteJob] of siteMap) {
    if (appMap.has(key)) matched.push({ site: siteJob, app: appMap.get(key) });
    else missedByApp.push(siteJob);
  }
  for (const [key, appJob] of appMap) {
    if (!siteMap.has(key)) extraInApp.push(appJob);
  }
  return { appCount: appForCompany.length, matched, missedByApp, extraInApp };
}

function formatJobLine(job) {
  const posted = job.postedAgeDays !== undefined ? `${job.postedAgeDays} days ago` : (job.postedDate || job.postedAt || "unknown");
  return `- ${job.title} | ${job.applyUrl || "#"} | Posted: ${posted}`;
}

function printCompany(report) {
  console.log(colors.bold(`\nCOMPANY: ${report.company}`));
  if (report.error) console.log(colors.red(`❌ Audit failed: ${report.error}`));
  if (report.warning) console.log(colors.yellow(`⚠️  ${report.warning}`));
  if (report.warnings?.length) {
    console.log(colors.yellow(`⚠️  Warnings: ${report.warnings.length}`));
    report.warnings.slice(0, 5).forEach((w) => console.log(colors.yellow(`   - ${w}`)));
  }
  console.log(colors.gray(`Fetched: ${report.fetchedCount} | Adapter-kept: ${report.adapterKeptCount} | App count: ${report.appCount}`));
  console.log(colors.green(`✅ Matched: ${report.matched.length} jobs`));
  console.log(colors.red(`❌ Missed by app (on site but not in app): ${report.missedByApp.length} jobs`));
  report.missedByApp.slice(0, 20).forEach((j) => console.log(colors.red(`   ${formatJobLine(j)}`)));
  console.log(colors.yellow(`⚠️  Extra in app (in app but not on site / may be stale): ${report.extraInApp.length} jobs`));
  report.extraInApp.slice(0, 20).forEach((j) => console.log(colors.yellow(`   - ${j.title} | ${j.applyUrl || "#"}`)));
}

function toMarkdown(summary) {
  const lines = [
    `# ResumeAI Live Jobs Audit`,
    ``,
    `Generated: ${summary.generatedAt}`,
    `Search keyword: \`${SEARCH_KEYWORD}\``,
    `Location: \`${SEARCH_LOCATION}\``,
    `Date horizon: ${MAX_AGE_DAYS} days`,
    ``,
    `## Summary`,
    ``,
    `| Company | Status | Fetched | Kept | App | Matched | Missed by app | Extra in app |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|`,
  ];
  for (const r of summary.companies) {
    lines.push(`| ${r.company} | ${r.error ? "failed" : "ok"} | ${r.fetchedCount} | ${r.adapterKeptCount} | ${r.appCount} | ${r.matched.length} | ${r.missedByApp.length} | ${r.extraInApp.length} |`);
  }
  for (const r of summary.companies) {
    lines.push(``, `## ${r.company}`, ``);
    if (r.error) lines.push(`**Error:** ${r.error}`, ``);
    if (r.warning) lines.push(`**Warning:** ${r.warning}`, ``);
    if (r.warnings?.length) {
      lines.push(`**Warnings:**`);
      r.warnings.forEach((w) => lines.push(`- ${w}`));
      lines.push(``);
    }
    lines.push(`- ✅ Matched: ${r.matched.length} jobs`);
    lines.push(`- ❌ Missed by app: ${r.missedByApp.length} jobs`);
    r.missedByApp.forEach((j) => lines.push(`  ${formatJobLine(j)}`));
    lines.push(`- ⚠️ Extra in app: ${r.extraInApp.length} jobs`);
    r.extraInApp.forEach((j) => lines.push(`  - ${j.title} | ${j.applyUrl || "#"}`));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const limiter = new RateLimiter(args.delayMs);
  const configs = buildCompanyConfigs(args);
  if (configs.length === 0) throw new Error(args.company ? `No enabled company config found for ${args.company}` : "No enabled company configs found");

  console.log(colors.cyan(`Loading app jobs from ${args.snapshot || args.apiUrl}`));
  const appJobs = await loadAppJobs(args);
  console.log(colors.cyan(`App logic: ${APP_LOGIC_STATUS}`));
  console.log(colors.cyan(`Default scope: custom individual adapters only${args.includeRegistry ? " + enabled generic registry tenants" : ""}`));
  console.log(colors.cyan(`Auditing ${configs.length} companies with keyword="${SEARCH_KEYWORD}" location="${SEARCH_LOCATION}"`));

  const companyReports = [];
  for (const config of configs) {
    const baseReport = {
      company: config.company,
      adapter: config.adapter,
      careersUrl: config.careersUrl,
      fetchedCount: 0,
      adapterKeptCount: 0,
      finalStoredCount: null,
      rejectionReasons: {},
      failures: [],
      warnings: [],
      diagnosticsVisibilityImpact: "audit-only; no app diagnostics or Supabase rows are modified",
      appCount: 0,
      matched: [],
      missedByApp: [],
      extraInApp: [],
    };
    try {
      const raw = await scrapeCompany(config, limiter);
      const filtered = applyAuditFilters(raw);
      const diff = compareCompany(config.company, filtered.jobs, appJobs);
      const report = {
        ...baseReport,
        fetchedCount: raw.length,
        adapterKeptCount: filtered.jobs.length,
        finalStoredCount: diff.appCount,
        rejectionReasons: filtered.drops,
        warnings: filtered.warnings,
        appCount: diff.appCount,
        matched: diff.matched.map((m) => ({ title: m.site.title, location: m.site.location, url: m.site.applyUrl })),
        missedByApp: diff.missedByApp,
        extraInApp: diff.extraInApp.map((j) => ({ title: j.title, location: j.location, applyUrl: j.applyUrl, postedAt: j.postedAt, source: j.source })),
      };
      companyReports.push(report);
      printCompany(report);
    } catch (err) {
      const diff = compareCompany(config.company, [], appJobs);
      const report = { ...baseReport, error: err.message, failures: [err.message], appCount: diff.appCount, extraInApp: diff.extraInApp };
      companyReports.push(report);
      printCompany(report);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    search: { keyword: SEARCH_KEYWORD, location: SEARCH_LOCATION, sort: "Most Recent / Latest", maxAgeDays: MAX_AGE_DAYS },
    scope: args.includeRegistry ? "custom individual adapters plus enabled generic registry tenants" : "custom individual adapters only",
    appLogic: APP_LOGIC_STATUS,
    auditOnly: true,
    appSource: args.snapshot ? { type: "snapshot", path: args.snapshot } : { type: "api", url: args.apiUrl },
    companies: companyReports,
  };

  if (args.dryRun) {
    console.log(colors.bold("\nDry run enabled; skipped writing audit-report.json and audit-report.md"));
    return;
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const jsonPath = path.join(args.outDir, "audit-report.json");
  const mdPath = path.join(args.outDir, "audit-report.md");
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(mdPath, toMarkdown(summary));
  console.log(colors.bold(`\nWrote ${jsonPath}`));
  console.log(colors.bold(`Wrote ${mdPath}`));
}

main().catch((err) => {
  console.error(colors.red(`audit failed: ${err.stack || err.message}`));
  process.exitCode = 1;
});

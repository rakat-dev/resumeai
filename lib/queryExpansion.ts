// ── Query Expansion Engine ──────────────────────────────────────────────────
export const TITLE_GROUPS: Record<string, string[]> = {
  core_software: [
    "software engineer","software developer","application engineer",
    "application developer","systems engineer","product engineer",
  ],
  backend: [
    "backend engineer","backend developer","back end engineer","back end developer",
    "server side engineer","api engineer","distributed systems engineer",
    "java developer","java engineer","python developer","python engineer",
    "golang engineer","golang developer","node.js developer","node.js engineer",
  ],
  frontend: [
    "frontend engineer","frontend developer","front end engineer","front end developer",
    "ui engineer","ui developer","web engineer","web developer",
    "react developer","react engineer","angular developer","angular engineer",
    "javascript developer","typescript developer",
  ],
  fullstack: [
    "full stack engineer","full stack developer",
    "fullstack engineer","fullstack developer",
  ],
  cloud_platform: [
    "cloud engineer","cloud developer","platform engineer","platform developer",
    "infrastructure engineer","systems engineer","site engineer",
  ],
  devops_sre: [
    "devops engineer","site reliability engineer","sre",
    "build engineer","release engineer","observability engineer","production engineer",
  ],
  mobile: [
    "mobile engineer","mobile developer",
    "android engineer","android developer",
    "ios engineer","ios developer","react native developer",
  ],
};

const FAMILY_MAP: Record<string,string> = {
  "software engineer":"core_software","software developer":"core_software",
  "application engineer":"core_software","application developer":"core_software",
  "systems engineer":"core_software","product engineer":"core_software",
  "backend engineer":"backend","backend developer":"backend",
  "back end engineer":"backend","back end developer":"backend",
  "java developer":"backend","java engineer":"backend",
  "python developer":"backend","python engineer":"backend",
  "golang engineer":"backend","golang developer":"backend",
  "node.js developer":"backend","node.js engineer":"backend",
  "api engineer":"backend","distributed systems engineer":"backend",
  "frontend engineer":"frontend","frontend developer":"frontend",
  "front end engineer":"frontend","front end developer":"frontend",
  "react developer":"frontend","react engineer":"frontend",
  "angular developer":"frontend","angular engineer":"frontend",
  "javascript developer":"frontend","typescript developer":"frontend",
  "ui engineer":"frontend","ui developer":"frontend",
  "web engineer":"frontend","web developer":"frontend",
  "full stack engineer":"fullstack","full stack developer":"fullstack",
  "fullstack engineer":"fullstack","fullstack developer":"fullstack",
  "cloud engineer":"cloud_platform","cloud developer":"cloud_platform",
  "platform engineer":"cloud_platform","platform developer":"cloud_platform",
  "infrastructure engineer":"cloud_platform",
  "devops engineer":"devops_sre","site reliability engineer":"devops_sre",
  "sre":"devops_sre","production engineer":"devops_sre",
  "build engineer":"devops_sre","release engineer":"devops_sre",
  "mobile engineer":"mobile","mobile developer":"mobile",
  "android engineer":"mobile","android developer":"mobile",
  "ios engineer":"mobile","ios developer":"mobile",
  "react native developer":"mobile",
};

const BROAD_TRIGGERS = new Set([
  "software engineer","software developer","developer","engineer",
  "full stack","fullstack","backend","front end","frontend","back end",
]);
const FOCUSED_TRIGGERS = new Set([
  "java developer","java engineer","python developer","python engineer",
  "backend engineer","backend developer","frontend engineer","frontend developer",
  "react developer","angular developer","cloud engineer","platform engineer",
  "devops engineer","site reliability engineer","sre",
  "golang engineer","golang developer","node.js developer",
  "full stack engineer","full stack developer","fullstack engineer",
]);
const EXACT_TRIGGERS = new Set([
  "android engineer","android developer","ios engineer","ios developer",
  "mobile engineer","mobile developer","react native developer",
]);

export type QueryMode = "broad"|"focused"|"exact";
export interface QueryExpansion {
  mode: QueryMode;
  terms: string[];
  primary: string;
  groups: string[];
}

export function expandQuery(rawQuery: string): QueryExpansion {
  const q = rawQuery.toLowerCase().trim();
  const parts = q.split(/\s*[+|]\s*/).map(t=>t.trim()).filter(Boolean);
  const primary = parts[0];

  let mode: QueryMode = "focused";
  if (EXACT_TRIGGERS.has(primary)) mode = "exact";
  else if (BROAD_TRIGGERS.has(primary)||parts.some(p=>BROAD_TRIGGERS.has(p))) mode = "broad";
  else if (FOCUSED_TRIGGERS.has(primary)) mode = "focused";
  else if (primary.includes("engineer")||primary.includes("developer")) mode = "broad";

  let terms: string[] = [];
  let groups: string[] = [];

  if (mode==="broad") {
    groups=["core_software","backend","frontend","fullstack","cloud_platform","devops_sre","mobile"];
    groups.forEach(g=>terms.push(...TITLE_GROUPS[g]));
  } else if (mode==="focused") {
    const family=FAMILY_MAP[primary];
    if (family) {
      groups=Array.from(new Set([family,"core_software"]));
      groups.forEach(g=>terms.push(...TITLE_GROUPS[g]));
    } else terms=parts;
    parts.slice(1).forEach(p=>{
      const f=FAMILY_MAP[p];
      if(f&&!groups.includes(f)){groups.push(f);terms.push(...TITLE_GROUPS[f]);}
    });
  } else {
    const family=FAMILY_MAP[primary];
    if (family) {
      groups=[family];
      const all=TITLE_GROUPS[family];
      const idx=all.findIndex(t=>t===primary);
      terms=all.slice(Math.max(0,idx-1),Math.max(0,idx-1)+4);
    } else terms=parts;
  }

  terms=Array.from(new Set(terms));
  if(terms.length===0)terms=parts;
  return{mode,terms,primary,groups};
}

export const EXCLUDE_TITLE_KEYWORDS=[
  "lead","principal","architect","manager","director",
  "vice president","vp","head","chief","distinguished","fellow",
];
export const REJECT_TITLE_KEYWORDS=[
  "data engineer","data scientist","data analyst",
  "machine learning","ml engineer","ai engineer","deep learning",
  "security engineer","cybersecurity","network engineer",
  "business analyst","scrum master","project manager",
  "recruiter","marketing","finance","legal",
  "intern","internship",
];

export function shouldExcludeTitle(title: string): boolean {
  const tl=title.toLowerCase();
  if(EXCLUDE_TITLE_KEYWORDS.some(k=>{
    const escaped=k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const regex=new RegExp(`\\b${escaped}\\b`,"i");
    return regex.test(tl);
  }))return true;
  if(REJECT_TITLE_KEYWORDS.some(k=>tl.includes(k)))return true;
  return false;
}

const SPONSORSHIP_POSITIVE=[
  "visa sponsorship","sponsor h-1b","h-1b","h1b","opt","cpt",
  "work authorization support","will sponsor","offers sponsorship",
];
const SPONSORSHIP_NEGATIVE=[
  "no sponsorship","will not sponsor","not eligible for sponsorship",
  "must be authorized to work without sponsorship","no visa support",
  "without current or future sponsorship","cannot sponsor",
];

export function scoreSponsorshipSignal(description: string): number {
  const dl=description.toLowerCase();
  if(SPONSORSHIP_NEGATIVE.some(k=>dl.includes(k)))return -20;
  if(SPONSORSHIP_POSITIVE.some(k=>dl.includes(k)))return 15;
  return 0;
}

const TITLE_SCORES: Record<string,number>={
  "software engineer":10,"software developer":10,
  "backend engineer":9,"backend developer":9,
  "full stack engineer":9,"fullstack engineer":9,
  "python developer":8,"python engineer":8,
  "java developer":8,"java engineer":8,
  "frontend engineer":8,"frontend developer":8,
  "cloud engineer":7,"platform engineer":7,"infrastructure engineer":7,
  "react developer":7,
  "devops engineer":6,"site reliability engineer":6,"sre":6,
  "mobile engineer":6,"android engineer":6,"ios engineer":6,
};

export function scoreTitleRelevance(title: string): number {
  const tl=title.toLowerCase();
  for(const[term,score]of Object.entries(TITLE_SCORES)){if(tl.includes(term))return score;}
  if(tl.includes("engineer")||tl.includes("developer"))return 5;
  return 3;
}

export function scoreRecency(postedTimestamp: number): number {
  if(!postedTimestamp)return 0;
  const ageDays=(Date.now()-postedTimestamp*1000)/86400000;
  if(ageDays<=1)return 10;
  if(ageDays<=7)return 7;
  if(ageDays<=30)return 3;
  return 0;
}

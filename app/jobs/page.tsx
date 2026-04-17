"use client";
import { useState, useEffect, useMemo } from "react";
import AppLayout from "@/components/AppLayout";
import type { Job, JobFilter, SourceDiagnostic } from "@/app/api/jobs/route";
import type { ATSResult } from "@/app/api/tailor/route";
import { downloadPDF } from "@/lib/downloadPDF";
import InterviewPanel from "@/components/InterviewPanel";
import { saveJob, unsaveJob, isJobSaved, type SavedJob } from "@/lib/savedJobs";
import { getBaseResume, saveBaseResume } from "@/lib/baseResume";


// ── Session storage (clears when tab/browser closed) ──────────────────────
const SS = { Q:"ss_rq", F:"ss_rf", J:"ss_rj", S:"ss_rs",
  SEL:"ss_sel", V1:"ss_v1", V2:"ss_v2", JD:"ss_jd",
  V1ATS:"ss_v1ats", V2ATS:"ss_v2ats", STEP:"ss_step" };

function savePanel(sel:Job|null,v1:string,v2:string,jd:string,v1ats:unknown,v2ats:unknown,step:number){
  try{
    if(sel) sessionStorage.setItem(SS.SEL,JSON.stringify(sel)); else sessionStorage.removeItem(SS.SEL);
    sessionStorage.setItem(SS.V1,v1);
    sessionStorage.setItem(SS.V2,v2);
    sessionStorage.setItem(SS.JD,jd);
    sessionStorage.setItem(SS.V1ATS,JSON.stringify(v1ats));
    sessionStorage.setItem(SS.V2ATS,JSON.stringify(v2ats));
    sessionStorage.setItem(SS.STEP,String(step));
  }catch{}
}
function loadPanel():{sel:Job|null;v1:string;v2:string;jd:string;v1ats:unknown;v2ats:unknown;step:number}|null{
  try{
    const selRaw=sessionStorage.getItem(SS.SEL);
    const v1=sessionStorage.getItem(SS.V1)||"";
    const step=parseInt(sessionStorage.getItem(SS.STEP)||"0");
    if(!selRaw||!v1||step===0)return null;
    return{
      sel:JSON.parse(selRaw),
      v1,
      v2:sessionStorage.getItem(SS.V2)||"",
      jd:sessionStorage.getItem(SS.JD)||"",
      v1ats:JSON.parse(sessionStorage.getItem(SS.V1ATS)||"null"),
      v2ats:JSON.parse(sessionStorage.getItem(SS.V2ATS)||"null"),
      step,
    };
  }catch{return null;}
}
function saveSS(f:JobFilter,jobs:Job[],src:Record<string,number>){
  try{
    sessionStorage.setItem(SS.F,f);
    // Only cache up to 500 jobs to avoid sessionStorage size limits
    sessionStorage.setItem(SS.J,JSON.stringify(jobs.slice(0,500)));
    sessionStorage.setItem(SS.S,JSON.stringify(src));
  }catch{}
}
function loadSS():{filter:JobFilter;jobs:Job[];sources:Record<string,number>}|null{
  try{
    const f=sessionStorage.getItem(SS.F) as JobFilter;
    const j=sessionStorage.getItem(SS.J),s=sessionStorage.getItem(SS.S);
    if(!j)return null;
    return{filter:f||"any",jobs:JSON.parse(j),sources:s?JSON.parse(s):{}};
  }catch{return null;}
}

// ── Filter types ───────────────────────────────────────────────────────────
type SponsorFilter = "all"|"yes"|"no_info";
type ExpFilter = "0-1yr"|"1-3yr"|"4-6yr"|"6+yr";
type SourceType = "greenhouse"|"workday"|"jsearch"|"adzuna"|"jooble"|"playwright"|"other";

interface Filters {
  datePosted: JobFilter;
  sponsorship: SponsorFilter;
  companies: Set<string>;
  sources: Set<SourceType>;
  experience: Set<ExpFilter>;
}
const DEFAULT_FILTERS:Filters={datePosted:"any",sponsorship:"all",companies:new Set(),sources:new Set(),experience:new Set()};

function countActiveFilters(f:Filters):number{
  let n=0;
  if(f.datePosted!=="any")n++;
  if(f.sponsorship!=="all")n++;
  if(f.companies.size>0)n++;
  if(f.sources.size>0)n++;
  if(f.experience.size>0)n++;
  return n;
}

// ── Diff ───────────────────────────────────────────────────────────────────
interface DiffLine{type:"added"|"removed"|"modified";old?:string;new?:string;text?:string;}
interface DiffSection{section:string;sub?:string;changes:DiffLine[];}
// ── Fortune rank + client-side sort ──────────────────────────────────────
const FORTUNE: Record<string,number> = {
  "walmart":1,"amazon":2,"apple":3,"unitedhealth":4,"microsoft":5,
  "cvs":6,"elevance":7,"at&t":8,"cigna":9,"costco":10,
  "home depot":11,"jpmorgan":12,"jpmorgan chase":12,"verizon":13,
  "meta":14,"target":15,"fedex":16,"bank of america":17,
  "wells fargo":18,"ups":19,"lowe's":20,"lowes":20,
  "morgan stanley":21,"ibm":22,"intel":23,"cisco":24,
  "oracle":25,"salesforce":26,"adobe":27,"sap":28,"workday":29,
  "servicenow":30,"atlassian":31,"nvidia":32,"capital one":33,
  "t-mobile":34,"google":35,"alphabet":35,"stripe":36,
  "databricks":37,"snowflake":38,"cloudflare":39,"mongodb":40,
  "confluent":41,"hashicorp":42,"openai":43,"anthropic":44,
  "accenture":45,"infosys":46,"cognizant":47,"tata consultancy":48,
  "tcs":48,"capgemini":49,"paypal":50,"visa":51,"mastercard":52,
};
function fortuneRank(company:string):number{
  const lc=company.toLowerCase();
  for(const [k,v] of Object.entries(FORTUNE)){if(lc===k||lc.includes(k))return v;}
  return 9999;
}
type SortOption="date_desc"|"date_asc"|"company_desc"|"company_asc"|"best_match";
function clientSort(jobs:Job[],sort:SortOption):Job[]{
  return [...jobs].sort((a,b)=>{
    const ats=(a as Job&{postedTimestamp?:number}).postedTimestamp||0;
    const bts=(b as Job&{postedTimestamp?:number}).postedTimestamp||0;
    if(sort==="date_desc") return bts-ats;
    if(sort==="date_asc") return ats-bts;
    if(sort==="company_desc"){
      // Fortune rank ascending: rank 1 (top company) first, 9999 (unknown) last
      const ra=fortuneRank(a.company),rb=fortuneRank(b.company);
      if(ra!==rb) return ra-rb;
      return bts-ats;
    }
    if(sort==="company_asc"){
      // Alphabetical A → Z
      const cmp=a.company.toLowerCase().localeCompare(b.company.toLowerCase());
      return cmp!==0?cmp:bts-ats;
    }
    // Best Match: relevanceScore desc then recency
    const sa=(a as Job&{relevanceScore?:number}).relevanceScore||0;
    const sb=(b as Job&{relevanceScore?:number}).relevanceScore||0;
    return sb!==sa?sb-sa:bts-ats;
  });
}

// ── Grouped view for Top Companies sort ──────────────────────────────────
// When sort === "company_desc", results are rendered as collapsible
// dropdowns: one per top-15 company, plus a "Remaining Jobs" dropdown
// with a summary card listing the rest.
const TOP_COMPANY_GROUP_LIMIT = 15;

type CompanyGroup = {
  type: "company_group";
  company: string;
  count: number;
  jobs: Job[];
};
type RemainingGroup = {
  type: "remaining_group";
  title: string;
  count: number;
  jobs: Job[];
  companiesSummary: { company: string; count: number }[];
};
// No-date Tier A companies (Google etc.). Always pinned at top of board.
// Inside the dropdown, jobs sort by positionRank ASC.
type NoDateCompanyGroup = {
  type: "no_date_company_group";
  company: string;
  count: number;
  jobs: Job[];
};
// GroupedView only used by sort==="company_desc" path through buildGroupedView.
// NoDateCompanyGroup is rendered separately via the noDateGroups variable.
type GroupedView = (CompanyGroup | RemainingGroup)[];

// ── Time filter → max positionRank for no-date jobs ────────────────────
// Jobs with positionRank are surfaced via a per-company dropdown instead of
// flat cards — they have no real posted_at to compare against the time
// filter. Trim by rank as a synthetic recency proxy.
function rankFractionFor(filter: JobFilter): number {
  if (filter === "24h") return 0.25;
  if (filter === "3d")  return 0.5;
  if (filter === "7d")  return 0.75;
  return 1.0;
}

function normalizeCompany(c: string | null | undefined): string {
  const trimmed = (c ?? "").trim();
  return trimmed || "Unknown Company";
}

function buildGroupedView(sortedJobs: Job[]): GroupedView {
  // Preserve sort order: first appearance of each company wins
  const orderedCompanies: string[] = [];
  const byCompany = new Map<string, Job[]>();
  for (const j of sortedJobs) {
    const c = normalizeCompany(j.company);
    if (!byCompany.has(c)) { byCompany.set(c, []); orderedCompanies.push(c); }
    byCompany.get(c)!.push(j);
  }

  // Inside every group, cards are sorted by date posted (newest first).
  // Group ORDER itself is unchanged — it reflects the outer sort
  // (Fortune rank asc for Top Companies).
  //
  // null/0 timestamps render as "Recently" in the UI. These are jobs whose
  // source didn't expose a posted_at date — they were JUST scraped though,
  // so treat them as newest (+Infinity) rather than oldest. Otherwise a
  // freshly-ingested job lands below a 3-week-old dated one.
  const byDateDesc = (a: Job, b: Job) => {
    const rawA = (a as Job & {postedTimestamp?: number}).postedTimestamp;
    const rawB = (b as Job & {postedTimestamp?: number}).postedTimestamp;
    const at = rawA && rawA > 0 ? rawA : Infinity;
    const bt = rawB && rawB > 0 ? rawB : Infinity;
    if (at === Infinity && bt === Infinity) return 0;
    if (at === Infinity) return -1;
    if (bt === Infinity) return  1;
    return bt - at;
  };
  for (const c of orderedCompanies) {
    byCompany.get(c)!.sort(byDateDesc);
  }

  const top = orderedCompanies.slice(0, TOP_COMPANY_GROUP_LIMIT);
  const rest = orderedCompanies.slice(TOP_COMPANY_GROUP_LIMIT);

  const view: GroupedView = top.map(c => ({
    type: "company_group",
    company: c,
    count: byCompany.get(c)!.length,
    jobs: byCompany.get(c)!,
  }));

  if (rest.length > 0) {
    const restJobs: Job[] = [];
    const summary: { company: string; count: number }[] = [];
    for (const c of rest) {
      const jobs = byCompany.get(c)!;
      restJobs.push(...jobs);
      summary.push({ company: c, count: jobs.length });
    }
    // Sort summary by count desc so heaviest remaining companies sit on top
    summary.sort((a, b) => b.count - a.count);
    // Remaining group is one combined card list — sort those by date too,
    // so the newest jobs across all remaining companies surface first.
    restJobs.sort(byDateDesc);
    view.push({
      type: "remaining_group",
      title: "Remaining Jobs",
      count: restJobs.length,
      jobs: restJobs,
      companiesSummary: summary,
    });
  }

  return view;
}

// ── Build no-date company groups (always pinned at top) ───────────────────
// Walks the input jobs, splits out any with positionRank set, groups them
// per company, sorts each group by rank ASC, and trims by rankCutoff.
// Returns BOTH the no-date groups AND the remaining (dated) jobs.
function buildNoDateGroups(
  allJobs: Job[],
  rankFraction: number,   // 0.25 | 0.5 | 0.75 | 1.0 based on date filter
): { noDateGroups: NoDateCompanyGroup[]; datedJobs: Job[] } {
  const datedJobs: Job[] = [];
  const byCompany = new Map<string, Job[]>();
  const orderedCompanies: string[] = [];
  for (const j of allJobs) {
    const rank = (j as Job & { positionRank?: number }).positionRank;
    if (typeof rank === "number" && rank > 0) {
      // Don't apply rankCutoff here — always collect ALL no-date jobs.
      // We trim inside the group below after sorting, so the dropdown
      // always appears (never vanishes on date filter).
      const c = normalizeCompany(j.company);
      if (!byCompany.has(c)) { byCompany.set(c, []); orderedCompanies.push(c); }
      byCompany.get(c)!.push(j);
    } else {
      datedJobs.push(j);
    }
  }
  // Sort each group by rank ASC (1 first, 120 last)
  for (const c of orderedCompanies) {
    byCompany.get(c)!.sort((a, b) => {
      const ra = (a as Job & { positionRank?: number }).positionRank ?? 9999;
      const rb = (b as Job & { positionRank?: number }).positionRank ?? 9999;
      return ra - rb;
    });
  }
  // Companies with the most jobs first — Google with 120 outranks future
  // Tier A no-date companies that may have fewer.
  orderedCompanies.sort((a, b) => byCompany.get(b)!.length - byCompany.get(a)!.length);
  const noDateGroups: NoDateCompanyGroup[] = orderedCompanies.map(c => {
    const all = byCompany.get(c)!;
    // Trim by fraction AFTER sorting: 24h=1/4, 3d=1/2, 7d=3/4, any=all.
    // Math.ceil so at minimum 1 job always shows.
    const trimCount = Math.max(1, Math.ceil(all.length * rankFraction));
    const trimmed = all.slice(0, trimCount);
    const renumbered = trimmed.map((j, idx) => ({
      ...j,
      positionRank: idx + 1,
    })) as Job[];
    return {
      type: "no_date_company_group" as const,
      company: c,
      count: renumbered.length,
      jobs: renumbered,
    };
  });
  return { noDateGroups, datedJobs };
}

function wordOverlap(a:string,b:string):number{
  const wa=new Set(a.toLowerCase().split(/\s+/));
  const wb=b.toLowerCase().split(/\s+/);
  return wb.filter(w=>wa.has(w)).length/Math.max(wa.size,wb.length);
}
function getSectionName(line:string):string|null{
  const SECS=["SUMMARY","SKILLS","PROFESSIONAL EXPERIENCE","EXPERIENCE","EDUCATION","PROJECTS"];
  const u=line.trim().toUpperCase();
  return SECS.find(s=>u===s||u.startsWith(s))||null;
}
function computeDiff(original:string,modified:string):DiffSection[]{
  const oL=original.split("\n").map(l=>l.trim()).filter(Boolean);
  const mL=modified.split("\n").map(l=>l.trim()).filter(Boolean);
  const sections:DiffSection[]=[];
  let curSec="GENERAL",curSub:string|undefined,oIdx=0;
  const getOrCreate=(sec:string,sub?:string)=>{
    let s=sections.find(s=>s.section===sec&&s.sub===sub);
    if(!s){s={section:sec,sub,changes:[]};sections.push(s);}
    return s;
  };
  for(let mIdx=0;mIdx<mL.length;mIdx++){
    const mLine=mL[mIdx];
    const sec=getSectionName(mLine);
    if(sec){curSec=sec;curSub=undefined;oIdx=oL.findIndex((l,i)=>i>=oIdx&&getSectionName(l)===sec)+1||oIdx;continue;}
    if(!mLine.startsWith("•")&&!mLine.startsWith("-")&&mLine.length>5&&mLine.length<80){curSub=mLine;}
    const oMatch=oL.findIndex((l,i)=>i>=Math.max(0,oIdx-2)&&l===mLine);
    if(oMatch>=0){for(let i=oIdx;i<oMatch;i++){if(!getSectionName(oL[i])&&oL[i]!==mLine)getOrCreate(curSec,curSub).changes.push({type:"removed",text:oL[i]});}oIdx=oMatch+1;}
    else{
      let bestMatch=-1,bestScore=0;
      for(let i=Math.max(0,oIdx-1);i<Math.min(oL.length,oIdx+3);i++){const sc=wordOverlap(oL[i],mLine);if(sc>0.4&&sc>bestScore){bestScore=sc;bestMatch=i;}}
      if(bestMatch>=0){getOrCreate(curSec,curSub).changes.push({type:"modified",old:oL[bestMatch],new:mLine});oIdx=bestMatch+1;}
      else getOrCreate(curSec,curSub).changes.push({type:"added",text:mLine});
    }
  }
  return sections.filter(s=>s.changes.length>0);
}

// ── DiffCard ───────────────────────────────────────────────────────────────
function DiffCard({original,modified,label}:{original:string;modified:string;label:string}){
  const [open,setOpen]=useState(false);
  const diff=computeDiff(original,modified);
  const total=diff.reduce((a,s)=>a+s.changes.length,0);
  if(total===0)return null;
  return(
    <div style={{border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginTop:10}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 13px",cursor:"pointer",background:"var(--surface2)",userSelect:"none"}}>
        <span style={{fontSize:12,fontWeight:600,fontFamily:"'Syne',sans-serif"}}>📝 {label} <span style={{fontSize:10,color:"var(--muted)",fontWeight:400}}>({total} changes)</span></span>
        <span style={{fontSize:11,color:"var(--muted)"}}>{open?"▲":"▼"}</span>
      </div>
      {open&&<div style={{padding:"10px 13px",display:"flex",flexDirection:"column",gap:8,maxHeight:280,overflowY:"auto"}}>
        {diff.map((sec,si)=>(
          <div key={si}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"var(--accent)",marginBottom:3}}>{sec.section}{sec.sub?` › ${sec.sub.slice(0,35)}`:""}</div>
            {sec.changes.map((c,ci)=>(
              <div key={ci} style={{fontSize:10,lineHeight:1.5,marginBottom:2,paddingLeft:7,borderLeft:`2px solid ${c.type==="added"?"#00e5b0":c.type==="removed"?"#ff6b6b":"#ff9500"}`}}>
                {c.type==="added"&&<span style={{color:"#00e5b0"}}>+ {c.text}</span>}
                {c.type==="removed"&&<span style={{color:"#ff6b6b"}}>- {c.text}</span>}
                {c.type==="modified"&&<div><div style={{color:"#ff6b6b"}}>- {c.old}</div><div style={{color:"#ff9500",marginTop:1}}>~ {c.new}</div></div>}
              </div>
            ))}
          </div>
        ))}
      </div>}
    </div>
  );
}

// ── ATSDropdown ────────────────────────────────────────────────────────────
function ATSDropdown({ats,onImprove,improving}:{ats:ATSResult;onImprove:()=>void;improving:boolean}){
  const [open,setOpen]=useState(false);
  const color=ats.score>=80?"#00e5b0":ats.score>=60?"#6c63ff":"#ff6b6b";
  const label=ats.score>=80?"Strong Match":ats.score>=60?"Good Match":"Needs Work";
  return(
    <div style={{border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginTop:10}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 13px",cursor:"pointer",background:"var(--surface2)",userSelect:"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17,color}}>{ats.score}</span>
          <div><div style={{fontSize:12,fontWeight:700,color}}>ATS — {label}</div><div style={{fontSize:10,color:"var(--muted)"}}>Click to {open?"hide":"expand"}</div></div>
        </div>
        <span style={{fontSize:11,color:"var(--muted)"}}>{open?"▲":"▼"}</span>
      </div>
      {open&&<div style={{padding:"10px 13px",display:"flex",flexDirection:"column",gap:10}}>
        {ats.matched.length>0&&<div>
          <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:4}}>✅ Matched</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{ats.matched.map((k,i)=><span key={i} style={{fontSize:10,padding:"2px 7px",borderRadius:100,background:"rgba(0,229,176,0.1)",color:"#00e5b0",border:"1px solid rgba(0,229,176,0.3)"}}>{k}</span>)}</div>
        </div>}
        {ats.missing.length>0&&<div>
          <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:4}}>⚠️ Missing</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{ats.missing.map((k,i)=><span key={i} style={{fontSize:10,padding:"2px 7px",borderRadius:100,background:"rgba(255,107,107,0.1)",color:"#ff6b6b",border:"1px solid rgba(255,107,107,0.3)"}}>{k}</span>)}</div>
        </div>}
        {ats.suggestions.length>0&&<div>
          <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:4}}>💡 Suggestions</div>
          {ats.suggestions.map((s,i)=><div key={i} style={{fontSize:10,color:"var(--text)",background:"var(--surface2)",borderRadius:7,padding:"7px 10px",borderLeft:"2px solid var(--accent)",marginBottom:4,lineHeight:1.5}}>{s}</div>)}
          <button onClick={onImprove} disabled={improving} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"9px",borderRadius:9,border:"none",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:12,cursor:improving?"not-allowed":"pointer",background:"var(--accent2)",color:"#0a0a0f",opacity:improving?0.6:1,marginTop:2}}>
            {improving?<><span className="spinner dark"/>Improving...</>:"🚀 Improve Resume"}
          </button>
        </div>}
      </div>}
    </div>
  );
}

// ── Filters Modal ──────────────────────────────────────────────────────────
interface FiltersModalProps{
  open:boolean; onClose:()=>void;
  filters:Filters; onSave:(f:Filters)=>void;
  allJobs:Job[];
  sources:Record<string,number>;
}
function FiltersModal({open,onClose,filters,onSave,allJobs,sources}:FiltersModalProps){
  const [draft,setDraft]=useState<Filters>(filters);
  useEffect(()=>{if(open)setDraft(filters);},[open,filters]);

  const allCompanies=useMemo(()=>Array.from(new Set(allJobs.map(j=>j.company).filter(Boolean))).sort(),[allJobs]);
  const allSources:SourceType[]=["greenhouse","workday","playwright","jsearch","adzuna","jooble"];
  const expOptions:ExpFilter[]=["0-1yr","1-3yr","4-6yr","6+yr"];
  const expLabels:Record<ExpFilter,string>={"0-1yr":"0–1 year","1-3yr":"1–3 years","4-6yr":"4–6 years","6+yr":"6+ years"};

  const toggle=(set:Set<string>,val:string)=>{const s=new Set(set);s.has(val)?s.delete(val):s.add(val);return s;};

  if(!open)return null;
  return(
    <div style={{position:"fixed",inset:0,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
      {/* Backdrop */}
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.6)"}}/>
      {/* Modal */}
      <div style={{position:"relative",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:20,width:"min(520px,95vw)",maxHeight:"85vh",display:"flex",flexDirection:"column",overflow:"hidden",zIndex:1}}>
        {/* Header */}
        <div style={{padding:"18px 22px 12px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17}}>⚙️ Filter Jobs</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:18}}>✕</button>
        </div>

        {/* Body */}
        <div style={{overflowY:"auto",padding:"16px 22px",display:"flex",flexDirection:"column",gap:20}}>

          {/* Date Posted */}
          <div>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",marginBottom:8}}>📅 Date Posted</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {(["any","24h","3d","7d"] as JobFilter[]).map(v=>(
                <button key={v} onClick={()=>setDraft(d=>({...d,datePosted:v}))}
                  style={{padding:"6px 14px",borderRadius:100,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",background:draft.datePosted===v?"var(--accent)":"var(--surface2)",color:draft.datePosted===v?"#fff":"var(--muted)"}}>
                  {v==="any"?"All":v==="24h"?"Last 24 hours":v==="3d"?"Last 3 days":"Last week"}
                </button>
              ))}
            </div>
          </div>

          {/* Experience */}
          <div>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",marginBottom:8}}>⏱ Experience Required</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {expOptions.map(v=>(
                <button key={v} onClick={()=>setDraft(d=>({...d,experience:toggle(d.experience as Set<string>,v) as Set<ExpFilter>}))}
                  style={{padding:"6px 14px",borderRadius:100,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",background:draft.experience.has(v)?"var(--accent)":"var(--surface2)",color:draft.experience.has(v)?"#fff":"var(--muted)"}}>
                  {expLabels[v]}
                </button>
              ))}
            </div>
          </div>

          {/* Sponsorship */}
          <div>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",marginBottom:8}}>🛂 Sponsorship</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {([["all","All"],["yes","✅ Sponsors Visa"],["no_info","❓ No Info"]] as [SponsorFilter,string][]).map(([v,l])=>(
                <button key={v} onClick={()=>setDraft(d=>({...d,sponsorship:v}))}
                  style={{padding:"6px 14px",borderRadius:100,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",background:draft.sponsorship===v?"var(--accent)":"var(--surface2)",color:draft.sponsorship===v?"#fff":"var(--muted)"}}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Source */}
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)"}}>🌐 Source</div>
              <button onClick={()=>setDraft(d=>({...d,sources:d.sources.size===allSources.length?new Set():new Set(allSources)}))}
                style={{fontSize:11,color:"var(--accent)",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>
                {draft.sources.size===allSources.length?"Deselect All":"Select All"}
              </button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {allSources.map(s=>{
                const srcCount=sources[s===("other" as string)?"other":s]||0;
                const srcLabelMap:Record<string,string>={greenhouse:"Greenhouse (ATS)",workday:"Workday (20 cos)",playwright:"Playwright (Tier A)",jsearch:"JSearch (fallback)",adzuna:"Adzuna (backup)",jooble:"Jooble (gap filler)"};
const label=srcLabelMap[s]||s;
                const SC:Record<string,string>={jsearch:"#7070a0",greenhouse:"#00c864",lever:"#0096ff",remotive:"#9664ff",theirstack:"#ff8c00",fantasticjobs:"#00c8b4",other:"#7070a0"};
                const dotColor=SC[s]||"#7070a0";
                return (
                <label key={s} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"8px 12px",borderRadius:10,background:draft.sources.has(s)?"rgba(108,99,255,0.08)":"var(--surface2)",border:`1px solid ${draft.sources.has(s)?"var(--accent)":"var(--border)"}`}}>
                  <input type="checkbox" checked={draft.sources.has(s)} onChange={()=>setDraft(d=>({...d,sources:toggle(d.sources as Set<string>,s) as Set<SourceType>}))} style={{accentColor:"var(--accent)"}}/>
                  <span style={{width:8,height:8,borderRadius:"50%",background:dotColor,flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--text)",flex:1}}>{label}</span>
                  {srcCount>0&&<span style={{fontSize:11,color:dotColor,fontWeight:600,background:`${dotColor}18`,padding:"1px 7px",borderRadius:100}}>{srcCount}</span>}
                </label>
                );
              })}
            </div>
          </div>

          {/* Company */}
          {allCompanies.length>0&&<div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)"}}>🏢 Company</div>
              <button onClick={()=>setDraft(d=>({...d,companies:d.companies.size===allCompanies.length?new Set():new Set(allCompanies)}))}
                style={{fontSize:11,color:"var(--accent)",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>
                {draft.companies.size===allCompanies.length?"Deselect All":"Select All"}
              </button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:200,overflowY:"auto"}}>
              {allCompanies.map(c=>(
                <label key={c} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"7px 10px",borderRadius:8,background:draft.companies.has(c)?"rgba(108,99,255,0.08)":"var(--surface2)",border:`1px solid ${draft.companies.has(c)?"var(--accent)":"var(--border)"}`}}>
                  <input type="checkbox" checked={draft.companies.has(c)} onChange={()=>setDraft(d=>({...d,companies:toggle(d.companies,c)}))} style={{accentColor:"var(--accent)"}}/>
                  <span style={{fontSize:12,color:"var(--text)"}}>{c}</span>
                </label>
              ))}
            </div>
          </div>}
        </div>

        {/* Footer */}
        <div style={{padding:"14px 22px",borderTop:"1px solid var(--border)",display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={()=>{setDraft(DEFAULT_FILTERS);}}
            style={{padding:"9px 18px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13}}>
            Clear All
          </button>
          <button onClick={onClose}
            style={{padding:"9px 18px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",color:"var(--text)",cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13}}>
            Close
          </button>
          <button onClick={()=>{onSave(draft);onClose();}}
            style={{padding:"9px 22px",borderRadius:10,border:"none",background:"var(--accent)",color:"#fff",cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13}}>
            Save Filters
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function SourceBadge({source,sourceType}:{source:string;sourceType?:string}){
  const C:Record<string,{bg:string;color:string}>={greenhouse:{bg:"rgba(0,200,100,0.1)",color:"#00c864"},workday:{bg:"rgba(207,69,0,0.1)",color:"#cf4500"},playwright:{bg:"rgba(108,99,255,0.1)",color:"#6c63ff"},jsearch:{bg:"rgba(112,112,160,0.1)",color:"#7070a0"},adzuna:{bg:"rgba(0,200,180,0.1)",color:"#00c8b4"},jooble:{bg:"rgba(255,149,0,0.1)",color:"#ff9500"},other:{bg:"rgba(112,112,160,0.1)",color:"#7070a0"}};
  const c=C[sourceType||"other"]||C.other;
  return <span style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:c.bg,color:c.color,border:`1px solid ${c.color}40`}}>{source}</span>;
}
function GapSkills({skills}:{skills:string[]}){
  if(!skills||skills.length===0)return null;
  return(
    <div style={{marginTop:8}}>
      <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"#ff9500",fontWeight:600,marginBottom:4}}>⚠️ Skills you&apos;re missing</div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{skills.map((s,i)=><span key={i} style={{fontSize:11,padding:"2px 8px",borderRadius:100,background:"rgba(255,149,0,0.1)",color:"#ff9500",border:"1px solid rgba(255,149,0,0.35)",fontWeight:500}}>{s}</span>)}</div>
    </div>
  );
}

const S={
  card:{background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:18} as React.CSSProperties,
  tag:{fontSize:11,padding:"3px 9px",borderRadius:100,background:"var(--surface2)",color:"var(--muted)",border:"1px solid var(--border)"} as React.CSSProperties,
  btn:(bg:string,color:string,small=false)=>({display:"inline-flex",alignItems:"center",gap:7,padding:small?"7px 14px":"12px 22px",borderRadius:11,fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:small?12:14,cursor:"pointer",border:"none",background:bg,color,transition:"all .2s"} as React.CSSProperties),
};

// ── Main ───────────────────────────────────────────────────────────────────
export default function JobsPage(){
  const [jobs,setJobs]=useState<Job[]>([]);
  const [sources,setSources]=useState<Record<string,number>>({});
  const [diagnostics,setDiagnostics]=useState<SourceDiagnostic[]>([]);
  const [diagOpen,setDiagOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [loadErr,setLoadErr]=useState("");
  const [totalJobs,setTotalJobs]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const [refreshMsg,setRefreshMsg]=useState("");
  const [displayLimit,setDisplayLimit]=useState(50); // start with 50, load more on demand

  const [filters,setFilters]=useState<Filters>(DEFAULT_FILTERS);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [sort,setSort]=useState<SortOption>("best_match");

  const [selected,setSelected]=useState<Job|null>(null);
  const [resume,setResume]=useState("");
  const [resumeEditing,setResumeEditing]=useState(false);
  const [resumeSaved,setResumeSaved]=useState(false);
  const [v1Resume,setV1Resume]=useState("");
  const [v2Resume,setV2Resume]=useState("");
  const [v1Ats,setV1Ats]=useState<ATSResult|null>(null);
  const [v2Ats,setV2Ats]=useState<ATSResult|null>(null);
  const [tailoring,setTailoring]=useState(false);
  const [improving,setImproving]=useState(false);
  const [tailorErr,setTailorErr]=useState("");
  const [improveErr,setImproveErr]=useState("");
  const [step,setStep]=useState<0|1|2>(0);
  const [copied,setCopied]=useState(false);
  const [panelCollapsed,setPanelCollapsed]=useState(false);
  const [jd,setJd]=useState("");


  // Load jobs from DB on mount (stored-search model)
  useEffect(()=>{
    setResume(getBaseResume());
    const panel=loadPanel();
    if(panel){
      setSelected(panel.sel);setV1Resume(panel.v1);setV2Resume(panel.v2 as string);
      setJd(panel.jd);setV1Ats(panel.v1ats as ATSResult|null);
      setV2Ats(panel.v2ats as ATSResult|null);setStep(panel.step as 0|1|2);
    }
    // Always fetch fresh from DB (don't trust stale sessionStorage cache)
    sessionStorage.removeItem(SS.J); // clear old cache
    loadJobs(filters.datePosted,sort);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // ── Load jobs from DB ──────────────────────────────────────────────────
  const loadJobs=async(dateFilter:JobFilter,sortOpt:SortOption)=>{
    setLoading(true);setLoadErr("");setDisplayLimit(50);setTotalJobs(0);
    try{
      const res=await fetch(`/api/jobs?filter=${dateFilter}&sort=${sortOpt}`);
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      const nj=(data.jobs as Job[])||[];
      const ns=(data.sources as Record<string,number>)||{};
      const nd=((data.sourceDiagnostics||[]) as SourceDiagnostic[]);
      setJobs(nj);setSources(ns);setDiagnostics(nd);
      setTotalJobs(nj.length); // use actual fetched count, not data.total which can be stale
      saveSS(dateFilter,nj,ns);
      if(nj.length===0)setLoadErr(data.message||"No jobs in DB yet — click \"Refresh Now\" to ingest jobs.");
    }catch(e:unknown){setLoadErr(e instanceof Error?e.message:"Failed to load jobs.");}
    setLoading(false);
  };

  // ── Trigger background refresh ────────────────────────────────────────
  const handleRefresh=async(source="all")=>{
    setRefreshing(true);setRefreshMsg("");
    try{
      const res=await fetch("/api/jobs/refresh",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({source}),
      });
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
      const upserted = data.jobs_upserted_this_run ?? data.jobs_stored ?? 0;
      const dbTotal  = data.board_db_total ?? "?";
      const secs     = Math.round(data.duration_ms/1000);
      setRefreshMsg(`✅ Refresh done (${secs}s) — ${upserted} rows upserted this run • ${dbTotal} active rows in DB`);
      // Reload jobs after refresh
      await loadJobs(filters.datePosted,sort);
    }catch(e:unknown){
      setRefreshMsg(`❌ ${e instanceof Error?e.message:"Refresh failed"}`);
    }
    setRefreshing(false);
    setTimeout(()=>setRefreshMsg(""),8000);
  };

  // ── Client-side filtering ─────────────────────────────────────────────
  const {filteredJobs,visibleJobs,groupedView,noDateGroups}=useMemo(()=>{
    let list=jobs;

    // Apply non-date filters FIRST. The date-filter only affects dated jobs;
    // no-date jobs are filtered separately by rank cutoff below.
    if(filters.sponsorship==="yes")list=list.filter(j=>(j as Job&{sponsorshipTag?:string}).sponsorshipTag==="mentioned");
    if(filters.sponsorship==="no_info")list=list.filter(j=>(j as Job&{sponsorshipTag?:string}).sponsorshipTag!=="mentioned");
    if(filters.companies.size>0)list=list.filter(j=>filters.companies.has(j.company));
    if(filters.sources.size>0)list=list.filter(j=>filters.sources.has((j as Job&{sourceType?:string}).sourceType as SourceType||"other"));

    if(filters.experience.size>0){
      list=list.filter(j=>{
        const exp=(j as Job&{experience?:string}).experience;
        if(!exp) return true;
        return filters.experience.has(exp as ExpFilter);
      });
    }

    // Split: no-date (positionRank set) jobs go into per-company dropdowns
    // pinned at top; dated jobs go through the normal sort + filter path.
    const cutoff = rankFractionFor(filters.datePosted);
    const { noDateGroups, datedJobs } = buildNoDateGroups(list, cutoff);

    // Date-filter applies only to dated jobs.
    let datedFiltered = datedJobs;
    if(filters.datePosted!=="any"){
      const now=Date.now();
      const cutoffs:Record<string,number>={"24h":now-86400000,"3d":now-259200000,"7d":now-604800000};
      const dCutoff=cutoffs[filters.datePosted];
      if(dCutoff) datedFiltered=datedFiltered.filter(j=>{
        const ts=(j as Job&{postedTimestamp?:number}).postedTimestamp;
        if(!ts)return false;
        return ts*1000>=dCutoff;
      });
    }

    const sorted=clientSort(datedFiltered,sort);
    // company_desc sort gets the existing top-15 + remaining groupings;
    // other sorts use a flat list.
    const groupedView=sort==="company_desc"?buildGroupedView(sorted):null;

    // For the user-visible "filteredJobs" count in the header strip, include
    // both no-date (after cutoff) and dated (after date filter).
    const totalFiltered = noDateGroups.reduce((s,g)=>s+g.count,0) + sorted.length;
    // Synthesize a "filteredJobs" array that just exposes the count via .length
    // for the existing UI consumer. Real rendering uses noDateGroups + sorted.
    const filteredJobs = sorted; // length used for the "Load More" math
    return{filteredJobs,visibleJobs:sorted.slice(0,displayLimit),groupedView,noDateGroups,totalFilteredCount:totalFiltered};
  },[jobs,filters,sort,displayLimit]);

  const activeFilterCount=countActiveFilters(filters);
  const currentResume=step===2?v2Resume:v1Resume;
  const currentAts=step===2?v2Ats:v1Ats;

  // Re-load when filter or sort changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(jobs.length>0||loading)loadJobs(filters.datePosted,sort);},[filters.datePosted,sort]);

  const handleSaveResume=()=>{
    saveBaseResume(resume);
    setResumeEditing(false);
    setResumeSaved(true);
    setTimeout(()=>setResumeSaved(false),2000);
  };

  // ── Tailor ────────────────────────────────────────────────────────────────
  const handleTailor=async(job:Job)=>{
    setSelected(job);setTailoring(true);setV1Resume("");setV2Resume("");setV1Ats(null);setV2Ats(null);setStep(0);setTailorErr("");setImproveErr("");setJd(job.description);
    try{
      const res=await fetch("/api/tailor",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({resume,jobDescription:job.description,jobTitle:job.title,company:job.company})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Tailoring failed");
      setV1Resume(data.tailored);setV1Ats(data.ats||null);setStep(1);
    }catch(e:unknown){setTailorErr(e instanceof Error?e.message:"Tailoring failed");}
    setTailoring(false);
  };

  // Save panel state to sessionStorage whenever it changes (fix tab switching)
  useEffect(()=>{
    if(step>0) savePanel(selected,v1Resume,v2Resume,jd,v1Ats,v2Ats,step);
  },[selected,v1Resume,v2Resume,jd,v1Ats,v2Ats,step]);

  // ── Improve ───────────────────────────────────────────────────────────────
  const handleImprove=async()=>{
    if(!v1Ats?.suggestions?.length)return;
    setImproving(true);setV2Resume("");setV2Ats(null);setImproveErr("");
    try{
      const res=await fetch("/api/apply-suggestions",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({resume:v1Resume,suggestions:v1Ats.suggestions,jobDescription:jd,
          constraint:"Apply maximum 2-3 natural keyword insertions only. Do not fabricate experience or skills not in original resume."})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Failed");
      setV2Resume(data.improved);setV2Ats(data.ats||null);setStep(2);
    }catch(e:unknown){setImproveErr(e instanceof Error?e.message:"Failed");}
    setImproving(false);
  };

  const handleCopy=()=>{navigator.clipboard.writeText(currentResume);setCopied(true);setTimeout(()=>setCopied(false),2000);};

  return(
    <AppLayout>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,marginBottom:2}}>💼 Job Board</h1>
          <p style={{color:"var(--muted)",fontSize:13}}>
            {loading?"Loading...":jobs.length>0?`${jobs.length.toLocaleString()} stored jobs — Greenhouse, Workday, Playwright, JSearch, Adzuna, Jooble`:"No jobs yet — run a refresh"}
          </p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>handleRefresh("all")} disabled={refreshing}
            style={{...S.btn(refreshing?"var(--surface2)":"var(--accent2)","#0a0a0f"),opacity:refreshing?0.6:1,cursor:refreshing?"not-allowed":"pointer",fontSize:13}}>
            {refreshing?<><span className="spinner dark"/>Refreshing...</>:"🔄 Refresh Now"}
          </button>
          <button onClick={()=>setFiltersOpen(true)}
            style={{...S.btn("var(--surface2)","var(--text)"),border:"1px solid var(--border)",position:"relative",fontSize:13}}>
            ⚙️ Filters
            {activeFilterCount>0&&<span style={{position:"absolute",top:-6,right:-6,background:"var(--accent)",color:"#fff",borderRadius:"50%",width:18,height:18,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{activeFilterCount}</span>}
          </button>
          <select value={sort} onChange={e=>setSort(e.target.value as typeof sort)}
            style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"9px 12px",color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",cursor:"pointer"}}>
            <option value="best_match">🏆 Best Match</option>
            <option value="date_desc">🕐 Date Posted</option>
            <option value="company_desc">🏢 Top Companies</option>
          </select>
        </div>
      </div>
      {/* Refresh feedback */}
      {refreshMsg&&<div style={{background:refreshMsg.startsWith("✅")?"rgba(0,200,100,0.1)":"rgba(255,107,107,0.1)",border:`1px solid ${refreshMsg.startsWith("✅")?"rgba(0,200,100,0.3)":"rgba(255,107,107,0.3)"}`,borderRadius:10,padding:"9px 14px",fontSize:12,marginBottom:10,color:refreshMsg.startsWith("✅")?"#00c864":"var(--accent3)"}}>{refreshMsg}</div>}

      {/* Results count + source breakdown */}
      {jobs.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:6}}>
            <span style={{fontSize:12,color:"var(--muted)",marginRight:4}}>{filteredJobs.length + noDateGroups.reduce((s,g)=>s+g.count,0)} jobs{(filteredJobs.length + noDateGroups.reduce((s,g)=>s+g.count,0))!==jobs.length?` (filtered from ${jobs.length})`:""}</span>
            {(diagnostics.length>0
              ? diagnostics
              : Object.entries(sources).map(([k,v])=>({source:k,postFilterCount:v,status:v>0?"success":"degraded",rawCount:v,called:true,error:null} as SourceDiagnostic))
            ).map(d=>{
              const COL:Record<string,string>={greenhouse:"#00c864",workday:"#cf4500",playwright:"#6c63ff",jsearch:"#7070a0",adzuna:"#00c8b4",jooble:"#ff9500"};
              const LBL:Record<string,string>={greenhouse:"Greenhouse",workday:"Workday",playwright:"Playwright",jsearch:"JSearch",adzuna:"Adzuna",jooble:"Jooble"};
              const col=COL[d.source]||"#888";
              const dot=d.status==="success"?"🟢":d.status==="skipped"?"⚫":d.status==="timeout"||d.status==="rate_limited"?"🟡":"🔴";
              return(
                <span key={d.source} title={`${d.status}${d.error?`: ${d.error}`:""}`}
                  style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:`${col}15`,
                    color:d.postFilterCount>0?col:"var(--muted)",
                    border:`1px solid ${col}${d.postFilterCount>0?"50":"20"}`,
                    fontWeight:600,opacity:d.postFilterCount>0?1:0.5,cursor:"default"}}>
                  {dot} {LBL[d.source]||d.source}:{d.postFilterCount}
                </span>
              );
            })}
            {activeFilterCount>0&&<button onClick={()=>setFilters(DEFAULT_FILTERS)} style={{fontSize:11,color:"var(--accent3)",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>✕ Clear</button>}
            {diagnostics.length>0&&(
              <button onClick={()=>setDiagOpen(o=>!o)}
                style={{marginLeft:"auto",fontSize:10,color:"var(--muted)",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:7,padding:"2px 8px",cursor:"pointer"}}>
                🔬 Debug {diagOpen?"▲":"▼"}
              </button>
            )}
          </div>
          {diagOpen&&diagnostics.length>0&&(
            <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:12,padding:"10px 12px",marginBottom:8,overflowX:"auto"}}>
              <div style={{fontSize:11,fontWeight:700,fontFamily:"'Syne',sans-serif",marginBottom:6}}>🔬 Source Diagnostics</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,whiteSpace:"nowrap"}}>
                <thead>
                  <tr style={{color:"var(--muted)",textAlign:"left"}}>
                    {["Source","Called","Status","Raw","Kept","Error"].map(h=>(
                      <th key={h} style={{padding:"3px 8px",borderBottom:"1px solid var(--border)",fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.map(d=>{
                    const sColorMap:Record<string,string>={success:"#00c864",degraded:"#ff9500",error:"#ff6b6b",skipped:"#7070a0",timeout:"#ff9500",rate_limited:"#ff6b6b"};
                    const stColor=sColorMap[d.status as string]||"#888";
                    const sIconMap:Record<string,string>={success:"✅",degraded:"⚠️",error:"❌",skipped:"⏭️",timeout:"⏱",rate_limited:"🚫"};
                    const sIcon=sIconMap[d.status as string]||"❓";
                    return(
                      <tr key={d.source} style={{borderBottom:"1px solid var(--border)",opacity:d.called?1:0.45}}>
                        <td style={{padding:"4px 8px",fontWeight:600,color:"var(--text)"}}>{d.source}</td>
                        <td style={{padding:"4px 8px",color:d.called?"#00c864":"#ff6b6b"}}>{d.called?"yes":"no"}</td>
                        <td style={{padding:"4px 8px",color:stColor,fontWeight:600}}>{sIcon} {d.status}</td>
                        <td style={{padding:"4px 8px",color:"var(--muted)"}}>{d.rawCount}</td>
                        <td style={{padding:"4px 8px",color:d.postFilterCount>0?"#00c864":"var(--muted)",fontWeight:d.postFilterCount>0?700:400}}>{d.postFilterCount}</td>
                        <td style={{padding:"4px 8px",color:"#ff6b6b",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis"}} title={d.error||undefined}>{d.error||"—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {loadErr&&<div style={{background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:12,padding:"12px 16px",fontSize:13,marginBottom:14}}>⚠️ {loadErr}</div>}

      {/* Two-panel layout */}
      <div style={{display:"grid",gridTemplateColumns:selected?`1fr ${panelCollapsed?"42px":"1fr"}`:"1fr",gap:16,alignItems:"start"}}>

        {/* ── Jobs scrollable container ── */}
        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden"}}>
          <div style={{height:"calc(100vh - 230px)",overflowY:"auto",padding:"12px"}}>
            {loading&&jobs.length===0&&(
              <div style={{textAlign:"center",padding:"60px 20px",color:"var(--muted)"}}>
                <div className="spinner" style={{width:32,height:32,borderWidth:3,borderTopColor:"var(--accent)",margin:"0 auto 14px"}}/>
                <p style={{fontSize:14}}>Loading jobs from DB...</p>
              </div>
            )}
            {jobs.length===0&&!loading&&!loadErr&&(
              <div style={{textAlign:"center",padding:"60px 20px",color:"var(--muted)"}}>
                <div style={{fontSize:48,marginBottom:12}}>📭</div>
                <p style={{fontSize:14}}>No jobs in DB yet</p>
                <p style={{fontSize:12,marginTop:6}}>Click <strong>Refresh Now</strong> to ingest jobs from all sources</p>
              </div>
            )}

            {/* No-date Tier A companies (Google etc.) — always pinned at top.
                Each company is a collapsed dropdown sorted by positionRank ASC.
                Time-filter trims contents (24h→30, 3d→60, 7d→90, any→120). */}
            {noDateGroups.length>0&&(
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:10}}>
            {noDateGroups.map(g=>{
              // Badge label: show fraction info when a date filter is active
              const dateFilter = filters.datePosted;
              const fractionLabel = dateFilter==="24h" ? "top ¼" : dateFilter==="3d" ? "top ½" : dateFilter==="7d" ? "top ¾" : null;
              return (
              <details key={`nodate-${g.company}`} open={false}
                style={{background:"var(--surface)",border:"1px solid var(--accent)",borderRadius:14,overflow:"hidden",boxShadow:"0 0 0 1px rgba(108,99,255,0.15)"}}>
                <summary style={{padding:"14px 18px",cursor:"pointer",userSelect:"none",fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:"linear-gradient(to right, rgba(108,99,255,0.08), transparent)"}}>
                  <span style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:11,color:"var(--accent)",fontWeight:700,padding:"2px 8px",borderRadius:100,background:"rgba(108,99,255,0.12)",border:"1px solid rgba(108,99,255,0.3)"}}>📌 PINNED</span>
                    <span>{g.company}</span>
                  </span>
                  <span style={{fontSize:12,color:"var(--accent)",fontWeight:600,background:"rgba(108,99,255,0.1)",padding:"3px 10px",borderRadius:999,border:"1px solid rgba(108,99,255,0.3)"}}>
                    {fractionLabel ? `${g.count} (${fractionLabel})` : g.count}
                  </span>
                </summary>
                <div style={{padding:"4px 14px 14px",display:"flex",flexDirection:"column",gap:10}}>
                  {g.jobs.map(job=>(
                    <JobCard key={job.id} job={job} selected={selected} tailoring={tailoring} onTailor={handleTailor} S={S}/>
                  ))}
                </div>
              </details>
              );
            })}
              </div>
            )}

            {/* Grouped-by-company view when sort === "company_desc" */}
            {groupedView?(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {groupedView.map((g,i)=>(
                  <details key={g.type==="company_group"?g.company:"__remaining__"}
                    style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
                    <summary style={{padding:"14px 18px",cursor:"pointer",userSelect:"none",fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                      <span style={{display:"flex",alignItems:"center",gap:10}}>
                        {g.type==="company_group"?(
                          <>
                            <span style={{color:"var(--muted)",fontSize:12,fontWeight:500,minWidth:22}}>#{i+1}</span>
                            <span>{g.company}</span>
                          </>
                        ):(
                          <span>{g.title}</span>
                        )}
                      </span>
                      <span style={{fontSize:12,color:"var(--muted)",fontWeight:500,background:"var(--surface2)",padding:"3px 10px",borderRadius:999}}>{g.count}</span>
                    </summary>
                    <div style={{padding:"4px 14px 14px",display:"flex",flexDirection:"column",gap:10}}>
                      {g.type==="remaining_group"&&g.companiesSummary.length>0&&(
                        <div style={{background:"var(--surface2)",border:"1px dashed var(--border)",borderRadius:12,padding:"12px 14px",marginTop:6}}>
                          <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--muted)",marginBottom:8,fontWeight:600}}>Companies in this group</div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:"6px 16px",fontSize:13}}>
                            {g.companiesSummary.map(c=>(
                              <div key={c.company} style={{display:"flex",justifyContent:"space-between",gap:8,color:"var(--text)"}}>
                                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company}</span>
                                <span style={{color:"var(--muted)",fontVariantNumeric:"tabular-nums"}}>— {c.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {g.jobs.map(job=>(
                        <JobCard key={job.id} job={job} selected={selected} tailoring={tailoring} onTailor={handleTailor} S={S}/>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            ):(
              <>
                {/* All jobs with Load More */}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {visibleJobs.map(job=>(
                    <JobCard key={job.id} job={job} selected={selected} tailoring={tailoring} onTailor={handleTailor} S={S}/>
                  ))}
                </div>
                {/* Load More button */}
                {filteredJobs.length>visibleJobs.length&&(
                  <div style={{textAlign:"center",paddingTop:16,paddingBottom:8}}>
                    <button
                      onClick={()=>setDisplayLimit(l=>l+50)}
                      style={{padding:"10px 28px",borderRadius:12,border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--text)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Syne',sans-serif"}}>
                      Load More ({filteredJobs.length-visibleJobs.length} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Tailor panel ── */}
        {selected&&(
          panelCollapsed?(
            <div onClick={()=>setPanelCollapsed(false)} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,height:"calc(100vh - 230px)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
              <div style={{writingMode:"vertical-rl",fontSize:11,color:"var(--muted)",userSelect:"none"}}>▶ Resume Panel</div>
            </div>
          ):(
            <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden"}}>
              <div style={{height:"calc(100vh - 230px)",overflowY:"auto",padding:"16px"}}>
                {/* Header */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                  <span style={{fontSize:14,fontWeight:700,fontFamily:"'Syne',sans-serif"}}>🎯 {selected.company}</span>
                  <div style={{display:"flex",gap:5}}>
                    {step>0&&<>
                      <button onClick={handleCopy} style={{...S.btn("transparent","var(--accent)",true),border:"1px solid var(--accent)",padding:"5px 10px",fontSize:11}}>{copied?"✅":"📋"}</button>
                      <button onClick={()=>downloadPDF(currentResume)} style={{...S.btn("var(--surface2)","var(--text)",true),border:"1px solid var(--border)",padding:"5px 10px",fontSize:11}}>⬇️</button>
                      {step===2&&<button onClick={()=>{setStep(1);setV2Resume("");setV2Ats(null);}} style={{...S.btn("rgba(255,107,107,0.1)","var(--accent3)",true),border:"1px solid rgba(255,107,107,0.3)",padding:"5px 10px",fontSize:11}}>↩</button>}
                    </>}
                    <button onClick={()=>setPanelCollapsed(true)} style={{...S.btn("var(--surface2)","var(--muted)",true),border:"1px solid var(--border)",padding:"5px 9px",fontSize:11}} title="Collapse">◀</button>
                  </div>
                </div>
                {/* Step pills */}
                {step>0&&<div style={{display:"flex",gap:5,marginBottom:10}}>
                  <span style={{fontSize:10,padding:"2px 9px",borderRadius:100,background:step>=1?"var(--accent)":"var(--surface2)",color:step>=1?"#fff":"var(--muted)",fontWeight:600}}>v1 Tailored</span>
                  {step===2&&<span style={{fontSize:10,padding:"2px 9px",borderRadius:100,background:"var(--accent2)",color:"#0a0a0f",fontWeight:600}}>v2 Improved ✨</span>}
                </div>}
                {/* Gap skills */}
                {selected.skills&&selected.skills.length>0&&<div style={{background:"rgba(255,149,0,0.06)",border:"1px solid rgba(255,149,0,0.2)",borderRadius:9,padding:"8px 11px",marginBottom:10}}>
                  <div style={{fontSize:10,color:"#ff9500",fontWeight:600,marginBottom:3}}>⚠️ Skills to add</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:3}}>{selected.skills.map((s,i)=><span key={i} style={{fontSize:10,padding:"2px 7px",borderRadius:100,background:"rgba(255,149,0,0.1)",color:"#ff9500",border:"1px solid rgba(255,149,0,0.3)"}}>{s}</span>)}</div>
                </div>}
                {/* Base resume with edit/save/collapse */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <label style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1}}>Your Resume</label>
                  <div style={{display:"flex",gap:5}}>
                    {!resumeEditing?(
                      <button onClick={()=>setResumeEditing(true)}
                        style={{padding:"3px 9px",borderRadius:7,border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--muted)",fontSize:10,fontWeight:600,cursor:"pointer"}}>
                        ✏️ Edit
                      </button>
                    ):(
                      <>
                        <button onClick={handleSaveResume}
                          style={{padding:"3px 9px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontSize:10,fontWeight:600,cursor:"pointer"}}>
                          {resumeSaved?"✅":"💾 Save"}
                        </button>
                        <button onClick={()=>{setResume(getBaseResume());setResumeEditing(false);}}
                          style={{padding:"3px 9px",borderRadius:7,border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontSize:10,cursor:"pointer"}}>
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <textarea value={resume} onChange={e=>resumeEditing&&setResume(e.target.value)}
                  rows={10} readOnly={!resumeEditing}
                  style={{width:"100%",background:resumeEditing?"var(--surface2)":"var(--bg)",border:"1px solid var(--border)",borderRadius:9,padding:11,color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:11,resize:"vertical",outline:"none",lineHeight:1.5,marginBottom:10,opacity:resumeEditing?1:0.85,cursor:resumeEditing?"text":"default"}}/>
                {/* Loading */}
                {tailoring&&<div style={{textAlign:"center",padding:"28px 0"}}>
                  <div className="spinner" style={{width:26,height:26,borderWidth:3,borderTopColor:"var(--accent)",margin:"0 auto 8px"}}/>
                  <p style={{fontSize:11,color:"var(--muted)"}}>Tailoring...</p>
                </div>}
                {/* Error */}
                {tailorErr&&<div style={{background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:9,padding:"9px 12px",fontSize:11,marginBottom:10}}>⚠️ {tailorErr}<br/><button onClick={()=>selected&&handleTailor(selected)} style={{...S.btn("var(--accent)","#fff",true),marginTop:6,fontSize:11}}>Retry</button></div>}
                {/* Tailored resume */}
                {step>0&&!tailoring&&<>
                  <label style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:3}}>{step===2?"✨ v2 Final":"📄 v1 Tailored"}</label>
                  <textarea value={currentResume} onChange={e=>step===2?setV2Resume(e.target.value):setV1Resume(e.target.value)} rows={18}
                    style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:9,padding:11,color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:11,resize:"vertical",outline:"none",lineHeight:1.5,marginBottom:6}}/>
                  {step===1&&v1Resume&&<DiffCard original={resume} modified={v1Resume} label="Changes: base → v1"/>}
                  {step===2&&v2Resume&&v1Resume&&<DiffCard original={v1Resume} modified={v2Resume} label="Changes: v1 → v2"/>}
                  {currentAts&&<ATSDropdown ats={currentAts} onImprove={handleImprove} improving={improving}/>}
                  {improveErr&&<div style={{background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:9,padding:"9px 12px",fontSize:11,marginTop:8}}>⚠️ {improveErr}</div>}
                  {step>0&&currentResume&&(
                    <div style={{marginTop:10}}>
                      <InterviewPanel
                        tailoredResume={currentResume}
                        jobDescription={jd}
                        jobTitle={selected.title}
                        company={selected.company}
                      />
                    </div>
                  )}
                  {selected.applyUrl&&selected.applyUrl!=="#"&&<a href={selected.applyUrl} target="_blank" rel="noopener noreferrer"
                    style={{...S.btn("var(--accent2)","#0a0a0f"),textDecoration:"none",display:"inline-flex",width:"100%",justifyContent:"center",marginTop:10}}>🚀 Apply Now</a>}
                </>}
              </div>
            </div>
          )
        )}
      </div>

      {/* Filters Modal */}
      <FiltersModal open={filtersOpen} onClose={()=>setFiltersOpen(false)} filters={filters} onSave={setFilters} allJobs={jobs} sources={sources}/>
    </AppLayout>
  );
}

// ── JobCard extracted component ────────────────────────────────────────────
function JobCard({job,selected,tailoring,onTailor,S}:{
  job:Job; selected:Job|null; tailoring:boolean;
  onTailor:(j:Job)=>void;
  S:{card:React.CSSProperties;tag:React.CSSProperties;btn:(bg:string,color:string,small?:boolean)=>React.CSSProperties};
}){
  const exp=(job as Job&{experience?:string}).experience;
  const sponsorship=(job as Job&{sponsorshipTag?:string}).sponsorshipTag;
  const sourceType=(job as Job&{sourceType?:string}).sourceType;
  const bucket=(job as Job&{bucket?:string}).bucket;
  const [saved,setSaved]=useState(()=>isJobSaved(job.id));
  const bucketBadge = bucket==="hot" ? {label:"🔥 Hot",color:"#ff6b6b",bg:"rgba(255,107,107,0.1)"}
    : bucket==="strong" ? {label:"⭐ Strong",color:"#ff9500",bg:"rgba(255,149,0,0.1)"}
    : null;

  const handleBookmark=(e:React.MouseEvent)=>{
    e.stopPropagation();
    if(saved){
      unsaveJob(job.id);
      setSaved(false);
    } else {
      saveJob({
        id:job.id, title:job.title, company:job.company, location:job.location,
        type:job.type, salary:job.salary, description:job.description,
        applyUrl:job.applyUrl, postedDate:job.postedDate,
        postedTimestamp:(job as Job&{postedTimestamp?:number}).postedTimestamp||0,
        source:job.source, sourceType:sourceType||"other",
        skills:job.skills||[],
        sponsorshipTag:(sponsorship as "mentioned"|"not_mentioned")||"not_mentioned",
        experience:exp,
        savedAt:Date.now(),
      } as SavedJob);
      setSaved(true);
    }
  };

  return(
    <div style={{...S.card,border:selected?.id===job.id?"1px solid var(--accent)":"1px solid var(--border)",background:selected?.id===job.id?"rgba(108,99,255,.06)":"var(--card)",transition:"all .2s",position:"relative"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,marginBottom:1}}>{job.title}</div>
          <div style={{fontSize:12,color:"var(--accent2)",fontWeight:500}}>{job.company}</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
          {(() => {
            const rank=(job as Job&{positionRank?:number}).positionRank;
            if (typeof rank === "number" && rank > 0) {
              return <span style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:"rgba(108,99,255,.1)",color:"var(--accent)",border:"1px solid rgba(108,99,255,.3)",whiteSpace:"nowrap",fontWeight:600}}>#{rank}</span>;
            }
            return <span style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:"rgba(0,229,176,.1)",color:"var(--accent2)",border:"1px solid rgba(0,229,176,.3)",whiteSpace:"nowrap"}}>🕐 {job.postedDate}</span>;
          })()}
          {bucketBadge&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:bucketBadge.bg,color:bucketBadge.color,border:`1px solid ${bucketBadge.color}40`,whiteSpace:"nowrap",fontWeight:700}}>{bucketBadge.label}</span>}
          <SourceBadge source={job.source} sourceType={sourceType}/>
        </div>
      </div>
      <div style={{display:"flex",gap:5,marginTop:8,flexWrap:"wrap"}}>
        {job.location&&<span style={S.tag}>📍 {job.location}</span>}
        {job.type&&<span style={S.tag}>💼 {job.type}</span>}
        {job.salary&&<span style={S.tag}>💰 {job.salary}</span>}
        {exp&&<span style={S.tag}>⏱ {exp}</span>}
        {sponsorship==="mentioned"&&<span style={{...S.tag,color:"#00c864",borderColor:"rgba(0,200,100,0.3)",background:"rgba(0,200,100,0.08)"}}>✅ Visa mentioned</span>}
      </div>
      {job.description&&<div style={{fontSize:11,color:"var(--muted)",marginTop:8,lineHeight:1.6}}>{job.description.slice(0,200)}…</div>}
      <GapSkills skills={job.skills}/>
      <div style={{display:"flex",gap:8,marginTop:10,alignItems:"center"}}>
        <button onClick={()=>onTailor(job)} disabled={tailoring&&selected?.id===job.id}
          style={{...S.btn("var(--accent)","#fff",true),opacity:tailoring&&selected?.id===job.id?0.5:1,cursor:tailoring&&selected?.id===job.id?"not-allowed":"pointer"}}>
          {tailoring&&selected?.id===job.id?<><span className="spinner"/>Tailoring...</>:"✨ Tailor & Apply"}
        </button>
        {job.applyUrl&&job.applyUrl!=="#"&&<a href={job.applyUrl} target="_blank" rel="noopener noreferrer"
          style={{...S.btn("var(--surface2)","var(--text)",true),border:"1px solid var(--border)",textDecoration:"none"}}>🔗 View</a>}
        {/* Bookmark button */}
        <button onClick={handleBookmark}
          style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:10,border:saved?"1px solid rgba(0,229,176,0.4)":"1px solid var(--border)",background:saved?"rgba(0,229,176,0.1)":"var(--surface2)",color:saved?"var(--accent2)":"var(--muted)",fontSize:11,fontWeight:600,cursor:"pointer",transition:"all .2s",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>
          {saved?"✅ Saved":"🔖 Save"}
        </button>
      </div>
    </div>
  );
}

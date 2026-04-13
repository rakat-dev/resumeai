"use client";
import { useState, useEffect, useMemo } from "react";
import AppLayout from "@/components/AppLayout";
import type { Job, JobFilter } from "@/app/api/jobs/route";
import type { ATSResult } from "@/app/api/tailor/route";
import { downloadPDF } from "@/lib/downloadPDF";
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
function saveSS(q:string,f:JobFilter,jobs:Job[],src:Record<string,number>){
  try{
    sessionStorage.setItem(SS.Q,q);
    sessionStorage.setItem(SS.F,f);
    sessionStorage.setItem(SS.J,JSON.stringify(jobs));
    sessionStorage.setItem(SS.S,JSON.stringify(src));
  }catch{}
}
function loadSS():{query:string;filter:JobFilter;jobs:Job[];sources:Record<string,number>}|null{
  try{
    const q=sessionStorage.getItem(SS.Q),f=sessionStorage.getItem(SS.F) as JobFilter;
    const j=sessionStorage.getItem(SS.J),s=sessionStorage.getItem(SS.S);
    if(!q||!j)return null;
    return{query:q,filter:f||"any",jobs:JSON.parse(j),sources:s?JSON.parse(s):{}};
  }catch{return null;}
}

// ── Filter types ───────────────────────────────────────────────────────────
type SponsorFilter = "all"|"yes"|"no_info";
type ExpFilter = "0-1yr"|"1-3yr"|"4-6yr"|"6+yr";
type SourceType = "jsearch"|"greenhouse"|"lever"|"remotive"|"other";

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
type SortOption="date_desc"|"date_asc"|"company_desc"|"company_asc";
function clientSort(jobs:Job[],sort:SortOption):Job[]{
  return [...jobs].sort((a,b)=>{
    const ats=(a as Job&{postedTimestamp?:number}).postedTimestamp||0;
    const bts=(b as Job&{postedTimestamp?:number}).postedTimestamp||0;
    if(sort==="date_desc") return bts-ats;
    if(sort==="date_asc") return ats-bts;
    if(sort==="company_desc"){
      const ra=fortuneRank(a.company),rb=fortuneRank(b.company);
      if(ra!==rb) return ra-rb;
      return bts-ats;
    }
    if(sort==="company_asc"){
      const ra=fortuneRank(a.company),rb=fortuneRank(b.company);
      if(ra!==rb) return rb-ra;
      return bts-ats;
    }
    return bts-ats;
  });
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
}
function FiltersModal({open,onClose,filters,onSave,allJobs}:FiltersModalProps){
  const [draft,setDraft]=useState<Filters>(filters);
  useEffect(()=>{if(open)setDraft(filters);},[open,filters]);

  const allCompanies=useMemo(()=>Array.from(new Set(allJobs.map(j=>j.company).filter(Boolean))).sort(),[allJobs]);
  const allSources:SourceType[]=["jsearch","greenhouse","lever","remotive","other"];
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
              {(["any","24h","7d","30d"] as JobFilter[]).map(v=>(
                <button key={v} onClick={()=>setDraft(d=>({...d,datePosted:v}))}
                  style={{padding:"6px 14px",borderRadius:100,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",background:draft.datePosted===v?"var(--accent)":"var(--surface2)",color:draft.datePosted===v?"#fff":"var(--muted)"}}>
                  {v==="any"?"Any time":v==="24h"?"Past 24h":v==="7d"?"Past week":"Past month"}
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
              {allSources.map(s=>(
                <label key={s} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"8px 12px",borderRadius:10,background:draft.sources.has(s)?"rgba(108,99,255,0.08)":"var(--surface2)",border:`1px solid ${draft.sources.has(s)?"var(--accent)":"var(--border)"}`}}>
                  <input type="checkbox" checked={draft.sources.has(s)} onChange={()=>setDraft(d=>({...d,sources:toggle(d.sources as Set<string>,s) as Set<SourceType>}))} style={{accentColor:"var(--accent)"}}/>
                  <span style={{fontSize:13,color:"var(--text)",textTransform:"capitalize"}}>{s==="jsearch"?"Job Boards (JSearch)":s==="other"?"Remotive / Other":s.charAt(0).toUpperCase()+s.slice(1)}</span>
                </label>
              ))}
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
  const C:Record<string,{bg:string;color:string}>={greenhouse:{bg:"rgba(0,200,100,0.1)",color:"#00c864"},lever:{bg:"rgba(0,150,255,0.1)",color:"#0096ff"},remotive:{bg:"rgba(150,100,255,0.1)",color:"#9664ff"},jsearch:{bg:"rgba(112,112,160,0.1)",color:"#7070a0"},other:{bg:"rgba(112,112,160,0.1)",color:"#7070a0"}};
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
  const [query,setQuery]=useState("");
  const [jobs,setJobs]=useState<Job[]>([]);
  const [sources,setSources]=useState<Record<string,number>>({});
  const [loading,setLoading]=useState(false);
  const [searchErr,setSearchErr]=useState("");

  const [filters,setFilters]=useState<Filters>(DEFAULT_FILTERS);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [sort,setSort]=useState<SortOption>("company_desc");

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


  // Restore from sessionStorage (cleared on tab close)
  useEffect(()=>{
    const saved=loadSS();
    if(saved){setQuery(saved.query);setJobs(saved.jobs);setSources(saved.sources);}
    // Load shared base resume
    setResume(getBaseResume());
    // Restore panel state (survives tab switching)
    const panel=loadPanel();
    if(panel){
      setSelected(panel.sel);
      setV1Resume(panel.v1);
      setV2Resume(panel.v2 as string);
      setJd(panel.jd);
      setV1Ats(panel.v1ats as ATSResult|null);
      setV2Ats(panel.v2ats as ATSResult|null);
      setStep(panel.step as 0|1|2);
    }
  },[]);

  // ── Client-side filtering ─────────────────────────────────────────────
  const {filteredJobs}=useMemo(()=>{
    let list=jobs;

    // Fix 9: Client-side date filter (covers Greenhouse/Lever/Remotive which ignore API date param)
    if(filters.datePosted!=="any"){
      const now=Date.now();
      const cutoffs:Record<string,number>={"24h":now-86400000,"7d":now-604800000,"30d":now-2592000000};
      const cutoff=cutoffs[filters.datePosted];
      if(cutoff) list=list.filter(j=>{
        const ts=(j as Job&{postedTimestamp?:number}).postedTimestamp;
        if(!ts)return false; // no timestamp = exclude when date filter active
        return ts*1000>=cutoff;
      });
    }

    if(filters.sponsorship==="yes")list=list.filter(j=>(j as Job&{sponsorshipTag?:string}).sponsorshipTag==="mentioned");
    if(filters.sponsorship==="no_info")list=list.filter(j=>(j as Job&{sponsorshipTag?:string}).sponsorshipTag!=="mentioned");
    if(filters.companies.size>0)list=list.filter(j=>filters.companies.has(j.company));
    if(filters.sources.size>0)list=list.filter(j=>filters.sources.has((j as Job&{sourceType?:string}).sourceType as SourceType||"other"));

    // Experience filter — jobs with no exp data mixed in, filtered only when exp filter active
    if(filters.experience.size>0){
      list=list.filter(j=>{
        const exp=(j as Job&{experience?:string}).experience;
        if(!exp) return true; // no exp data: always include (mix with results)
        return filters.experience.has(exp as ExpFilter);
      });
    }

    return{filteredJobs:clientSort(list,sort)};
  },[jobs,filters,sort]);

  const activeFilterCount=countActiveFilters(filters);
  const currentResume=step===2?v2Resume:v1Resume;
  const currentAts=step===2?v2Ats:v1Ats;

  // ── Search ───────────────────────────────────────────────────────────────
  const handleSearch=async()=>{
    if(!query.trim())return;
    setLoading(true);setJobs([]);setSelected(null);setV1Resume("");setV2Resume("");setV1Ats(null);setV2Ats(null);setStep(0);setSearchErr("");setFilters(DEFAULT_FILTERS);
    try{
      const res=await fetch(`/api/jobs?q=${encodeURIComponent(query)}&filter=${filters.datePosted}`);
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Search failed");
      const nj=data.jobs||[],ns=data.sources||{};
      setJobs(nj);setSources(ns);
      saveSS(query,"any",nj,ns);
      if(nj.length===0)setSearchErr("No jobs found. Try a different query or time filter.");
    }catch(e:unknown){setSearchErr(e instanceof Error?e.message:"Search failed");}
    setLoading(false);
  };

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
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:28,fontWeight:800}}>🔍 Job Search</h1>
        <p style={{color:"var(--muted)",fontSize:14,marginTop:4}}>Real jobs from LinkedIn, Indeed, Greenhouse, Lever & more — US only</p>
      </div>

      {/* Search + Filters bar */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          placeholder="e.g. Senior Software Engineer, Java Developer..."
          style={{flex:1,minWidth:200,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"11px 16px",color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none"}}/>
        <button onClick={()=>setFiltersOpen(true)}
          style={{...S.btn("var(--surface2)","var(--text)"),border:"1px solid var(--border)",position:"relative"}}>
          ⚙️ Filters
          {activeFilterCount>0&&<span style={{position:"absolute",top:-6,right:-6,background:"var(--accent)",color:"#fff",borderRadius:"50%",width:18,height:18,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{activeFilterCount}</span>}
        </button>
        <select value={sort} onChange={e=>setSort(e.target.value as typeof sort)}
          style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"11px 14px",color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",cursor:"pointer"}}>
          <option value="company_desc">🏆 Top Companies First</option>
          <option value="date_desc">🕐 Newest First</option>
          <option value="date_asc">🕐 Oldest First</option>
          <option value="company_asc">📋 All Companies</option>
        </select>
        <button onClick={handleSearch} disabled={loading||!query.trim()}
          style={{...S.btn("var(--accent2)","#0a0a0f"),opacity:loading||!query.trim()?0.5:1,cursor:loading||!query.trim()?"not-allowed":"pointer"}}>
          {loading?<><span className="spinner dark"/>Searching...</>:"🔍 Search Jobs"}
        </button>
      </div>

      {/* Results count + source breakdown */}
      {jobs.length>0&&(
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:"var(--muted)"}}>{filteredJobs.length} showing / {jobs.length} total</span>
          {Object.entries(sources).filter(([,v])=>v>0).map(([s,c])=>(
            <span key={s} style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:"var(--surface2)",color:"var(--muted)",border:"1px solid var(--border)"}}>{s}:{c}</span>
          ))}
          {activeFilterCount>0&&<button onClick={()=>setFilters(DEFAULT_FILTERS)} style={{fontSize:11,color:"var(--accent3)",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>✕ Clear filters</button>}
        </div>
      )}

      {searchErr&&<div style={{background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:12,padding:"12px 16px",fontSize:13,marginBottom:14}}>⚠️ {searchErr}</div>}

      {/* Two-panel layout */}
      <div style={{display:"grid",gridTemplateColumns:selected?`1fr ${panelCollapsed?"42px":"1fr"}`:"1fr",gap:16,alignItems:"start"}}>

        {/* ── Jobs scrollable container ── */}
        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden"}}>
          <div style={{height:"calc(100vh - 230px)",overflowY:"auto",padding:"12px"}}>
            {jobs.length===0&&!loading&&!searchErr&&(
              <div style={{textAlign:"center",padding:"60px 20px",color:"var(--muted)"}}>
                <div style={{fontSize:48,marginBottom:12}}>💼</div>
                <p style={{fontSize:14}}>Search for jobs above</p>
                <p style={{fontSize:12,marginTop:6}}>Results are session-only — cleared when you close the tab</p>
              </div>
            )}

            {/* All jobs — no-exp jobs mixed in */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filteredJobs.map(job=>(
                <JobCard key={job.id} job={job} selected={selected} tailoring={tailoring} onTailor={handleTailor} S={S}/>
              ))}
            </div>
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
                  {selected.applyUrl&&selected.applyUrl!=="#"&&<a href={selected.applyUrl} target="_blank" rel="noopener noreferrer"
                    style={{...S.btn("var(--accent2)","#0a0a0f"),textDecoration:"none",display:"inline-flex",width:"100%",justifyContent:"center",marginTop:10}}>🚀 Apply Now</a>}
                </>}
              </div>
            </div>
          )
        )}
      </div>

      {/* Filters Modal */}
      <FiltersModal open={filtersOpen} onClose={()=>setFiltersOpen(false)} filters={filters} onSave={setFilters} allJobs={jobs}/>
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
  const [saved,setSaved]=useState(()=>isJobSaved(job.id));

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
          <span style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:"rgba(0,229,176,.1)",color:"var(--accent2)",border:"1px solid rgba(0,229,176,.3)",whiteSpace:"nowrap"}}>🕐 {job.postedDate}</span>
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

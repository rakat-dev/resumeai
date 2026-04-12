"use client";
import { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import type { Job, JobFilter } from "@/app/api/jobs/route";
import type { ATSResult } from "@/app/api/tailor/route";
import { downloadPDF } from "@/lib/downloadPDF";

// ── Base resume ────────────────────────────────────────────────────────────
const BASE_RESUME = `Rahul katamneni — Senior Software Engineer
(937) 718-5586 | rahul.kat.1107@gmail.com

PROFESSIONAL SUMMARY:
Senior Full Stack Engineer with 5+ years of experience building enterprise-grade applications using Java, Spring Boot, React.js, TypeScript. Expert in scalable architecture, responsive UI, reusable components, and secure REST APIs. Proven track record in application modernization, performance optimization, and production support in Agile SDLC environments.

EDUCATION:
Master of Science in Management @ Faulkner State Community College

TECHNICAL SKILLS:
• Frontend: React.js, Angular, TypeScript, JavaScript, HTML5, CSS3, Frontend Architecture, Reusable Components
• Backend: Java 17, J2EE, Spring Boot, Spring MVC, REST API Development, Microservices, Distributed Systems, Concurrency, OAuth2/JWT, Secure Coding
• Cloud & DevOps: AWS (EC2, ECS, EKS, S3, RDS, Lambda), Docker, Kubernetes, CI/CD, Jenkins
• Databases: PostgreSQL, MySQL, MongoDB, Redis

EXPERIENCE:
Senior Software Engineer — Accenture (2022–Present)
• Led development of microservices-based platform serving 2M+ users
• Reduced API response time by 40% through caching and query optimization
• Built React component library adopted across 6 teams

Full Stack Engineer — Infosys (2019–2022)
• Developed Spring Boot REST APIs consumed by mobile and web clients
• Migrated monolith to microservices, improving deployment frequency by 3x
• Implemented OAuth2/JWT authentication across 12 services`;

// ── localStorage ───────────────────────────────────────────────────────────
const LS = { Q:"resumeai_last_query", F:"resumeai_last_filter", J:"resumeai_last_jobs", S:"resumeai_last_sources" };
function saveLS(q:string,f:JobFilter,jobs:Job[],src:Record<string,number>){
  try{ localStorage.setItem(LS.Q,q);localStorage.setItem(LS.F,f);localStorage.setItem(LS.J,JSON.stringify(jobs));localStorage.setItem(LS.S,JSON.stringify(src)); }catch{}
}
function loadLS():{query:string;filter:JobFilter;jobs:Job[];sources:Record<string,number>}|null{
  try{
    const q=localStorage.getItem(LS.Q),f=localStorage.getItem(LS.F) as JobFilter,j=localStorage.getItem(LS.J),s=localStorage.getItem(LS.S);
    if(!q||!j)return null;
    return{query:q,filter:f||"any",jobs:JSON.parse(j),sources:s?JSON.parse(s):{}};
  }catch{return null;}
}

// ── Diff algorithm ─────────────────────────────────────────────────────────
interface DiffLine { type:"added"|"removed"|"modified"; old?:string; new?:string; text?:string; }
interface DiffSection { section:string; sub?:string; changes:DiffLine[]; }

function wordOverlap(a:string,b:string):number{
  const wa=new Set(a.toLowerCase().split(/\s+/));
  const wb=b.toLowerCase().split(/\s+/);
  const common=wb.filter(w=>wa.has(w)).length;
  return common/Math.max(wa.size,wb.length);
}

function getSectionName(line:string):string|null{
  const SECS=["SUMMARY","SKILLS","PROFESSIONAL EXPERIENCE","EXPERIENCE","EDUCATION","PROJECTS"];
  const u=line.trim().toUpperCase();
  return SECS.find(s=>u===s||u.startsWith(s))||null;
}

function getSubHeader(line:string):string|null{
  const l=line.trim();
  if(l.startsWith("•")||l.startsWith("-"))return null;
  if(l.length>5&&l.length<80&&!l.includes("  "))return l;
  return null;
}

function computeDiff(original:string,modified:string):DiffSection[]{
  const oLines=original.split("\n").map(l=>l.trim()).filter(Boolean);
  const mLines=modified.split("\n").map(l=>l.trim()).filter(Boolean);
  const sections:DiffSection[]=[];
  let curSection="GENERAL"; let curSub:string|undefined;
  let oIdx=0,mIdx=0;

  const getOrCreate=(sec:string,sub?:string)=>{
    let s=sections.find(s=>s.section===sec&&s.sub===sub);
    if(!s){s={section:sec,sub,changes:[]};sections.push(s);}
    return s;
  };

  // Walk through modified lines, match against original
  while(mIdx<mLines.length){
    const mLine=mLines[mIdx];
    const sec=getSectionName(mLine);
    if(sec){curSection=sec;curSub=undefined;mIdx++;oIdx=oLines.findIndex((l,i)=>i>=oIdx&&getSectionName(l)===sec)+1||oIdx;continue;}
    const sub=getSubHeader(mLine);
    if(sub&&!mLine.startsWith("•")&&!mLine.startsWith("-")){curSub=sub;}
    // Find match in original
    const oMatch=oLines.findIndex((l,i)=>i>=Math.max(0,oIdx-2)&&l===mLine);
    if(oMatch>=0){
      // Check for removed lines between last match and this match
      for(let i=oIdx;i<oMatch;i++){
        if(!getSectionName(oLines[i])&&oLines[i]!==mLine){
          getOrCreate(curSection,curSub).changes.push({type:"removed",text:oLines[i]});
        }
      }
      oIdx=oMatch+1;
    } else {
      // Check if it's a modification of an existing line
      let bestMatch=-1,bestScore=0;
      for(let i=Math.max(0,oIdx-1);i<Math.min(oLines.length,oIdx+3);i++){
        const score=wordOverlap(oLines[i],mLine);
        if(score>0.4&&score>bestScore){bestScore=score;bestMatch=i;}
      }
      if(bestMatch>=0){
        getOrCreate(curSection,curSub).changes.push({type:"modified",old:oLines[bestMatch],new:mLine});
        oIdx=bestMatch+1;
      } else {
        getOrCreate(curSection,curSub).changes.push({type:"added",text:mLine});
      }
    }
    mIdx++;
  }
  return sections.filter(s=>s.changes.length>0);
}

// ── Diff Card component ────────────────────────────────────────────────────
function DiffCard({original,modified,label}:{original:string;modified:string;label:string}){
  const [open,setOpen]=useState(false);
  const diff=computeDiff(original,modified);
  const totalChanges=diff.reduce((a,s)=>a+s.changes.length,0);
  if(totalChanges===0)return null;
  return(
    <div style={{border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginTop:12}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",cursor:"pointer",background:"var(--surface2)",userSelect:"none"}}>
        <span style={{fontSize:13,fontWeight:600,fontFamily:"'Syne',sans-serif"}}>📝 {label} <span style={{fontSize:11,color:"var(--muted)",fontWeight:400}}>({totalChanges} changes)</span></span>
        <span style={{fontSize:12,color:"var(--muted)"}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(
        <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:10,maxHeight:300,overflowY:"auto"}}>
          {diff.map((sec,si)=>(
            <div key={si}>
              <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"var(--accent)",marginBottom:4}}>{sec.section}{sec.sub?` › ${sec.sub.slice(0,40)}`:""}</div>
              {sec.changes.map((c,ci)=>(
                <div key={ci} style={{fontSize:11,lineHeight:1.5,marginBottom:3,paddingLeft:8,borderLeft:`2px solid ${c.type==="added"?"#00e5b0":c.type==="removed"?"#ff6b6b":"#ff9500"}`}}>
                  {c.type==="added"&&<span style={{color:"#00e5b0"}}>+ {c.text}</span>}
                  {c.type==="removed"&&<span style={{color:"#ff6b6b"}}>- {c.text}</span>}
                  {c.type==="modified"&&(
                    <div>
                      <div style={{color:"#ff6b6b"}}>- {c.old}</div>
                      <div style={{color:"#ff9500",marginTop:2}}>~ {c.new}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ATS Dropdown ───────────────────────────────────────────────────────────
function ATSDropdown({ats,onImprove,improving}:{ats:ATSResult;onImprove:()=>void;improving:boolean}){
  const [open,setOpen]=useState(false);
  const color=ats.score>=80?"#00e5b0":ats.score>=60?"#6c63ff":"#ff6b6b";
  const label=ats.score>=80?"Strong Match":ats.score>=60?"Good Match":"Needs Work";
  return(
    <div style={{border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginTop:12}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",cursor:"pointer",background:"var(--surface2)",userSelect:"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:18,color}}>{ats.score}</span>
          <div>
            <div style={{fontSize:13,fontWeight:700,color}}>ATS — {label}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>Click to {open?"hide":"see"} details & suggestions</div>
          </div>
        </div>
        <span style={{fontSize:12,color:"var(--muted)"}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(
        <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:12}}>
          {ats.matched.length>0&&(
            <div>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:5}}>✅ Matched</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {ats.matched.map((k,i)=><span key={i} style={{fontSize:11,padding:"2px 8px",borderRadius:100,background:"rgba(0,229,176,0.1)",color:"#00e5b0",border:"1px solid rgba(0,229,176,0.3)"}}>{k}</span>)}
              </div>
            </div>
          )}
          {ats.missing.length>0&&(
            <div>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:5}}>⚠️ Missing</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {ats.missing.map((k,i)=><span key={i} style={{fontSize:11,padding:"2px 8px",borderRadius:100,background:"rgba(255,107,107,0.1)",color:"#ff6b6b",border:"1px solid rgba(255,107,107,0.3)"}}>{k}</span>)}
              </div>
            </div>
          )}
          {ats.suggestions.length>0&&(
            <div>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:5}}>💡 Suggestions</div>
              {ats.suggestions.map((s,i)=>(
                <div key={i} style={{fontSize:11,color:"var(--text)",background:"var(--surface2)",borderRadius:8,padding:"8px 12px",borderLeft:"2px solid var(--accent)",marginBottom:6,lineHeight:1.5}}>{s}</div>
              ))}
              <button onClick={onImprove} disabled={improving}
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"10px",borderRadius:10,border:"none",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,cursor:improving?"not-allowed":"pointer",background:"var(--accent2)",color:"#0a0a0f",opacity:improving?0.6:1,marginTop:4}}>
                {improving?<><span className="spinner dark"/>Improving...</>:"🚀 Improve Resume"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Source badge ───────────────────────────────────────────────────────────
function SourceBadge({source,sourceType}:{source:string;sourceType?:string}){
  const C:Record<string,{bg:string;color:string}>={
    greenhouse:{bg:"rgba(0,200,100,0.1)",color:"#00c864"},
    lever:{bg:"rgba(0,150,255,0.1)",color:"#0096ff"},
    remotive:{bg:"rgba(150,100,255,0.1)",color:"#9664ff"},
    jsearch:{bg:"rgba(112,112,160,0.1)",color:"#7070a0"},
    other:{bg:"rgba(112,112,160,0.1)",color:"#7070a0"},
  };
  const c=C[sourceType||"other"]||C.other;
  return <span style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:c.bg,color:c.color,border:`1px solid ${c.color}40`}}>{source}</span>;
}

// ── Gap skills ─────────────────────────────────────────────────────────────
function GapSkills({skills}:{skills:string[]}){
  if(!skills||skills.length===0)return null;
  return(
    <div style={{marginTop:10}}>
      <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"#ff9500",fontWeight:600,marginBottom:5}}>⚠️ Skills you&apos;re missing</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {skills.map((s,i)=><span key={i} style={{fontSize:11,padding:"3px 10px",borderRadius:100,background:"rgba(255,149,0,0.1)",color:"#ff9500",border:"1px solid rgba(255,149,0,0.35)",fontWeight:500}}>{s}</span>)}
      </div>
    </div>
  );
}

// ── Filters ────────────────────────────────────────────────────────────────
const FILTERS:{label:string;value:JobFilter}[]=[
  {label:"Any time",value:"any"},{label:"Past 24h",value:"24h"},
  {label:"Past week",value:"7d"},{label:"Past month",value:"30d"},
];

const S={
  card:{background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:20} as React.CSSProperties,
  tag:{fontSize:11,padding:"3px 10px",borderRadius:100,background:"var(--surface2)",color:"var(--muted)",border:"1px solid var(--border)"} as React.CSSProperties,
  btn:(bg:string,color:string,small=false)=>({display:"inline-flex",alignItems:"center",gap:8,padding:small?"8px 16px":"12px 22px",borderRadius:12,fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:small?13:14,cursor:"pointer",border:"none",background:bg,color,transition:"all .2s"} as React.CSSProperties),
};

// ── Main ───────────────────────────────────────────────────────────────────
export default function JobsPage(){
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState<JobFilter>("any");
  const [jobs,setJobs]=useState<Job[]>([]);
  const [sources,setSources]=useState<Record<string,number>>({});
  const [loading,setLoading]=useState(false);
  const [searchErr,setSearchErr]=useState("");

  const [selected,setSelected]=useState<Job|null>(null);
  const [resume,setResume]=useState(BASE_RESUME);
  const [v1Resume,setV1Resume]=useState("");      // first tailored
  const [v2Resume,setV2Resume]=useState("");      // improved
  const [v1Ats,setV1Ats]=useState<ATSResult|null>(null);
  const [v2Ats,setV2Ats]=useState<ATSResult|null>(null);
  const [tailoring,setTailoring]=useState(false);
  const [improving,setImproving]=useState(false);
  const [tailorErr,setTailorErr]=useState("");
  const [improveErr,setImproveErr]=useState("");
  const [step,setStep]=useState<0|1|2>(0); // 0=none,1=tailored,2=improved
  const [copied,setCopied]=useState(false);
  const [panelCollapsed,setPanelCollapsed]=useState(false);
  const [jd,setJd]=useState("");

  // Restore from localStorage
  useEffect(()=>{
    const saved=loadLS();
    if(saved){setQuery(saved.query);setFilter(saved.filter);setJobs(saved.jobs);setSources(saved.sources);}
  },[]);

  const currentResume=step===2?v2Resume:v1Resume;
  const currentAts=step===2?v2Ats:v1Ats;

  // ── Search ───────────────────────────────────────────────────────────────
  const handleSearch=async()=>{
    if(!query.trim())return;
    setLoading(true);setJobs([]);setSelected(null);setV1Resume("");setV2Resume("");setV1Ats(null);setV2Ats(null);setStep(0);setSearchErr("");
    try{
      const res=await fetch(`/api/jobs?q=${encodeURIComponent(query)}&filter=${filter}`);
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Search failed");
      const newJobs=data.jobs||[],newSources=data.sources||{};
      setJobs(newJobs);setSources(newSources);
      saveLS(query,filter,newJobs,newSources);
      if(newJobs.length===0)setSearchErr("No jobs found. Try a different query or time filter.");
    }catch(e:unknown){setSearchErr(e instanceof Error?e.message:"Search failed");}
    setLoading(false);
  };

  // ── Tailor ───────────────────────────────────────────────────────────────
  const handleTailor=async(job:Job)=>{
    setSelected(job);setTailoring(true);setV1Resume("");setV2Resume("");setV1Ats(null);setV2Ats(null);setStep(0);setTailorErr("");setImproveErr("");
    setJd(job.description);
    try{
      const res=await fetch("/api/tailor",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({resume,jobDescription:job.description,jobTitle:job.title,company:job.company})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Tailoring failed");
      setV1Resume(data.tailored);setV1Ats(data.ats||null);setStep(1);
    }catch(e:unknown){setTailorErr(e instanceof Error?e.message:"Tailoring failed");}
    setTailoring(false);
  };

  // ── Improve ───────────────────────────────────────────────────────────────
  const handleImprove=async()=>{
    if(!v1Ats?.suggestions?.length)return;
    setImproving(true);setV2Resume("");setV2Ats(null);setImproveErr("");
    try{
      const res=await fetch("/api/apply-suggestions",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          resume:v1Resume,
          suggestions:v1Ats.suggestions,
          jobDescription:jd,
          constraint:"Apply a maximum of 2-3 natural keyword insertions only. Do not fabricate experience, credentials, or skills not present in the original resume. Keep all existing content intact.",
        })});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Improvement failed");
      setV2Resume(data.improved);setV2Ats(data.ats||null);setStep(2);
    }catch(e:unknown){setImproveErr(e instanceof Error?e.message:"Improvement failed");}
    setImproving(false);
  };

  const handleRollback=()=>{setStep(1);setV2Resume("");setV2Ats(null);};

  const handleCopy=()=>{navigator.clipboard.writeText(currentResume);setCopied(true);setTimeout(()=>setCopied(false),2000);};

  const totalJobs=jobs.length;
  const PANEL_W=panelCollapsed?"40px":"1fr";

  return(
    <AppLayout>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:28,fontWeight:800}}>🔍 Job Search</h1>
        <p style={{color:"var(--muted)",fontSize:14,marginTop:4}}>Real jobs from LinkedIn, Indeed, Greenhouse, Lever & more — US only</p>
      </div>

      {/* Search bar */}
      <div style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          placeholder="e.g. Senior Software Engineer, Java Developer..."
          style={{flex:1,minWidth:200,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none"}}/>
        <button onClick={handleSearch} disabled={loading||!query.trim()}
          style={{...S.btn("var(--accent2)","#0a0a0f"),opacity:loading||!query.trim()?0.5:1,cursor:loading||!query.trim()?"not-allowed":"pointer"}}>
          {loading?<><span className="spinner dark"/>Searching...</>:"🔍 Search Jobs"}
        </button>
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        {FILTERS.map(f=>(
          <button key={f.value} onClick={()=>setFilter(f.value)}
            style={{padding:"6px 16px",borderRadius:100,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",background:filter===f.value?"var(--accent)":"var(--surface2)",color:filter===f.value?"#fff":"var(--muted)"}}>
            {f.label}
          </button>
        ))}
        {totalJobs>0&&(
          <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto",flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:"var(--muted)"}}>{totalJobs} jobs</span>
            {Object.entries(sources).filter(([,v])=>v>0).map(([src,count])=>(
              <span key={src} style={{fontSize:11,padding:"2px 8px",borderRadius:100,background:"var(--surface2)",color:"var(--muted)",border:"1px solid var(--border)"}}>{src}:{count}</span>
            ))}
          </div>
        )}
      </div>

      {searchErr&&<div style={{background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:12,padding:"12px 16px",fontSize:13,marginBottom:16}}>⚠️ {searchErr}</div>}

      {/* Two-panel layout */}
      <div style={{display:"grid",gridTemplateColumns:selected?`1fr ${PANEL_W}`:"1fr",gap:20,alignItems:"start"}}>

        {/* ── Jobs list (scrollable container) ── */}
        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden"}}>
          <div style={{height:"calc(100vh - 260px)",overflowY:"auto",padding:"12px"}}>
            {jobs.length===0&&!loading&&!searchErr&&(
              <div style={{textAlign:"center",padding:"60px 20px",color:"var(--muted)"}}>
                <div style={{fontSize:48,marginBottom:12}}>💼</div>
                <p style={{fontSize:14}}>Search for jobs above</p>
                <p style={{fontSize:12,marginTop:8}}>Real listings from LinkedIn, Indeed, Greenhouse, Lever & Remotive</p>
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {jobs.map(job=>(
                <div key={job.id} style={{...S.card,border:selected?.id===job.id?"1px solid var(--accent)":"1px solid var(--border)",background:selected?.id===job.id?"rgba(108,99,255,.06)":"var(--card)",transition:"all .2s"}}>
                  {/* Header */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,marginBottom:2}}>{job.title}</div>
                      <div style={{fontSize:13,color:"var(--accent2)",fontWeight:500}}>{job.company}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0}}>
                      <span style={{fontSize:11,padding:"3px 10px",borderRadius:100,background:"rgba(0,229,176,.1)",color:"var(--accent2)",border:"1px solid rgba(0,229,176,.3)",whiteSpace:"nowrap"}}>🕐 {job.postedDate}</span>
                      <SourceBadge source={job.source} sourceType={(job as Job&{sourceType?:string}).sourceType}/>
                    </div>
                  </div>
                  {/* Tags */}
                  <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                    {job.location&&<span style={S.tag}>📍 {job.location}</span>}
                    {job.type&&<span style={S.tag}>💼 {job.type}</span>}
                    {job.salary&&<span style={S.tag}>💰 {job.salary}</span>}
                    {(job as Job&{experience?:string}).experience&&<span style={S.tag}>⏱ {(job as Job&{experience?:string}).experience}</span>}
                    {(job as Job&{sponsorshipTag?:string}).sponsorshipTag==="mentioned"&&(
                      <span style={{...S.tag,color:"#00c864",borderColor:"rgba(0,200,100,0.3)",background:"rgba(0,200,100,0.08)"}}>✅ Visa mentioned</span>
                    )}
                  </div>
                  {/* Description */}
                  {job.description&&<div style={{fontSize:12,color:"var(--muted)",marginTop:10,lineHeight:1.6}}>{job.description.slice(0,200)}…</div>}
                  {/* Gap skills */}
                  <GapSkills skills={job.skills}/>
                  {/* Actions */}
                  <div style={{display:"flex",gap:10,marginTop:12}}>
                    <button onClick={()=>handleTailor(job)} disabled={tailoring&&selected?.id===job.id}
                      style={{...S.btn("var(--accent)","#fff",true),opacity:tailoring&&selected?.id===job.id?0.5:1,cursor:tailoring&&selected?.id===job.id?"not-allowed":"pointer"}}>
                      {tailoring&&selected?.id===job.id?<><span className="spinner"/>Tailoring...</>:"✨ Tailor & Apply"}
                    </button>
                    {job.applyUrl&&job.applyUrl!=="#"&&(
                      <a href={job.applyUrl} target="_blank" rel="noopener noreferrer"
                        style={{...S.btn("var(--surface2)","var(--text)",true),border:"1px solid var(--border)",textDecoration:"none"}}>
                        🔗 View Job
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Tailor panel ── */}
        {selected&&(
          panelCollapsed?(
            // Collapsed state — thin strip with expand button
            <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,height:"calc(100vh - 260px)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}
              onClick={()=>setPanelCollapsed(false)}>
              <div style={{writingMode:"vertical-rl",fontSize:12,color:"var(--muted)",userSelect:"none"}}>▶ Resume Panel</div>
            </div>
          ):(
            <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden"}}>
              <div style={{height:"calc(100vh - 260px)",overflowY:"auto",padding:"16px"}}>

                {/* Panel header */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <span style={{fontSize:15,fontWeight:700,fontFamily:"'Syne',sans-serif"}}>🎯 {selected.company}</span>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    {step>0&&(
                      <>
                        <button onClick={handleCopy} style={{...S.btn("transparent","var(--accent)",true),border:"1px solid var(--accent)",padding:"6px 12px",fontSize:12}}>
                          {copied?"✅":"📋"}
                        </button>
                        <button onClick={()=>downloadPDF(currentResume)} style={{...S.btn("var(--surface2)","var(--text)",true),border:"1px solid var(--border)",padding:"6px 12px",fontSize:12}}>⬇️</button>
                        {step===2&&<button onClick={handleRollback} style={{...S.btn("rgba(255,107,107,0.1)","var(--accent3)",true),border:"1px solid rgba(255,107,107,0.3)",padding:"6px 12px",fontSize:12}}>↩</button>}
                      </>
                    )}
                    <button onClick={()=>setPanelCollapsed(true)} style={{...S.btn("var(--surface2)","var(--muted)",true),border:"1px solid var(--border)",padding:"6px 10px",fontSize:12}} title="Collapse panel">◀</button>
                  </div>
                </div>

                {/* Step indicator */}
                {step>0&&(
                  <div style={{display:"flex",gap:6,marginBottom:12}}>
                    <span style={{fontSize:11,padding:"3px 10px",borderRadius:100,background:step>=1?"var(--accent)":"var(--surface2)",color:step>=1?"#fff":"var(--muted)",fontWeight:600}}>v1 Tailored</span>
                    {step===2&&<span style={{fontSize:11,padding:"3px 10px",borderRadius:100,background:"var(--accent2)",color:"#0a0a0f",fontWeight:600}}>v2 Improved ✨</span>}
                  </div>
                )}

                {/* Gap skills reminder */}
                {selected.skills&&selected.skills.length>0&&(
                  <div style={{background:"rgba(255,149,0,0.06)",border:"1px solid rgba(255,149,0,0.25)",borderRadius:10,padding:"8px 12px",marginBottom:12}}>
                    <div style={{fontSize:10,color:"#ff9500",fontWeight:600,marginBottom:4}}>⚠️ Skills to add for this role</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                      {selected.skills.map((s,i)=><span key={i} style={{fontSize:10,padding:"2px 8px",borderRadius:100,background:"rgba(255,149,0,0.1)",color:"#ff9500",border:"1px solid rgba(255,149,0,0.3)"}}>{s}</span>)}
                    </div>
                  </div>
                )}

                {/* Base resume textarea — larger */}
                <div style={{marginBottom:12}}>
                  <label style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:4}}>Your Resume (editable)</label>
                  <textarea value={resume} onChange={e=>setResume(e.target.value)} rows={10}
                    style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:12,color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:11,resize:"vertical",outline:"none",lineHeight:1.5}}/>
                </div>

                {/* Loading */}
                {tailoring&&(
                  <div style={{textAlign:"center",padding:"30px 0"}}>
                    <div className="spinner" style={{width:28,height:28,borderWidth:3,borderTopColor:"var(--accent)",margin:"0 auto 10px"}}/>
                    <p style={{fontSize:12,color:"var(--muted)"}}>Tailoring resume...</p>
                  </div>
                )}

                {/* Error */}
                {tailorErr&&<div style={{background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:10,padding:"10px 14px",fontSize:12,marginBottom:12}}>⚠️ {tailorErr}<br/><button onClick={()=>selected&&handleTailor(selected)} style={{...S.btn("var(--accent)","#fff",true),marginTop:8}}>Retry</button></div>}

                {/* Tailored resume */}
                {step>0&&!tailoring&&(
                  <>
                    <div style={{marginBottom:4}}>
                      <label style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1}}>{step===2?"✨ v2 Final Resume":"📄 v1 Tailored Resume"}</label>
                    </div>
                    <textarea value={currentResume} onChange={e=>step===2?setV2Resume(e.target.value):setV1Resume(e.target.value)} rows={18}
                      style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:12,color:"var(--text)",fontFamily:"'DM Sans',sans-serif",fontSize:11,resize:"vertical",outline:"none",lineHeight:1.5,marginBottom:8}}/>

                    {/* Diff card */}
                    {step===1&&v1Resume&&<DiffCard original={resume} modified={v1Resume} label="Changes from base → v1"/>}
                    {step===2&&v2Resume&&v1Resume&&<DiffCard original={v1Resume} modified={v2Resume} label="Changes from v1 → v2"/>}

                    {/* ATS dropdown */}
                    {currentAts&&<ATSDropdown ats={currentAts} onImprove={handleImprove} improving={improving}/>}

                    {/* Improve error */}
                    {improveErr&&<div style={{background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:10,padding:"10px 14px",fontSize:12,marginTop:10}}>⚠️ {improveErr}</div>}

                    {/* Apply button */}
                    {selected.applyUrl&&selected.applyUrl!=="#"&&(
                      <a href={selected.applyUrl} target="_blank" rel="noopener noreferrer"
                        style={{...S.btn("var(--accent2)","#0a0a0f"),textDecoration:"none",display:"inline-flex",width:"100%",justifyContent:"center",marginTop:12}}>
                        🚀 Apply Now
                      </a>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </AppLayout>
  );
}

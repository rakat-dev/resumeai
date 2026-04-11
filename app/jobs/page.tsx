"use client";
import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import type { Job, JobFilter } from "@/app/api/jobs/route";
import { saveHistoryEntry, updateHistoryEntry, getHistory, generateId, formatDate } from "@/lib/history";

const BASE_RESUME = `Rahul Katamneni — Senior Full Stack Engineer
(937) 718-5586 | rahul.kat.1107@gmail.com | LinkedIn | GitHub | Portfolio

SUMMARY
Senior Full Stack Engineer with 5+ years of experience designing and building scalable, cloud-native enterprise applications. Strong expertise in Java, Spring Boot, React.js, AWS, and microservices architecture.

SKILLS
Frontend: React.js, Angular, TypeScript, JavaScript, React Hooks, CSS3
Backend: Java 17, Spring Boot, Spring MVC, Spring Security, RESTful APIs, Microservices, OAuth2/JWT
Cloud & DevOps: AWS (EC2, ECS, EKS, S3, RDS, Lambda), Docker, Kubernetes, CI/CD, Jenkins
Messaging: Apache Kafka, AWS SNS/SQS
Databases: PostgreSQL, MySQL, MongoDB, Redis
Tools: JUnit, Mockito, Selenium, Splunk, Agile, Jira, Git

EXPERIENCE
Artificial Inventions | Dallas, TX — March 2024 – July 2025
Sr. Software Full Stack Engineer | JPMorgan Chase
• Led 12+ high-performance banking microservices, enabling scalable transaction processing.
• Built 25+ secure REST APIs, reducing integration latency by 30%.
• Developed React.js SPAs with 15+ reusable components.
• Containerized via Docker/Kubernetes (EKS), reducing deployment time 40%.
Tech Stack: Java 17, Spring Boot, React.js, Kafka, Redis, PostgreSQL, Docker, Kubernetes

Amazon | Seattle, WA — Sept 2022 – Feb 2024
Software Development Engineer
• AWS platforms: ECS/EKS, Lambda, API Gateway, RDS — 99.9% uptime.
• Built Python microservices, reducing manual effort 30%.
• CI/CD pipelines with Jenkins, Maven, GitLab.
Tech Stack: Java, Spring Boot, Angular, Python, AWS, Kubernetes

Centene — May 2020 – July 2022
Software Engineer
• Enterprise Java/Spring Boot backend applications.
• Docker, JUnit, Selenium WebDriver.
Tech Stack: Java, Spring Boot, JavaScript, SQL, Docker`;

const FILTERS: { label: string; value: JobFilter }[] = [
  { label: "Any time", value: "any" },
  { label: "Past 24h", value: "24h" },
  { label: "Past week", value: "7d" },
  { label: "Past month", value: "30d" },
];

const SOURCE_COLORS: Record<string, { bg: string; color: string }> = {
  jsearch:    { bg: "rgba(79,142,247,.12)",   color: "#4f8ef7" },
  greenhouse: { bg: "rgba(0,229,176,.1)",     color: "#00e5b0" },
  lever:      { bg: "rgba(108,99,255,.12)",   color: "#9c95ff" },
  remotive:   { bg: "rgba(255,200,0,.1)",     color: "#ffd700" },
  workday:    { bg: "rgba(255,107,107,.1)",   color: "#ff8585" },
  other:      { bg: "rgba(112,112,160,.1)",   color: "#9090c0" },
};

const S = {
  card: { background:"var(--card)", border:"1px solid var(--border)", borderRadius:16, padding:20 } as React.CSSProperties,
  tag: { fontSize:11, padding:"3px 10px", borderRadius:100, background:"var(--surface2)", color:"var(--muted)", border:"1px solid var(--border)" } as React.CSSProperties,
  skillTag: { fontSize:11, padding:"3px 10px", borderRadius:100, background:"rgba(108,99,255,.1)", color:"var(--accent)", border:"1px solid rgba(108,99,255,.3)" } as React.CSSProperties,
  btn: (bg:string, color:string, small=false) => ({ display:"inline-flex", alignItems:"center", gap:8, padding:small?"8px 16px":"12px 22px", borderRadius:12, fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:small?13:14, cursor:"pointer", border:"none", background:bg, color, transition:"all .2s" } as React.CSSProperties),
};

function SponsorshipTag({ tag }: { tag: "mentioned" | "not_mentioned" }) {
  if (tag === "mentioned") {
    return (
      <span style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:"rgba(0,229,176,.12)", color:"var(--accent2)", border:"1px solid rgba(0,229,176,.3)", fontWeight:600 }}>
        ✅ Sponsors Visa
      </span>
    );
  }
  return (
    <span style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:"rgba(112,112,160,.1)", color:"var(--muted)", border:"1px solid var(--border)" }}>
      ❓ No Sponsor Info
    </span>
  );
}

function SourceBadge({ sourceType, source }: { sourceType: string; source: string }) {
  const style = SOURCE_COLORS[sourceType] || SOURCE_COLORS.other;
  return (
    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:100, background:style.bg, color:style.color, border:`1px solid ${style.color}30` }}>
      {source}
    </span>
  );
}

export default function JobsPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobFilter>("any");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [sourceInfo, setSourceInfo] = useState<Record<string, number> | null>(null);

  const [selected, setSelected] = useState<Job | null>(null);
  const [resume, setResume] = useState(BASE_RESUME);
  const [tailored, setTailored] = useState("");
  const [tailoring, setTailoring] = useState(false);
  const [tailorErr, setTailorErr] = useState("");
  const [copied, setCopied] = useState(false);

  // Track history entry ID for the selected job (so we can update status on Apply)
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3500); };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true); setJobs([]); setSelected(null); setTailored("");
    setSearchErr(""); setSourceInfo(null);
    try {
      const res = await fetch(`/api/jobs?q=${encodeURIComponent(query)}&filter=${filter}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setJobs(data.jobs || []);
      setSourceInfo(data.sources || null);
      if ((data.jobs || []).length === 0) setSearchErr("No jobs found. Try a different query or time filter.");
    } catch (e: unknown) {
      setSearchErr(e instanceof Error ? e.message : "Search failed");
    }
    setLoading(false);
  };

  const handleTailorAndApply = async (job: Job) => {
    setSelected(job); setTailoring(true); setTailored(""); setTailorErr(""); setCurrentHistoryId(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume,
          jobDescription: job.description,
          jobTitle: job.title,
          company: job.company,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tailoring failed");
      setTailored(data.tailored);

      // Save to history immediately with status "tailored"
      const ts = Date.now();
      const histId = generateId();
      setCurrentHistoryId(histId);

      const result = saveHistoryEntry({
        id: histId,
        jobTitle: job.title,
        company: job.company,
        jobId: job.id,
        applyUrl: job.applyUrl,
        tailoredResume: data.tailored,
        jobDescription: job.description,
        atsScore: data.ats?.score,
        sponsorshipTag: job.sponsorshipTag,
        location: job.location,
        jobType: job.type,
        sourceType: "jobs_tab",
        isUntitled: false,
        status: "tailored",
        timestamp: ts,
        createdAt: formatDate(ts),
      });

      if (result.isUpdate) {
        showToast(`Updated "${job.title} @ ${job.company}" in History`);
      } else {
        showToast(`Saved "${job.title} @ ${job.company}" to History ✓`);
      }
    } catch (e: unknown) {
      setTailorErr(e instanceof Error ? e.message : "Tailoring failed");
    }
    setTailoring(false);
  };

  const handleApplyNow = (job: Job) => {
    // Update history status to "applied"
    if (currentHistoryId) {
      updateHistoryEntry(currentHistoryId, { status: "applied" });
    } else if (job.id) {
      const existing = getHistory().find(e => e.jobId === job.id);
      if (existing) updateHistoryEntry(existing.id, { status: "applied" });
    }
    showToast(`Marked "${job.title}" as Applied in History ✓`);
    window.open(job.applyUrl, "_blank");
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(tailored);
    setCopied(true); setTimeout(()=>setCopied(false), 2000);
  };

  const totalJobs = jobs.length;

  return (
    <AppLayout>
      {toast && <div className="toast">{toast}</div>}

      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:28, fontWeight:800 }}>🔍 Job Search</h1>
        <p style={{ color:"var(--muted)", fontSize:14, marginTop:4 }}>
          Full-time jobs from 7 sources · Multi-query search · Sponsorship tagged · Sorted newest first
        </p>
      </div>

      {/* Search bar */}
      <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        <input
          value={query}
          onChange={e=>setQuery(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          placeholder="e.g. Senior Java Engineer, React Developer..."
          style={{ flex:1, minWidth:200, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 16px", color:"var(--text)", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none" }}
        />
        <button onClick={handleSearch} disabled={loading||!query.trim()}
          style={{ ...S.btn("var(--accent2)","#0a0a0f"), opacity:loading||!query.trim()?0.5:1, cursor:loading||!query.trim()?"not-allowed":"pointer" }}>
          {loading?<><span className="spinner dark"/>Searching...</>:"🔍 Search Jobs"}
        </button>
      </div>

      {/* Time filters */}
      <div style={{ display:"flex", gap:8, marginBottom:24, flexWrap:"wrap" }}>
        {FILTERS.map(f=>(
          <button key={f.value} onClick={()=>setFilter(f.value)}
            style={{ padding:"6px 16px", borderRadius:100, fontSize:12, fontWeight:600, cursor:"pointer", transition:"all .2s", border:"none", background:filter===f.value?"var(--accent)":"var(--surface2)", color:filter===f.value?"#fff":"var(--muted)" }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Source breakdown */}
      {sourceInfo && totalJobs > 0 && (
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:12, color:"var(--muted)" }}>
            {totalJobs} full-time jobs from:
          </span>
          {Object.entries(sourceInfo).filter(([,v])=>v>0).map(([src,cnt])=>{
            const style = SOURCE_COLORS[src] || SOURCE_COLORS.other;
            const labels: Record<string,string> = { jsearch:"Job Boards", greenhouse:"Greenhouse", lever:"Lever", remotive:"Remotive", workday:"Workday" };
            return (
              <span key={src} style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:style.bg, color:style.color, border:`1px solid ${style.color}30` }}>
                {labels[src]||src}: {cnt}
              </span>
            );
          })}
        </div>
      )}

      {searchErr&&(
        <div style={{ background:"rgba(255,107,107,.1)", border:"1px solid rgba(255,107,107,.3)", color:"var(--accent3)", borderRadius:12, padding:"12px 16px", fontSize:13, marginBottom:20 }}>
          ⚠️ {searchErr}
        </div>
      )}

      {/* Two panel layout */}
      <div style={{ display:"grid", gridTemplateColumns:selected?"1fr 1fr":"1fr", gap:20 }}>

        {/* Job list */}
        <div>
          {jobs.length===0&&!loading&&!searchErr&&(
            <div style={{ textAlign:"center", padding:"60px 20px", color:"var(--muted)" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>💼</div>
              <p style={{ fontSize:14 }}>Search for jobs above</p>
              <p style={{ fontSize:12, marginTop:8 }}>Full-time only · 7 sources · Sponsorship tagged</p>
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {jobs.map(job=>(
              <div key={job.id}
                style={{ ...S.card, border:selected?.id===job.id?"1px solid var(--accent)":"1px solid var(--border)", background:selected?.id===job.id?"rgba(108,99,255,.06)":"var(--card)", transition:"all .2s" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700, marginBottom:2 }}>{job.title}</div>
                    <div style={{ fontSize:13, color:"var(--accent2)", fontWeight:500 }}>{job.company}</div>
                  </div>
                  <span style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:"rgba(0,229,176,.1)", color:"var(--accent2)", border:"1px solid rgba(0,229,176,.3)", whiteSpace:"nowrap", flexShrink:0 }}>
                    🕐 {job.postedDate}
                  </span>
                </div>

                <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap", alignItems:"center" }}>
                  {job.location  && <span style={S.tag}>📍 {job.location}</span>}
                  {job.type      && <span style={S.tag}>💼 {job.type}</span>}
                  {job.salary    && <span style={S.tag}>💰 {job.salary}</span>}
                  <SponsorshipTag tag={job.sponsorshipTag}/>
                  <SourceBadge sourceType={job.sourceType} source={job.source}/>
                </div>

                {job.description&&(
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:10, lineHeight:1.6 }}>
                    {job.description.slice(0,220)}…
                  </div>
                )}

                {job.skills.length>0&&(
                  <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                    {job.skills.map((s,i)=><span key={i} style={S.skillTag}>{s}</span>)}
                  </div>
                )}

                <div style={{ display:"flex", gap:10, marginTop:14, flexWrap:"wrap" }}>
                  <button onClick={()=>handleTailorAndApply(job)}
                    disabled={tailoring&&selected?.id===job.id}
                    style={{ ...S.btn("var(--accent)","#fff",true), opacity:tailoring&&selected?.id===job.id?0.5:1, cursor:tailoring&&selected?.id===job.id?"not-allowed":"pointer" }}>
                    {tailoring&&selected?.id===job.id
                      ?<><span className="spinner"/>Tailoring...</>
                      :"✨ Tailor & Apply"}
                  </button>
                  {job.applyUrl&&job.applyUrl!=="#"&&(
                    <a href={job.applyUrl} target="_blank" rel="noopener noreferrer"
                      onClick={()=>{ if(selected?.id===job.id&&tailored) handleApplyNow(job); }}
                      style={{ ...S.btn("var(--surface2)","var(--text)",true), border:"1px solid var(--border)", textDecoration:"none" }}>
                      🔗 View Job
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tailor panel */}
        {selected&&(
          <div style={{ ...S.card, alignSelf:"start", position:"sticky", top:20 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <span style={{ fontSize:15, fontWeight:700, fontFamily:"'Syne',sans-serif" }}>
                🎯 Tailored for {selected.company}
              </span>
              {tailored&&(
                <button onClick={handleCopy}
                  style={{ ...S.btn("transparent","var(--accent)",true), border:"1px solid var(--accent)" }}>
                  {copied?"✅ Copied!":"📋 Copy"}
                </button>
              )}
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:6 }}>
                Your Resume (editable before tailoring)
              </label>
              <textarea value={resume} onChange={e=>setResume(e.target.value)} rows={6}
                style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:14, color:"var(--text)", fontFamily:"'DM Sans',sans-serif", fontSize:11, resize:"vertical", outline:"none", lineHeight:1.5 }}/>
            </div>

            {tailoring?(
              <div style={{ textAlign:"center", padding:"40px 0" }}>
                <div className="spinner" style={{ width:32,height:32,borderWidth:3,borderTopColor:"var(--accent)",margin:"0 auto 12px" }}/>
                <p style={{ fontSize:13, color:"var(--muted)" }}>AI is tailoring your resume...</p>
              </div>
            ):tailorErr?(
              <div style={{ background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:12,padding:"12px 16px",fontSize:13 }}>
                ⚠️ {tailorErr}
                <br/>
                <button onClick={()=>handleTailorAndApply(selected)} style={{ ...S.btn("var(--accent)","#fff",true), marginTop:10 }}>Retry</button>
              </div>
            ):tailored?(
              <>
                <div style={{ background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:14,fontSize:12,lineHeight:1.7,whiteSpace:"pre-wrap",maxHeight:380,overflowY:"auto",color:"var(--text)",marginBottom:14 }}>
                  {tailored}
                </div>
                {selected.applyUrl&&selected.applyUrl!=="#"&&(
                  <button
                    onClick={()=>handleApplyNow(selected)}
                    style={{ ...S.btn("var(--accent2)","#0a0a0f"), width:"100%", justifyContent:"center" }}>
                    🚀 Apply Now ↗ (marks as Applied in History)
                  </button>
                )}
              </>
            ):null}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

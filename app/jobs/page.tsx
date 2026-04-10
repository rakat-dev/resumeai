"use client";
import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import type { Job, JobFilter } from "@/app/api/jobs/route";

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

const FILTERS: { label: string; value: JobFilter }[] = [
  { label: "Any time", value: "any" },
  { label: "Past 24h", value: "24h" },
  { label: "Past week", value: "7d" },
  { label: "Past month", value: "30d" },
];

const S = {
  card: { background:"var(--card)", border:"1px solid var(--border)", borderRadius:16, padding:20 } as React.CSSProperties,
  tag: { fontSize:11, padding:"3px 10px", borderRadius:100, background:"var(--surface2)", color:"var(--muted)", border:"1px solid var(--border)" } as React.CSSProperties,
  skillTag: { fontSize:11, padding:"3px 10px", borderRadius:100, background:"rgba(108,99,255,.1)", color:"var(--accent)", border:"1px solid rgba(108,99,255,.3)" } as React.CSSProperties,
  btn: (bg: string, color: string, small = false) => ({
    display:"inline-flex", alignItems:"center", gap:8,
    padding: small ? "8px 16px" : "12px 22px",
    borderRadius:12, fontFamily:"'Syne',sans-serif",
    fontWeight:700, fontSize: small ? 13 : 14,
    cursor:"pointer", border:"none",
    background:bg, color, transition:"all .2s",
  } as React.CSSProperties),
};

export default function JobsPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobFilter>("any");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchErr, setSearchErr] = useState("");

  const [selected, setSelected] = useState<Job | null>(null);
  const [resume, setResume] = useState(BASE_RESUME);
  const [tailored, setTailored] = useState("");
  const [tailoring, setTailoring] = useState(false);
  const [tailorErr, setTailorErr] = useState("");
  const [copied, setCopied] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true); setJobs([]); setSelected(null); setTailored(""); setSearchErr("");
    try {
      const res = await fetch(`/api/jobs?q=${encodeURIComponent(query)}&filter=${filter}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setJobs(data.jobs || []);
      if ((data.jobs || []).length === 0) setSearchErr("No jobs found. Try a different query or time filter.");
    } catch (e: unknown) {
      setSearchErr(e instanceof Error ? e.message : "Search failed");
    }
    setLoading(false);
  };

  const handleTailorAndApply = async (job: Job) => {
    setSelected(job); setTailoring(true); setTailored(""); setTailorErr("");
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
    } catch (e: unknown) {
      setTailorErr(e instanceof Error ? e.message : "Tailoring failed");
    }
    setTailoring(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(tailored);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppLayout>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize:28, fontWeight:800 }}>🔍 Job Search</h1>
        <p style={{ color:"var(--muted)", fontSize:14, marginTop:4 }}>
          Real jobs from the web — filter by recency, tailor your resume, and apply in one click
        </p>
      </div>

      {/* Search bar + filter */}
      <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="e.g. Senior Software Engineer, Java Developer..."
          style={{ flex:1, minWidth:200, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 16px", color:"var(--text)", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none" }}
        />
        <button onClick={handleSearch} disabled={loading || !query.trim()}
          style={{ ...S.btn("var(--accent2)","#0a0a0f"), opacity: loading||!query.trim() ? 0.5 : 1, cursor: loading||!query.trim() ? "not-allowed":"pointer" }}>
          {loading ? <><span className="spinner dark" /> Searching...</> : "🔍 Search Jobs"}
        </button>
      </div>

      {/* Time filters */}
      <div style={{ display:"flex", gap:8, marginBottom:24 }}>
        {FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            style={{
              padding:"6px 16px", borderRadius:100, fontSize:12, fontWeight:600,
              cursor:"pointer", transition:"all .2s", border:"none",
              background: filter === f.value ? "var(--accent)" : "var(--surface2)",
              color: filter === f.value ? "#fff" : "var(--muted)",
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {searchErr && (
        <div style={{ background:"rgba(255,107,107,.1)", border:"1px solid rgba(255,107,107,.3)", color:"var(--accent3)", borderRadius:12, padding:"12px 16px", fontSize:13, marginBottom:20 }}>
          ⚠️ {searchErr}
        </div>
      )}

      {/* Two panel layout */}
      <div style={{ display:"grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap:20 }}>

        {/* Job list */}
        <div>
          {jobs.length === 0 && !loading && !searchErr && (
            <div style={{ textAlign:"center", padding:"60px 20px", color:"var(--muted)" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>💼</div>
              <p style={{ fontSize:14 }}>Search for jobs above</p>
              <p style={{ fontSize:12, marginTop:8 }}>Real listings from job boards, filtered by recency</p>
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {jobs.map(job => (
              <div key={job.id}
                style={{ ...S.card, border: selected?.id === job.id ? "1px solid var(--accent)" : "1px solid var(--border)", background: selected?.id === job.id ? "rgba(108,99,255,.06)" : "var(--card)", transition:"all .2s", cursor:"pointer" }}
              >
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700, marginBottom:2 }}>{job.title}</div>
                    <div style={{ fontSize:13, color:"var(--accent2)", fontWeight:500 }}>{job.company}</div>
                  </div>
                  <span style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:"rgba(0,229,176,.1)", color:"var(--accent2)", border:"1px solid rgba(0,229,176,.3)", whiteSpace:"nowrap", flexShrink:0 }}>
                    🕐 {job.postedDate}
                  </span>
                </div>

                <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                  {job.location  && <span style={S.tag}>📍 {job.location}</span>}
                  {job.type      && <span style={S.tag}>💼 {job.type}</span>}
                  {job.salary    && <span style={S.tag}>💰 {job.salary}</span>}
                  <span style={{ ...S.tag, fontSize:10, color:"#5050a0" }}>via {job.source}</span>
                </div>

                {job.description && (
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:10, lineHeight:1.6 }}>
                    {job.description.slice(0, 220)}…
                  </div>
                )}

                {job.skills.length > 0 && (
                  <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                    {job.skills.map((s,i) => <span key={i} style={S.skillTag}>{s}</span>)}
                  </div>
                )}

                <div style={{ display:"flex", gap:10, marginTop:14 }}>
                  <button onClick={() => handleTailorAndApply(job)}
                    disabled={tailoring && selected?.id === job.id}
                    style={{ ...S.btn("var(--accent)","#fff",true), opacity: tailoring&&selected?.id===job.id ? 0.5:1, cursor: tailoring&&selected?.id===job.id?"not-allowed":"pointer" }}>
                    {tailoring && selected?.id === job.id
                      ? <><span className="spinner" /> Tailoring...</>
                      : "✨ Tailor & Apply"}
                  </button>
                  {job.applyUrl && job.applyUrl !== "#" && (
                    <a href={job.applyUrl} target="_blank" rel="noopener noreferrer"
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
        {selected && (
          <div style={{ ...S.card, alignSelf:"start", position:"sticky", top:20 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <span style={{ fontSize:15, fontWeight:700, fontFamily:"'Syne',sans-serif" }}>
                🎯 Tailored for {selected.company}
              </span>
              {tailored && (
                <button onClick={handleCopy}
                  style={{ ...S.btn("transparent","var(--accent)",true), border:"1px solid var(--accent)" }}>
                  {copied ? "✅ Copied!" : "📋 Copy"}
                </button>
              )}
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:6 }}>
                Your Resume (editable before tailoring)
              </label>
              <textarea value={resume} onChange={e => setResume(e.target.value)} rows={6}
                style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:14, color:"var(--text)", fontFamily:"'DM Sans',sans-serif", fontSize:11, resize:"vertical", outline:"none", lineHeight:1.5 }} />
            </div>

            {tailoring ? (
              <div style={{ textAlign:"center", padding:"40px 0" }}>
                <div className="spinner" style={{ width:32, height:32, borderWidth:3, borderTopColor:"var(--accent)", margin:"0 auto 12px" }} />
                <p style={{ fontSize:13, color:"var(--muted)" }}>AI is tailoring your resume...</p>
              </div>
            ) : tailorErr ? (
              <div style={{ background:"rgba(255,107,107,.1)", border:"1px solid rgba(255,107,107,.3)", color:"var(--accent3)", borderRadius:12, padding:"12px 16px", fontSize:13 }}>
                ⚠️ {tailorErr}
                <br/>
                <button onClick={() => handleTailorAndApply(selected)}
                  style={{ ...S.btn("var(--accent)","#fff",true), marginTop:10 }}>
                  Retry
                </button>
              </div>
            ) : tailored ? (
              <>
                <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:14, fontSize:12, lineHeight:1.7, whiteSpace:"pre-wrap", maxHeight:380, overflowY:"auto", color:"var(--text)", marginBottom:14 }}>
                  {tailored}
                </div>
                {selected.applyUrl && selected.applyUrl !== "#" && (
                  <a href={selected.applyUrl} target="_blank" rel="noopener noreferrer"
                    style={{ ...S.btn("var(--accent2)","#0a0a0f"), textDecoration:"none", display:"inline-flex", width:"100%", justifyContent:"center" }}>
                    🚀 Apply Now (opens job listing)
                  </a>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

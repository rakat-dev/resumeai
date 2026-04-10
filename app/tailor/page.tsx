"use client";
import { useState } from "react";
import AppLayout from "@/components/AppLayout";

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
• Tools: Git, JIRA, IntelliJ, VS Code, Postman

EXPERIENCE:
Senior Software Engineer — Accenture (2022–Present)
• Led development of microservices-based platform serving 2M+ users
• Reduced API response time by 40% through caching and query optimization
• Built React component library adopted across 6 teams

Full Stack Engineer — Infosys (2019–2022)
• Developed Spring Boot REST APIs consumed by mobile and web clients
• Migrated monolith to microservices, improving deployment frequency by 3x
• Implemented OAuth2/JWT authentication across 12 services`;

const S = {
  card: { background:"var(--card)", border:"1px solid var(--border)", borderRadius:16, padding:24 } as React.CSSProperties,
  label: { fontSize:11, textTransform:"uppercase" as const, letterSpacing:1, color:"var(--muted)", fontWeight:600, display:"block", marginBottom:8 },
  textarea: { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:14, color:"var(--text)", fontFamily:"'DM Sans',sans-serif", fontSize:13, resize:"vertical" as const, outline:"none", lineHeight:1.6 },
  btn: (bg: string, color: string) => ({ display:"inline-flex", alignItems:"center", gap:8, padding:"12px 22px", borderRadius:12, fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, cursor:"pointer", border:"none", background:bg, color, transition:"all .2s" } as React.CSSProperties),
};

export default function TailorPage() {
  const [resume, setResume] = useState(BASE_RESUME);
  const [jd, setJd] = useState("");
  const [tailored, setTailored] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleTailor = async () => {
    if (!jd.trim()) return;
    setLoading(true); setTailored(""); setError("");
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, jobDescription: jd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setTailored(data.tailored);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    setLoading(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(tailored);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppLayout>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>✂️ Resume Tailor</h1>
        <p style={{ color:"var(--muted)", fontSize:14, marginTop:4 }}>
          Paste a job description — AI rewrites your resume to maximize ATS match
        </p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        {/* Left column */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={S.card}>
            <label style={S.label}>📄 Your Base Resume</label>
            <textarea
              value={resume}
              onChange={e => setResume(e.target.value)}
              rows={16}
              style={S.textarea}
              placeholder="Paste your base resume here..."
            />
          </div>
          <div style={S.card}>
            <label style={S.label}>📋 Job Description</label>
            <textarea
              value={jd}
              onChange={e => setJd(e.target.value)}
              rows={12}
              style={S.textarea}
              placeholder="Paste the full job description here..."
            />
            {error && (
              <div style={{ background:"rgba(255,107,107,.1)", border:"1px solid rgba(255,107,107,.3)", color:"var(--accent3)", borderRadius:12, padding:"12px 16px", fontSize:13, marginTop:12 }}>
                ⚠️ {error}
              </div>
            )}
            <div style={{ marginTop:16 }}>
              <button
                onClick={handleTailor}
                disabled={loading || !jd.trim()}
                style={{ ...S.btn("var(--accent)","#fff"), opacity: loading || !jd.trim() ? 0.5 : 1, cursor: loading || !jd.trim() ? "not-allowed" : "pointer" }}
              >
                {loading ? <><span className="spinner" /> Tailoring...</> : "✨ Tailor Resume"}
              </button>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={S.card}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <span style={{ fontSize:15, fontWeight:700, fontFamily:"'Syne',sans-serif" }}>🎯 Tailored Resume</span>
            {tailored && (
              <button onClick={handleCopy} style={{ ...S.btn("transparent","var(--accent)"), border:"1px solid var(--accent)", padding:"6px 14px", fontSize:12 }}>
                {copied ? "✅ Copied!" : "📋 Copy"}
              </button>
            )}
          </div>
          {tailored ? (
            <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:14, fontSize:13, lineHeight:1.7, whiteSpace:"pre-wrap", maxHeight:640, overflowY:"auto", color:"var(--text)" }}>
              {tailored}
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:400, color:"var(--muted)", textAlign:"center" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>🤖</div>
              <p style={{ fontSize:14 }}>Your tailored resume will appear here</p>
              <p style={{ fontSize:12, marginTop:8 }}>Paste a JD on the left and click Tailor Resume</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

"use client";
import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import type { ATSResult } from "@/app/api/tailor/route";

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

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#00e5b0" : score >= 60 ? "#6c63ff" : "#ff6b6b";
  const label = score >= 80 ? "Strong Match" : score >= 60 ? "Good Match" : "Needs Work";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <svg width="80" height="80" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="7" />
          <circle cx="40" cy="40" r="34" fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={`${2 * Math.PI * 34}`}
            strokeDashoffset={`${2 * Math.PI * 34 * (1 - score / 100)}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, color }}>
          {score}
        </div>
      </div>
      <div>
        <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16, color }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>ATS Match Score</div>
      </div>
    </div>
  );
}

function ATSPanel({ ats }: { ats: ATSResult }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Score ring */}
      <div style={{ background: "var(--surface2)", borderRadius: 12, padding: 16 }}>
        <ScoreRing score={ats.score} />
      </div>

      {/* Matched keywords */}
      {ats.matched.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>
            ✅ Matched Keywords ({ats.matched.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ats.matched.map((k, i) => (
              <span key={i} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "rgba(0,229,176,0.1)", color: "var(--accent2)", border: "1px solid rgba(0,229,176,0.3)" }}>
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Missing keywords */}
      {ats.missing.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>
            ⚠️ Missing Keywords ({ats.missing.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ats.missing.map((k, i) => (
              <span key={i} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "rgba(255,107,107,0.1)", color: "var(--accent3)", border: "1px solid rgba(255,107,107,0.3)" }}>
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {ats.suggestions.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>
            💡 Suggestions to Improve
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ats.suggestions.map((s, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--text)", background: "var(--surface2)", borderRadius: 10, padding: "10px 14px", borderLeft: "3px solid var(--accent)", lineHeight: 1.5 }}>
                {s}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 } as React.CSSProperties,
  label: { fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 1, color: "var(--muted)", fontWeight: 600, display: "block", marginBottom: 8 },
  textarea: { width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, color: "var(--text)", fontFamily: "'DM Sans',sans-serif", fontSize: 13, resize: "vertical" as const, outline: "none", lineHeight: 1.6 },
  btn: (bg: string, color: string) => ({ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 12, fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer", border: "none", background: bg, color, transition: "all .2s" } as React.CSSProperties),
};

export default function TailorPage() {
  const [resume, setResume] = useState(BASE_RESUME);
  const [jd, setJd] = useState("");
  const [tailored, setTailored] = useState("");
  const [ats, setAts] = useState<ATSResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"resume" | "ats">("resume");

  const handleTailor = async () => {
    if (!jd.trim()) return;
    setLoading(true); setTailored(""); setAts(null); setError("");
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, jobDescription: jd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setTailored(data.tailored);
      setAts(data.ats);
      setActiveTab("resume");
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
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
          AI rewrites your resume using the JD&apos;s exact language + scores your ATS match
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={S.card}>
            <label style={S.label}>📄 Your Base Resume</label>
            <textarea value={resume} onChange={e => setResume(e.target.value)} rows={16} style={S.textarea} placeholder="Paste your base resume here..." />
          </div>
          <div style={S.card}>
            <label style={S.label}>📋 Job Description</label>
            <textarea value={jd} onChange={e => setJd(e.target.value)} rows={12} style={S.textarea} placeholder="Paste the full job description here..." />
            {error && (
              <div style={{ background: "rgba(255,107,107,.1)", border: "1px solid rgba(255,107,107,.3)", color: "var(--accent3)", borderRadius: 12, padding: "12px 16px", fontSize: 13, marginTop: 12 }}>
                ⚠️ {error}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button onClick={handleTailor} disabled={loading || !jd.trim()}
                style={{ ...S.btn("var(--accent)", "#fff"), opacity: loading || !jd.trim() ? 0.5 : 1, cursor: loading || !jd.trim() ? "not-allowed" : "pointer" }}>
                {loading ? <><span className="spinner" /> Analyzing & Tailoring...</> : "✨ Tailor Resume"}
              </button>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={S.card}>
          {/* Tabs */}
          {tailored && (
            <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "var(--surface2)", borderRadius: 10, padding: 4 }}>
              {(["resume", "ats"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, transition: "all .2s",
                    background: activeTab === tab ? "var(--accent)" : "transparent",
                    color: activeTab === tab ? "#fff" : "var(--muted)",
                  }}>
                  {tab === "resume" ? "📄 Tailored Resume" : `🎯 ATS Score ${ats ? `(${ats.score})` : ""}`}
                </button>
              ))}
            </div>
          )}

          {/* Tab header */}
          {tailored && activeTab === "resume" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Ready to copy & submit</span>
              <button onClick={handleCopy} style={{ ...S.btn("transparent", "var(--accent)"), border: "1px solid var(--accent)", padding: "6px 14px", fontSize: 12 }}>
                {copied ? "✅ Copied!" : "📋 Copy"}
              </button>
            </div>
          )}

          {/* Content */}
          {tailored ? (
            activeTab === "resume" ? (
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 580, overflowY: "auto", color: "var(--text)" }}>
                {tailored}
              </div>
            ) : (
              ats ? <ATSPanel ats={ats} /> : (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
                  <p>ATS analysis unavailable</p>
                </div>
              )
            )
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400, color: "var(--muted)", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
              <p style={{ fontSize: 14 }}>Your tailored resume + ATS score will appear here</p>
              <p style={{ fontSize: 12, marginTop: 8 }}>Paste a JD on the left and click Tailor Resume</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

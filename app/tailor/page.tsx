"use client";
import { useState, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import type { ATSResult } from "@/app/api/tailor/route";
import {
  saveHistoryEntry, generateId, formatDate, extractJobInfoFromJD,
} from "@/lib/history";

const BASE_RESUME = `Rahul Katamneni — Senior Full Stack Engineer
(937) 718-5586 | rahul.kat.1107@gmail.com | LinkedIn | GitHub | Portfolio

SUMMARY
Senior Full Stack Engineer with 5+ years of experience designing and building scalable, cloud-native enterprise applications across backend, frontend, and distributed systems. Strong expertise in system design, microservices architecture, and high-throughput processing using Java, Spring Boot, and AWS. Proven experience leading architecture decisions, building resilient event-driven systems, and optimizing performance for large-scale applications.

SKILLS
Frontend: React.js, Angular, TypeScript, JavaScript, React Hooks, State Management, Frontend Architecture, CSS3
Backend: Java 17, Spring Boot, Spring MVC, Spring Security, RESTful APIs, Microservices, Hibernate, Java Concurrency, OAuth2/JWT
Cloud & DevOps: AWS (EC2, ECS, EKS, S3, RDS, Lambda, API Gateway, IAM, VPC), Docker, Kubernetes, CI/CD, Jenkins
Messaging & Streaming: Apache Kafka, AWS SNS/SQS, Event-Driven Architecture
Databases: PostgreSQL, MySQL, Oracle, MongoDB, Redis
Testing & Quality: JUnit, Mockito, Selenium
Observability: Splunk, Dynatrace, Kibana, CloudWatch, Distributed Tracing
Tools & Methods: Agile (Scrum), Jira, Git

PROFESSIONAL EXPERIENCE

Artificial Inventions | Dallas, TX                                    March 2024 – July 2025
Sr. Software Full Stack Engineer | Project: JPMorgan Chase
• Led design and development of 12+ high-performance banking microservices, enabling scalable, low-latency transaction processing for enterprise financial systems.
• Built 25+ secure REST APIs using Spring Boot, JAX-RS, and Spring MVC, reducing integration latency by 30%.
• Led system design discussions and architecture decisions for distributed banking platforms.
• Established API design standards and governance practices including versioning, documentation, and security guidelines.
• Led frontend architecture decisions for high-traffic banking applications.
• Developed responsive SPAs using React.js, TypeScript, and CSS3, building 15+ reusable UI components.
• Built Python-based data processing and orchestration utilities supporting backend services.
• Integrated React.js frontend modules with Spring Boot REST APIs, improving response times by 25%.
• Containerized applications using Docker and deployed on Kubernetes (EKS), reducing deployment time by 40%.
• Implemented multi-threaded transaction processing using Java Concurrency APIs, increasing throughput by 30%.
• Integrated Kafka-based streaming pipelines for real-time transaction validation and fraud detection.
• Enhanced CI/CD pipeline reliability, improving deployment success rates by 25%.
Tech Stack: Java 17, Spring Boot, Microservices, React.js, Apache Kafka, Redis, PostgreSQL, Docker, Kubernetes

Amazon | Seattle, WA                                                  Sept 2022 – Feb 2024
Software Development Engineer
• Architected large-scale AWS-based platforms leveraging ECS/EKS, Lambda, API Gateway, and RDS with 99.9% uptime.
• Designed secure AWS infrastructure using IAM roles, VPC networking, and security groups.
• Built Python microservices and automation tools, reducing manual operational effort by 30%.
• Managed Kubernetes-based deployments on AWS EKS with auto-scaling and self-healing strategies.
• Delivered end-to-end full stack features using Angular and Spring Boot.
• Designed and implemented scalable CI/CD pipelines using Jenkins, Maven, and GitLab.
• Defined service reliability metrics and monitoring dashboards improving failure detection by 35%.
Tech Stack: Java, Spring Boot, Angular, Python, AWS (ECS, EKS, Lambda, API Gateway, S3, RDS), Kubernetes, CI/CD

Centene                                                               May 2020 – July 2022
Software Engineer
• Developed enterprise backend applications using Java, J2EE, and Spring Boot.
• Implemented microservice-based backend services, reducing deployment dependency issues by 25%.
• Built reusable UI functionality using JavaScript, HTML5, and CSS3.
• Built Docker container images and standardized deployment configurations.
• Developed unit tests using JUnit and automated UI testing using Selenium WebDriver.
• Worked extensively in Linux/Unix environments, optimizing application performance.
• Collaborated with cross-functional teams across development, QA, and DevOps.
Tech Stack: Java, Spring Boot, JavaScript, HTML5, CSS3, SQL, Docker, JUnit, Selenium

EDUCATION
Master of Science in Computer Engineering — Wright State University, Dayton, Ohio | July 2022
Master of Science in Management (In Progress) — Faulkner State University, Alabama
Bachelor of Technology in Electronics and Communication Engineering — NIT Jamshedpur, India | April 2020`;

// ── PDF Generator ──────────────────────────────────────────────────────────
function downloadPDF(resumeText: string) {
  const DARK_BLUE = "#1F3864";
  const BLACK = "#000000";
  const lines = resumeText.split("\n");
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Calibri','Carlito',Arial,sans-serif; font-size:10pt; color:${BLACK}; padding:36pt 43pt; line-height:1.0; }
  .name { font-size:18pt; font-weight:bold; color:${DARK_BLUE}; }
  .title { font-size:16pt; color:${BLACK}; margin-top:2pt; }
  .contact { font-size:13pt; color:${BLACK}; margin-top:4pt; }
  .section-header { font-size:15pt; font-weight:bold; color:${DARK_BLUE}; border-bottom:1.5px solid ${BLACK}; margin-top:10pt; margin-bottom:3pt; padding-bottom:1pt; }
  .body-text { font-size:10pt; color:${BLACK}; margin-top:4pt; }
  .company { font-size:13pt; font-weight:bold; color:${BLACK}; margin-top:8pt; }
  .role { font-size:11.5pt; font-style:italic; color:${BLACK}; }
  .bullet { font-size:10pt; color:${BLACK}; margin-left:18pt; text-indent:-9pt; margin-top:0; }
  .bullet::before { content:"• "; }
  .tech { font-size:10pt; color:${BLACK}; margin-top:3pt; }
  .skill-row { font-size:10pt; color:${BLACK}; }
  .skill-bold { font-weight:bold; }
  .edu-degree { font-size:13pt; font-weight:bold; color:${BLACK}; margin-top:6pt; }
  .edu-school { font-size:11.5pt; font-style:italic; color:${BLACK}; }
  </style></head><body>`;

  const SECTION_KW = ["SUMMARY","SKILLS","PROFESSIONAL EXPERIENCE","EXPERIENCE","EDUCATION","PROJECTS"];
  const SKILL_CATS = ["Frontend","Backend","Cloud","Messaging","Databases","Testing","Observability","Tools","Languages","AI","DevOps"];
  const COMPANIES = ["Artificial Inventions","Amazon","Centene","Accenture","Infosys","Google","Microsoft","Meta","Apple"];
  let nameWritten=false, titleWritten=false, contactWritten=false, inSkills=false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!nameWritten) { html+=`<div class="name">${line.split("—")[0].trim()}</div>`; nameWritten=true; continue; }
    if (!titleWritten) {
      const t = line.includes("—") ? line.split("—")[1]?.trim() : line;
      if (t && !line.includes("@") && !line.includes("|")) { html+=`<div class="title">${t}</div>`; titleWritten=true; continue; }
    }
    if (!contactWritten && (line.includes("|")||line.includes("@")||line.match(/\d{3}[-.\s]\d{3}/))) {
      html+=`<div class="contact">${line.split("|").map(p=>p.trim()).join("  |  ")}</div>`; contactWritten=true; continue;
    }
    if (SECTION_KW.some(k=>line.toUpperCase()===k||line.toUpperCase().startsWith(k))) { inSkills=line.toUpperCase().includes("SKILL"); html+=`<div class="section-header">${line}</div>`; continue; }
    if (line.startsWith("•")||line.startsWith("-")) { html+=`<div class="bullet">${line.replace(/^[•\-]\s*/,"")}</div>`; continue; }
    if (line.startsWith("Tech Stack:")) { html+=`<div class="tech"><span class="skill-bold">Tech Stack: </span>${line.replace("Tech Stack:","").trim()}</div>`; continue; }
    if (inSkills && SKILL_CATS.some(c=>line.startsWith(c+":"))) { const ci=line.indexOf(":"); html+=`<div class="skill-row"><span class="skill-bold">${line.slice(0,ci)}: </span>${line.slice(ci+1).trim()}</div>`; continue; }
    if (COMPANIES.some(c=>line.includes(c))) { const parts=line.split("|"); html+=`<div class="company">${parts[0].trim()}${parts[1]?`<span style="float:right;font-size:10pt;font-weight:normal">${parts[1].trim()}</span>`:""}</div>`; continue; }
    if (!line.includes("•") && line.length<120 && (line.toLowerCase().startsWith("sr.")||line.toLowerCase().startsWith("software")||line.toLowerCase().startsWith("senior"))) { html+=`<div class="role">${line}</div>`; continue; }
    if (line.startsWith("Master")||line.startsWith("Bachelor")||line.startsWith("Doctor")) { html+=`<div class="edu-degree">${line}</div>`; continue; }
    html+=`<div class="body-text">${line}</div>`;
  }
  html+=`</body></html>`;
  const w=window.open("","_blank");
  if(!w){alert("Please allow popups to download PDF");return;}
  w.document.write(html); w.document.close();
  w.onload=()=>{w.focus();w.print();};
}

// ── ATS Score Ring ─────────────────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const color = score>=80?"#00e5b0":score>=60?"#6c63ff":"#ff6b6b";
  const label = score>=80?"Strong Match":score>=60?"Good Match":"Needs Work";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:16 }}>
      <div style={{ position:"relative", width:80, height:80 }}>
        <svg width="80" height="80" style={{ transform:"rotate(-90deg)" }}>
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="7"/>
          <circle cx="40" cy="40" r="34" fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={`${2*Math.PI*34}`}
            strokeDashoffset={`${2*Math.PI*34*(1-score/100)}`}
            strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s ease" }}/>
        </svg>
        <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:18,color }}>{score}</div>
      </div>
      <div>
        <div style={{ fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:16,color }}>{label}</div>
        <div style={{ fontSize:12,color:"var(--muted)",marginTop:2 }}>ATS Match Score</div>
      </div>
    </div>
  );
}

function ATSPanel({ ats, onApply, applying }: { ats: ATSResult; onApply:()=>void; applying:boolean }) {
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
      <div style={{ background:"var(--surface2)",borderRadius:12,padding:16 }}><ScoreRing score={ats.score}/></div>
      {ats.matched.length>0&&(
        <div>
          <div style={{ fontSize:11,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:8 }}>✅ Matched Keywords ({ats.matched.length})</div>
          <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
            {ats.matched.map((k,i)=><span key={i} style={{ fontSize:11,padding:"3px 10px",borderRadius:100,background:"rgba(0,229,176,0.1)",color:"var(--accent2)",border:"1px solid rgba(0,229,176,0.3)" }}>{k}</span>)}
          </div>
        </div>
      )}
      {ats.missing.length>0&&(
        <div>
          <div style={{ fontSize:11,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:8 }}>⚠️ Missing Keywords ({ats.missing.length})</div>
          <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
            {ats.missing.map((k,i)=><span key={i} style={{ fontSize:11,padding:"3px 10px",borderRadius:100,background:"rgba(255,107,107,0.1)",color:"var(--accent3)",border:"1px solid rgba(255,107,107,0.3)" }}>{k}</span>)}
          </div>
        </div>
      )}
      {ats.suggestions.length>0&&(
        <div>
          <div style={{ fontSize:11,textTransform:"uppercase",letterSpacing:1,color:"var(--muted)",fontWeight:600,marginBottom:8 }}>💡 Suggestions to Improve</div>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {ats.suggestions.map((s,i)=>(
              <div key={i} style={{ fontSize:12,color:"var(--text)",background:"var(--surface2)",borderRadius:10,padding:"10px 14px",borderLeft:"3px solid var(--accent)",lineHeight:1.5 }}>{s}</div>
            ))}
          </div>
        </div>
      )}
      {ats.suggestions.length>0&&(
        <button onClick={onApply} disabled={applying}
          style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"13px 22px",borderRadius:12,fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,cursor:applying?"not-allowed":"pointer",border:"none",background:"var(--accent2)",color:"#0a0a0f",opacity:applying?0.6:1,transition:"all .2s",marginTop:4 }}>
          {applying?<><span className="spinner dark"/>Applying suggestions...</>:"🚀 Apply Suggestions → Get Final Resume"}
        </button>
      )}
    </div>
  );
}

const S = {
  card: { background:"var(--card)", border:"1px solid var(--border)", borderRadius:16, padding:24 } as React.CSSProperties,
  label: { fontSize:11, textTransform:"uppercase" as const, letterSpacing:1, color:"var(--muted)", fontWeight:600, display:"block", marginBottom:8 },
  input: { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"10px 14px", color:"var(--text)", fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none" } as React.CSSProperties,
  textarea: { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:14, color:"var(--text)", fontFamily:"'DM Sans',sans-serif", fontSize:13, resize:"vertical" as const, outline:"none", lineHeight:1.6 },
  btn: (bg:string, color:string, small=false) => ({ display:"inline-flex", alignItems:"center", gap:8, padding:small?"8px 16px":"12px 22px", borderRadius:12, fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:small?13:14, cursor:"pointer", border:"none", background:bg, color, transition:"all .2s" } as React.CSSProperties),
};

// ── Main Page ──────────────────────────────────────────────────────────────
export default function TailorPage() {
  const [resume, setResume] = useState(BASE_RESUME);
  const [jd, setJd] = useState("");
  const [jobTitleField, setJobTitleField] = useState("");
  const [companyField, setCompanyField] = useState("");

  const [step1Resume, setStep1Resume] = useState("");
  const [step1Ats, setStep1Ats] = useState<ATSResult | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [tailorErr, setTailorErr] = useState("");

  const [step2Resume, setStep2Resume] = useState("");
  const [step2Ats, setStep2Ats] = useState<ATSResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState("");

  const [activeTab, setActiveTab] = useState<"resume"|"ats">("resume");
  const [step, setStep] = useState<0|1|2>(0);
  const [copied, setCopied] = useState(false);

  // Toast for history save notifications
  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3500); };

  // ── Resolve job name ─────────────────────────────────────────────────────
  const resolveJobInfo = useCallback((): { title: string; company: string; isUntitled: boolean } => {
    const t = jobTitleField.trim();
    const c = companyField.trim();
    if (t || c) return { title: t || "Unknown Role", company: c, isUntitled: false };

    // Try auto-extract from JD
    const extracted = extractJobInfoFromJD(jd);
    if (extracted.title || extracted.company) {
      return { title: extracted.title || "Unknown Role", company: extracted.company, isUntitled: false };
    }
    return { title: "Untitled Resume", company: "", isUntitled: true };
  }, [jobTitleField, companyField, jd]);

  // ── Save to history ───────────────────────────────────────────────────────
  const saveToHistory = useCallback((tailoredResume: string, ats: ATSResult | null, isFinal: boolean) => {
    const { title, company, isUntitled } = resolveJobInfo();
    const ts = Date.now();
    const result = saveHistoryEntry({
      id: generateId(),
      jobTitle: title,
      company,
      tailoredResume,
      jobDescription: jd.slice(0, 1000),
      atsScore: ats?.score,
      sourceType: "tailor_tab",
      isUntitled,
      status: "tailored",
      timestamp: ts,
      createdAt: formatDate(ts),
    });

    if (isFinal) {
      const name = isUntitled ? "Untitled Resume" : (company ? `${title} @ ${company}` : title);
      showToast(result.isUpdate
        ? `Updated "${name}" in History`
        : `Saved "${name}" to History ✓`
      );
    }
  }, [jd, resolveJobInfo]);

  // ── Tailor ────────────────────────────────────────────────────────────────
  const handleTailor = async () => {
    if (!jd.trim()) return;
    setTailoring(true); setTailorErr(""); setStep1Resume(""); setStep1Ats(null);
    setStep2Resume(""); setStep2Ats(null); setStep(0);
    try {
      const { title, company } = resolveJobInfo();
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, jobDescription: jd, jobTitle: title, company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setStep1Resume(data.tailored);
      setStep1Ats(data.ats);
      setStep(1);
      setActiveTab("resume");
      saveToHistory(data.tailored, data.ats, true);
    } catch(e: unknown) { setTailorErr(e instanceof Error ? e.message : "Error"); }
    setTailoring(false);
  };

  // ── Apply suggestions ─────────────────────────────────────────────────────
  const handleApply = async () => {
    if (!step1Ats?.suggestions?.length) return;
    setApplying(true); setApplyErr(""); setStep2Resume(""); setStep2Ats(null);
    try {
      const res = await fetch("/api/apply-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: step1Resume, suggestions: step1Ats.suggestions, jobDescription: jd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setStep2Resume(data.improved);
      setStep2Ats(data.ats);
      setStep(2);
      setActiveTab("resume");
      // Update history with final version
      saveToHistory(data.improved, data.ats, false);
      showToast("History updated with final resume ✓");
    } catch(e: unknown) { setApplyErr(e instanceof Error ? e.message : "Error"); }
    setApplying(false);
  };

  const handleRollback = () => { setStep(1); setStep2Resume(""); setStep2Ats(null); setActiveTab("resume"); };

  const currentResume = step===2 ? step2Resume : step1Resume;
  const setCurrentResume = step===2 ? (v:string)=>setStep2Resume(v) : (v:string)=>setStep1Resume(v);
  const currentAts = step===2 ? step2Ats : step1Ats;

  const handleCopy = () => { navigator.clipboard.writeText(currentResume); setCopied(true); setTimeout(()=>setCopied(false),2000); };
  const handleDownload = () => downloadPDF(currentResume);

  return (
    <AppLayout>
      {toast && <div className="toast">{toast}</div>}

      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:28, fontWeight:800 }}>✂️ Resume Tailor</h1>
        <p style={{ color:"var(--muted)", fontSize:14, marginTop:4 }}>
          AI rewrites your resume using the JD&apos;s exact language · ATS scored · Saved to History automatically
        </p>
      </div>

      {/* Step indicator */}
      {step>0&&(
        <div style={{ display:"flex", alignItems:"center", gap:0, marginBottom:24 }}>
          {[{n:1,label:"Tailored Resume"},{n:2,label:"Final Resume"}].map(({n,label},i)=>(
            <div key={n} style={{ display:"flex", alignItems:"center" }}>
              <div style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 16px",borderRadius:100,background:step===n?"var(--accent)":step>n?"rgba(0,229,176,0.2)":"var(--surface2)",color:step===n?"#fff":step>n?"var(--accent2)":"var(--muted)",fontSize:13,fontWeight:600,fontFamily:"'Syne',sans-serif" }}>
                <span style={{ width:22,height:22,borderRadius:"50%",background:step>n?"var(--accent2)":step===n?"rgba(255,255,255,0.3)":"var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800 }}>
                  {step>n?"✓":n}
                </span>
                {label}
              </div>
              {i<1&&<div style={{ width:32,height:2,background:step>1?"var(--accent2)":"var(--border)" }}/>}
            </div>
          ))}
        </div>
      )}

      <div className="two-col">
        {/* LEFT — inputs */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={S.card}>
            <label style={S.label}>📄 Your Base Resume</label>
            <textarea value={resume} onChange={e=>setResume(e.target.value)} rows={16} style={S.textarea} placeholder="Paste your resume here..."/>
          </div>

          <div style={S.card}>
            {/* Optional job info fields */}
            <div style={{ marginBottom:14 }}>
              <label style={{ ...S.label, marginBottom:6 }}>🏷️ Job Info <span style={{ textTransform:"none",fontSize:11,color:"var(--muted)",fontWeight:400 }}>(optional — helps name this resume in History)</span></label>
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11,color:"var(--muted)",marginBottom:4 }}>Job Title</div>
                  <input
                    value={jobTitleField}
                    onChange={e=>setJobTitleField(e.target.value)}
                    placeholder="e.g. Senior Java Engineer"
                    style={S.input}
                  />
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11,color:"var(--muted)",marginBottom:4 }}>Company</div>
                  <input
                    value={companyField}
                    onChange={e=>setCompanyField(e.target.value)}
                    placeholder="e.g. Google"
                    style={S.input}
                  />
                </div>
              </div>
              <div style={{ fontSize:11,color:"var(--muted)",marginTop:6 }}>
                Leave blank → auto-extracted from JD. If extraction fails → saved as &quot;Untitled Resume&quot; (renameable in History).
              </div>
            </div>

            <label style={S.label}>📋 Job Description</label>
            <textarea value={jd} onChange={e=>setJd(e.target.value)} rows={12} style={S.textarea} placeholder="Paste the full job description here..."/>
            {tailorErr&&<div style={{ background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:12,padding:"12px 16px",fontSize:13,marginTop:12 }}>⚠️ {tailorErr}</div>}
            <div style={{ marginTop:16 }}>
              <button onClick={handleTailor} disabled={tailoring||!jd.trim()}
                style={{ ...S.btn("var(--accent)","#fff"), opacity:tailoring||!jd.trim()?0.5:1, cursor:tailoring||!jd.trim()?"not-allowed":"pointer" }}>
                {tailoring?<><span className="spinner"/>Analyzing & Tailoring...</>:"✨ Tailor Resume"}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT — output */}
        <div style={S.card}>
          {step>0&&(
            <div style={{ display:"flex",gap:4,marginBottom:16,background:"var(--surface2)",borderRadius:10,padding:4 }}>
              {(["resume","ats"] as const).map(tab=>(
                <button key={tab} onClick={()=>setActiveTab(tab)}
                  style={{ flex:1,padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,transition:"all .2s",background:activeTab===tab?"var(--accent)":"transparent",color:activeTab===tab?"#fff":"var(--muted)" }}>
                  {tab==="resume"?(step===2?"📄 Final Resume":"📄 Tailored Resume"):`🎯 ATS Score ${currentAts?`(${currentAts.score})`:""}`}
                </button>
              ))}
            </div>
          )}

          {step>0&&activeTab==="resume"&&(
            <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap" }}>
              <button onClick={handleCopy} style={{ ...S.btn("transparent","var(--accent)",true),border:"1px solid var(--accent)" }}>
                {copied?"✅ Copied!":"📋 Copy"}
              </button>
              <button onClick={handleDownload} style={{ ...S.btn("var(--surface2)","var(--text)",true),border:"1px solid var(--border)" }}>
                ⬇️ Download PDF
              </button>
              {step===2&&(
                <button onClick={handleRollback} style={{ ...S.btn("rgba(255,107,107,0.1)","var(--accent3)",true),border:"1px solid rgba(255,107,107,0.3)" }}>
                  ↩ Rollback to v1
                </button>
              )}
              {step===2&&(
                <span style={{ fontSize:11,padding:"6px 12px",borderRadius:100,background:"rgba(0,229,176,0.1)",color:"var(--accent2)",border:"1px solid rgba(0,229,176,0.3)",display:"flex",alignItems:"center" }}>
                  ✨ Final Version
                </span>
              )}
            </div>
          )}

          {step===0?(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:400,color:"var(--muted)",textAlign:"center" }}>
              <div style={{ fontSize:48,marginBottom:12 }}>🤖</div>
              <p style={{ fontSize:14 }}>Your tailored resume + ATS score will appear here</p>
              <p style={{ fontSize:12,marginTop:8 }}>Paste a JD on the left and click Tailor Resume</p>
              <p style={{ fontSize:11,marginTop:8,color:"var(--accent)" }}>All tailored resumes are saved to History automatically</p>
            </div>
          ):activeTab==="resume"?(
            <textarea value={currentResume} onChange={e=>setCurrentResume(e.target.value)}
              style={{ ...S.textarea, minHeight:500, fontFamily:"'DM Sans',monospace", fontSize:12, lineHeight:1.6 }}/>
          ):(
            currentAts?<ATSPanel ats={currentAts} onApply={handleApply} applying={applying}/>:null
          )}

          {applyErr&&(
            <div style={{ background:"rgba(255,107,107,.1)",border:"1px solid rgba(255,107,107,.3)",color:"var(--accent3)",borderRadius:12,padding:"12px 16px",fontSize:13,marginTop:12 }}>
              ⚠️ {applyErr}
            </div>
          )}

          {step===1&&activeTab==="ats"&&step1Ats&&(
            <div style={{ marginTop:16,padding:"12px 16px",background:"rgba(108,99,255,0.08)",borderRadius:12,fontSize:12,color:"var(--muted)",borderLeft:"3px solid var(--accent)" }}>
              💡 Click <strong style={{color:"var(--text)"}}>&ldquo;Apply Suggestions → Get Final Resume&rdquo;</strong> above to auto-apply all 3 improvements and get a higher-scoring version.
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

"use client";
import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import {
  getHistory, updateHistoryEntry, deleteHistoryEntry, clearHistory,
  getHistoryStats, type HistoryEntry, type HistoryStatus,
} from "@/lib/history";

// ── Status config ──────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<HistoryStatus, { label: string; color: string; bg: string }> = {
  tailored:  { label: "Tailored",    color: "#4f8ef7",         bg: "rgba(79,142,247,.12)" },
  applied:   { label: "Applied",     color: "#ffd700",         bg: "rgba(255,215,0,.1)"   },
  interview: { label: "Interview",   color: "var(--accent)",   bg: "rgba(108,99,255,.12)" },
  rejected:  { label: "Rejected",    color: "var(--accent3)",  bg: "rgba(255,107,107,.1)" },
  offer:     { label: "🏆 Offer",   color: "var(--accent2)",  bg: "rgba(0,229,176,.1)"   },
};

const STATUS_ORDER: HistoryStatus[] = ["tailored", "applied", "interview", "rejected", "offer"];

// ── PDF download (reused from tailor page) ─────────────────────────────────
function downloadResumePDF(text: string, name: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Allow popups to download PDF"); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>body{font-family:Calibri,Arial,sans-serif;font-size:10pt;padding:36pt 43pt;color:#000;line-height:1.3}
  pre{white-space:pre-wrap;font-family:inherit;font-size:9.5pt}</style>
  <title>${name}</title></head><body><pre>${text.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre></body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

// ── Export CSV ─────────────────────────────────────────────────────────────
function exportCSV(entries: HistoryEntry[]) {
  const rows = [
    ["Job Title","Company","Status","ATS Score","Apply URL","Date","Source"],
    ...entries.map(e => [
      `"${e.jobTitle}"`,
      `"${e.company}"`,
      e.status,
      String(e.atsScore ?? ""),
      `"${e.applyUrl || ""}"`,
      `"${e.createdAt}"`,
      e.sourceType === "jobs_tab" ? "Job Search" : "Tailor Tab",
    ])
  ];
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "resume_history.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── Individual history card ────────────────────────────────────────────────
function HistoryCard({
  entry,
  isMobile,
  onUpdate,
  onDelete,
  onRenameComplete,
}: {
  entry: HistoryEntry;
  isMobile: boolean;
  onUpdate: (id: string, u: Partial<HistoryEntry>) => void;
  onDelete: (id: string) => void;
  onRenameComplete?: (id: string) => void;
}) {
  const [resumeOpen, setResumeOpen] = useState(false);
  const [jdOpen, setJdOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(entry.jobTitle);
  const [renameCompany, setRenameCompany] = useState(entry.company);
  const [copied, setCopied] = useState(false);

  const sc = STATUS_CONFIG[entry.status];
  const displayName = entry.company ? `${entry.jobTitle} @ ${entry.company}` : entry.jobTitle;

  const handleSaveRename = () => {
    const t = renameTitle.trim() || "Untitled Resume";
    const c = renameCompany.trim();
    onUpdate(entry.id, { jobTitle: t, company: c, isUntitled: false });
    setRenaming(false);
    if (onRenameComplete) onRenameComplete(entry.id);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(entry.tailoredResume);
    setCopied(true); setTimeout(()=>setCopied(false),2000);
  };

  // Mobile: show resume as bottom sheet
  const handleViewResume = () => {
    if (isMobile) {
      // dispatch custom event for bottom sheet
      window.dispatchEvent(new CustomEvent("show-resume-sheet", { detail: entry }));
    } else {
      setResumeOpen(o=>!o);
    }
  };

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 16, padding: 20,
      borderLeft: `3px solid ${sc.color}`,
    }}>
      {/* Header row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:0 }}>
          {renaming ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:120 }}>
                  <div style={{ fontSize:11, color:"var(--muted)", marginBottom:3 }}>Job Title</div>
                  <input
                    value={renameTitle}
                    onChange={e=>setRenameTitle(e.target.value)}
                    style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--accent)", borderRadius:8, padding:"8px 12px", color:"var(--text)", fontSize:13, outline:"none" }}
                    autoFocus
                  />
                </div>
                <div style={{ flex:1, minWidth:120 }}>
                  <div style={{ fontSize:11, color:"var(--muted)", marginBottom:3 }}>Company</div>
                  <input
                    value={renameCompany}
                    onChange={e=>setRenameCompany(e.target.value)}
                    style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--accent)", borderRadius:8, padding:"8px 12px", color:"var(--text)", fontSize:13, outline:"none" }}
                  />
                </div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={handleSaveRename}
                  style={{ padding:"7px 16px", borderRadius:8, border:"none", background:"var(--accent)", color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                  Save
                </button>
                <button onClick={()=>setRenaming(false)}
                  style={{ padding:"7px 16px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:12, cursor:"pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700, marginBottom:3 }}>
                {entry.isUntitled ? (
                  <span style={{ color:"var(--muted)", fontStyle:"italic" }}>📄 {entry.jobTitle}</span>
                ) : displayName}
              </div>
              <div style={{ fontSize:12, color:"var(--muted)" }}>
                {entry.sourceType === "jobs_tab" ? "📋 Job Search" : "✂️ Tailor Tab"} · {entry.createdAt}
              </div>
            </>
          )}
        </div>

        {/* ATS score badge */}
        {entry.atsScore !== undefined && !renaming && (
          <div style={{
            display:"flex", flexDirection:"column", alignItems:"center",
            background: entry.atsScore >= 80 ? "rgba(0,229,176,.1)" : entry.atsScore >= 60 ? "rgba(108,99,255,.1)" : "rgba(255,107,107,.1)",
            border: `1px solid ${entry.atsScore >= 80 ? "rgba(0,229,176,.3)" : entry.atsScore >= 60 ? "rgba(108,99,255,.3)" : "rgba(255,107,107,.3)"}`,
            borderRadius: 10, padding: "6px 12px", flexShrink: 0,
          }}>
            <div style={{ fontSize:18, fontWeight:800, fontFamily:"'Syne',sans-serif",
              color: entry.atsScore >= 80 ? "var(--accent2)" : entry.atsScore >= 60 ? "var(--accent)" : "var(--accent3)" }}>
              {entry.atsScore}
            </div>
            <div style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.5 }}>ATS</div>
          </div>
        )}
      </div>

      {/* Tags row */}
      {!renaming && (
        <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap", alignItems:"center" }}>
          {entry.location  && <span style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:"var(--surface2)", color:"var(--muted)", border:"1px solid var(--border)" }}>📍 {entry.location}</span>}
          {entry.jobType   && <span style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:"var(--surface2)", color:"var(--muted)", border:"1px solid var(--border)" }}>💼 {entry.jobType}</span>}
          {entry.sponsorshipTag === "mentioned" && (
            <span style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:"rgba(0,229,176,.1)", color:"var(--accent2)", border:"1px solid rgba(0,229,176,.3)", fontWeight:600 }}>✅ Sponsors Visa</span>
          )}
          {entry.sponsorshipTag === "not_mentioned" && (
            <span style={{ fontSize:11, padding:"3px 10px", borderRadius:100, background:"rgba(112,112,160,.1)", color:"var(--muted)", border:"1px solid var(--border)" }}>❓ No Sponsor Info</span>
          )}
        </div>
      )}

      {/* Status selector */}
      {!renaming && (
        <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:14, flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:"var(--muted)", fontWeight:600 }}>Status:</span>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {STATUS_ORDER.map(s => {
              const c = STATUS_CONFIG[s];
              const isActive = entry.status === s;
              return (
                <button key={s} onClick={()=>onUpdate(entry.id, { status: s })}
                  style={{ padding:"4px 12px", borderRadius:100, fontSize:11, fontWeight:600, cursor:"pointer", transition:"all .2s", border:"none",
                    background: isActive ? c.bg : "transparent",
                    color: isActive ? c.color : "var(--muted)",
                    outline: isActive ? `1px solid ${c.color}50` : "1px solid var(--border)",
                  }}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!renaming && (
        <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
          <button onClick={handleViewResume}
            style={{ padding:"7px 14px", borderRadius:8, border:"1px solid var(--accent)", background:"transparent", color:"var(--accent)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
            {resumeOpen ? "▲ Hide Resume" : "📄 View Resume"}
          </button>
          <button onClick={()=>setJdOpen(o=>!o)}
            style={{ padding:"7px 14px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
            {jdOpen ? "▲ Hide JD" : "📋 View JD"}
          </button>
          {entry.applyUrl && entry.applyUrl !== "#" && (
            <a href={entry.applyUrl} target="_blank" rel="noopener noreferrer"
              onClick={()=>{ if(entry.status==="tailored") onUpdate(entry.id, { status:"applied" }); }}
              style={{ padding:"7px 14px", borderRadius:8, border:"1px solid rgba(0,229,176,.4)", background:"rgba(0,229,176,.08)", color:"var(--accent2)", fontSize:12, fontWeight:600, cursor:"pointer", textDecoration:"none" }}>
              🔗 Apply ↗
            </a>
          )}
          {entry.isUntitled && (
            <button onClick={()=>setRenaming(true)}
              style={{ padding:"7px 14px", borderRadius:8, border:"1px solid rgba(108,99,255,.4)", background:"rgba(108,99,255,.08)", color:"var(--accent)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
              ✏️ Rename
            </button>
          )}
          <button onClick={()=>downloadResumePDF(entry.tailoredResume, displayName)}
            style={{ padding:"7px 14px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:12, cursor:"pointer" }}>
            ⬇️ PDF
          </button>
          <button onClick={()=>onDelete(entry.id)}
            style={{ padding:"7px 14px", borderRadius:8, border:"1px solid rgba(255,107,107,.3)", background:"transparent", color:"var(--accent3)", fontSize:12, cursor:"pointer", marginLeft:"auto" }}>
            🗑️
          </button>
        </div>
      )}

      {/* Inline resume view (desktop) */}
      {resumeOpen && !isMobile && (
        <div style={{ marginTop:14, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:700 }}>📄 Tailored Resume</span>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={handleCopy}
                style={{ padding:"5px 12px", borderRadius:8, border:"1px solid var(--accent)", background:"transparent", color:"var(--accent)", fontSize:11, cursor:"pointer" }}>
                {copied?"✅ Copied!":"📋 Copy"}
              </button>
              <button onClick={()=>setResumeOpen(false)}
                style={{ padding:"5px 12px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:11, cursor:"pointer" }}>
                ✕ Close
              </button>
            </div>
          </div>
          <pre style={{ fontSize:12, lineHeight:1.6, whiteSpace:"pre-wrap", maxHeight:400, overflowY:"auto", color:"var(--text)", margin:0, fontFamily:"'DM Sans',monospace" }}>
            {entry.tailoredResume}
          </pre>
        </div>
      )}

      {/* Inline JD view */}
      {jdOpen && (
        <div style={{ marginTop:14, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:700 }}>📋 Job Description</span>
            <button onClick={()=>setJdOpen(false)}
              style={{ padding:"5px 12px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:11, cursor:"pointer" }}>
              ✕ Close
            </button>
          </div>
          <p style={{ fontSize:12, lineHeight:1.6, color:"var(--muted)", margin:0, whiteSpace:"pre-wrap" }}>
            {entry.jobDescription}
            {entry.jobDescription.length >= 999 && " …(truncated)"}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main History Page ──────────────────────────────────────────────────────
export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState({ total: 0, tailored: 0, applied: 0, interviews: 0, offers: 0 });
  const [activeFilter, setActiveFilter] = useState<"all" | HistoryStatus>("all");
  const [searchQ, setSearchQ] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  // Bottom sheet state (mobile)
  const [sheetEntry, setSheetEntry] = useState<HistoryEntry | null>(null);
  const [sheetCopied, setSheetCopied] = useState(false);

  // Confirmation dialog for Clear All
  const [confirmClear, setConfirmClear] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(()=>new Set(["Today"]));

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  const reload = useCallback(() => {
    setEntries(getHistory());
    setStats(getHistoryStats());
  }, []);

  useEffect(() => {
    reload();
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);

    // Listen for mobile bottom-sheet events from HistoryCard
    const handler = (e: Event) => {
      const entry = (e as CustomEvent).detail as HistoryEntry;
      setSheetEntry(entry);
    };
    window.addEventListener("show-resume-sheet", handler);

    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("show-resume-sheet", handler);
    };
  }, [reload]);

  const handleUpdate = (id: string, updates: Partial<HistoryEntry>) => {
    updateHistoryEntry(id, updates);
    reload();
  };

  const handleDelete = (id: string) => {
    deleteHistoryEntry(id);
    reload();
  };

  const handleClearAll = () => {
    clearHistory();
    setConfirmClear(false);
    reload();
  };

  // Filter + search
  const filtered = entries.filter(e => {
    if (activeFilter !== "all" && e.status !== activeFilter) return false;
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      if (!e.jobTitle.toLowerCase().includes(q) && !e.company.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const named = filtered.filter(e => !e.isUntitled);
  const untitled = filtered.filter(e => e.isUntitled);

  // ── Date grouping ──────────────────────────────────────────────────────
  function getDateLabel(timestamp: number): string {
    const now = new Date();
    const d = new Date(timestamp);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yestStart = todayStart - 86400000;
    if (timestamp >= todayStart) return "Today";
    if (timestamp >= yestStart) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // Group named entries by date label
  const dateGroups: { label: string; entries: typeof named }[] = [];
  for (const e of named) {
    const label = getDateLabel(e.timestamp);
    const existing = dateGroups.find(g => g.label === label);
    if (existing) existing.entries.push(e);
    else dateGroups.push({ label, entries: [e] });
  }

  const filterTabs: { label: string; value: "all" | HistoryStatus; count: number }[] = [
    { label: "All", value: "all", count: entries.length },
    { label: "Tailored", value: "tailored", count: entries.filter(e=>e.status==="tailored").length },
    { label: "Applied", value: "applied", count: entries.filter(e=>e.status==="applied").length },
    { label: "Interview", value: "interview", count: entries.filter(e=>e.status==="interview").length },
    { label: "Rejected", value: "rejected", count: entries.filter(e=>e.status==="rejected").length },
    { label: "Offers", value: "offer", count: entries.filter(e=>e.status==="offer").length },
  ];

  return (
    <AppLayout>
      {/* Mobile bottom sheet */}
      {sheetEntry && (
        <>
          <div className="bottom-sheet-overlay" onClick={()=>setSheetEntry(null)}/>
          <div className="bottom-sheet">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontSize:15, fontWeight:700 }}>📄 Tailored Resume</span>
              <div style={{ display:"flex", gap:8 }}>
                <button
                  onClick={()=>{ navigator.clipboard.writeText(sheetEntry.tailoredResume); setSheetCopied(true); setTimeout(()=>setSheetCopied(false),2000); }}
                  style={{ padding:"6px 12px", borderRadius:8, border:"1px solid var(--accent)", background:"transparent", color:"var(--accent)", fontSize:12, cursor:"pointer" }}>
                  {sheetCopied?"✅":"📋 Copy"}
                </button>
                <button onClick={()=>setSheetEntry(null)}
                  style={{ padding:"6px 12px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:12, cursor:"pointer" }}>
                  ✕
                </button>
              </div>
            </div>
            <div style={{ fontSize:13, color:"var(--muted)", marginBottom:12 }}>
              {sheetEntry.company ? `${sheetEntry.jobTitle} @ ${sheetEntry.company}` : sheetEntry.jobTitle}
            </div>
            <pre style={{ fontSize:11, lineHeight:1.6, whiteSpace:"pre-wrap", color:"var(--text)", margin:0, fontFamily:"'DM Sans',monospace" }}>
              {sheetEntry.tailoredResume}
            </pre>
          </div>
        </>
      )}

      {/* Confirm clear dialog */}
      {confirmClear && (
        <>
          <div className="bottom-sheet-overlay" onClick={()=>setConfirmClear(false)}/>
          <div style={{ position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)", zIndex:201, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:16, padding:24, maxWidth:360, width:"90%" }}>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:8 }}>⚠️ Clear All History?</div>
            <p style={{ fontSize:14, color:"var(--muted)", marginBottom:20 }}>
              This will permanently delete all {entries.length} saved resume entries. This cannot be undone.
            </p>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={handleClearAll}
                style={{ flex:1, padding:"10px", borderRadius:10, border:"none", background:"var(--accent3)", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                Yes, Clear All
              </button>
              <button onClick={()=>setConfirmClear(false)}
                style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid var(--border)", background:"transparent", color:"var(--text)", fontSize:13, cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Page header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24, flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontSize:28, fontWeight:800 }}>📁 History</h1>
          <p style={{ color:"var(--muted)", fontSize:14, marginTop:4 }}>
            Every tailored resume saved automatically · Track your application journey
          </p>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {entries.length > 0 && (
            <>
              <button onClick={()=>exportCSV(entries)}
                style={{ padding:"8px 16px", borderRadius:10, border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                ⬇️ Export CSV
              </button>
              <button onClick={()=>setConfirmClear(true)}
                style={{ padding:"8px 16px", borderRadius:10, border:"1px solid rgba(255,107,107,.3)", background:"transparent", color:"var(--accent3)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                🗑️ Clear All
              </button>
            </>
          )}
        </div>
      </div>

      {/* Quick stats bar */}
      {stats.total > 0 && (
        <div style={{
          display:"flex", gap:20, flexWrap:"wrap",
          background:"var(--card)", border:"1px solid var(--border)",
          borderRadius:14, padding:"16px 20px", marginBottom:24,
        }}>
          {[
            { label:"Tailored",   val:stats.total,      color:"var(--accent)" },
            { label:"Applied",    val:stats.applied,    color:"#4f8ef7" },
            { label:"Interviews", val:stats.interviews, color:"var(--accent2)" },
            { label:"Offers",     val:stats.offers,     color:"#ffd700" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:22, fontWeight:800, fontFamily:"'Syne',sans-serif", color }}>{val}</span>
              <span style={{ fontSize:12, color:"var(--muted)" }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filter + Search bar */}
      {entries.length > 0 && (
        <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {filterTabs.map(({ label, value, count }) => (
              <button key={value} onClick={()=>setActiveFilter(value)}
                style={{
                  padding:"6px 14px", borderRadius:100, fontSize:12, fontWeight:600,
                  cursor:"pointer", border:"none", transition:"all .2s",
                  background: activeFilter===value ? "var(--accent)" : "var(--surface2)",
                  color: activeFilter===value ? "#fff" : "var(--muted)",
                }}>
                {label} {count > 0 && <span style={{ fontSize:10, opacity:0.8 }}>({count})</span>}
              </button>
            ))}
          </div>
          <input
            value={searchQ}
            onChange={e=>setSearchQ(e.target.value)}
            placeholder="🔍 Search by title or company..."
            style={{ flex:1, minWidth:160, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"8px 14px", color:"var(--text)", fontSize:13, outline:"none" }}
          />
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && (
        <div style={{ textAlign:"center", padding:"80px 20px", color:"var(--muted)" }}>
          <div style={{ fontSize:56, marginBottom:16 }}>📂</div>
          <div style={{ fontSize:18, fontWeight:700, color:"var(--text)", marginBottom:8 }}>No history yet</div>
          <p style={{ fontSize:14, maxWidth:400, margin:"0 auto", lineHeight:1.6 }}>
            Tailor your first resume in the <strong style={{color:"var(--accent)"}}>Tailor Resume</strong> tab
            or search for jobs in <strong style={{color:"var(--accent)"}}>Job Search</strong>.
            Every tailored resume is saved here automatically.
          </p>
        </div>
      )}

      {/* Main history list — grouped by date */}
      {dateGroups.length > 0 && (
        <div style={{ marginBottom: 32, display: "flex", flexDirection: "column", gap: 8 }}>
          {dateGroups.map(({ label, entries: groupEntries }) => {
            const isOpen = openGroups.has(label);
            return (
              <div key={label} style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
                {/* Accordion header */}
                <div
                  onClick={() => toggleGroup(label)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 18px", cursor: "pointer", userSelect: "none",
                    background: isOpen ? "rgba(108,99,255,0.06)" : "var(--surface)",
                    borderBottom: isOpen ? "1px solid var(--border)" : "none",
                    transition: "background 0.2s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Syne',sans-serif", color: label === "Today" ? "var(--accent)" : label === "Yesterday" ? "var(--accent2)" : "var(--text)" }}>
                      {label === "Today" ? "🗓 Today" : label === "Yesterday" ? "📅 Yesterday" : `📅 ${label}`}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>
                      ({groupEntries.length} {groupEntries.length === 1 ? "resume" : "resumes"})
                    </span>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--muted)", transition: "transform 0.2s", display: "inline-block", transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>▼</span>
                </div>
                {/* Accordion body */}
                {isOpen && (
                  <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", gap: 12, background: "var(--bg)" }}>
                    {groupEntries.map(entry => (
                      <HistoryCard
                        key={entry.id}
                        entry={entry}
                        isMobile={isMobile}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No results state */}
      {entries.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign:"center", padding:"40px 20px", color:"var(--muted)" }}>
          <div style={{ fontSize:36, marginBottom:12 }}>🔍</div>
          <p style={{ fontSize:14 }}>No resumes match your filter or search.</p>
        </div>
      )}

      {/* Untitled resumes section */}
      {untitled.length > 0 && (
        <div>
          <div style={{
            display:"flex", alignItems:"center", gap:12, marginBottom:16,
            padding:"12px 16px", background:"rgba(108,99,255,.06)",
            border:"1px solid rgba(108,99,255,.15)", borderRadius:12,
          }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--accent)" }}>
                📂 Untitled Resumes ({untitled.length})
              </div>
              <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>
                These were tailored without a job title or company. Tap ✏️ Rename to name them and move to main history.
              </div>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {untitled.map(entry => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                isMobile={isMobile}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onRenameComplete={() => reload()}
              />
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  );
}

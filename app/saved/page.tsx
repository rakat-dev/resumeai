"use client";
import { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { getSavedJobs, unsaveJob, type SavedJob } from "@/lib/savedJobs";

function SourceBadge({ source, sourceType }: { source: string; sourceType?: string }) {
  const C: Record<string, { bg: string; color: string }> = {
    greenhouse: { bg: "rgba(0,200,100,0.1)",   color: "#00c864" },
    lever:      { bg: "rgba(0,150,255,0.1)",   color: "#0096ff" },
    remotive:   { bg: "rgba(150,100,255,0.1)", color: "#9664ff" },
    jsearch:    { bg: "rgba(112,112,160,0.1)", color: "#7070a0" },
    other:      { bg: "rgba(112,112,160,0.1)", color: "#7070a0" },
  };
  const c = C[sourceType || "other"] || C.other;
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: c.bg, color: c.color, border: `1px solid ${c.color}40` }}>{source}</span>;
}

const S = {
  card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 20 } as React.CSSProperties,
  tag:  { fontSize: 11, padding: "3px 9px", borderRadius: 100, background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)" } as React.CSSProperties,
};

export default function SavedPage() {
  const [saved, setSaved] = useState<SavedJob[]>([]);

  useEffect(() => { setSaved(getSavedJobs()); }, []);

  const handleUnsave = (id: string) => {
    unsaveJob(id);
    setSaved(getSavedJobs());
  };

  return (
    <AppLayout>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>💾 Saved Jobs</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
          {saved.length > 0 ? `${saved.length} job${saved.length === 1 ? "" : "s"} saved` : "Jobs you bookmark will appear here"}
        </p>
      </div>

      {saved.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--muted)" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔖</div>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No saved jobs yet</p>
          <p style={{ fontSize: 13 }}>Click the 🔖 bookmark on any job card to save it here</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {saved.map(job => (
            <div key={job.id} style={{ ...S.card }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{job.title}</div>
                  <div style={{ fontSize: 13, color: "var(--accent2)", fontWeight: 500 }}>{job.company}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "rgba(0,229,176,.1)", color: "var(--accent2)", border: "1px solid rgba(0,229,176,.3)", whiteSpace: "nowrap" }}>
                    🕐 {job.postedDate}
                  </span>
                  <SourceBadge source={job.source} sourceType={job.sourceType} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                {job.location  && <span style={S.tag}>📍 {job.location}</span>}
                {job.type      && <span style={S.tag}>💼 {job.type}</span>}
                {job.salary    && <span style={S.tag}>💰 {job.salary}</span>}
                {job.experience && <span style={S.tag}>⏱ {job.experience}</span>}
                {job.sponsorshipTag === "mentioned" && (
                  <span style={{ ...S.tag, color: "#00c864", borderColor: "rgba(0,200,100,0.3)", background: "rgba(0,200,100,0.08)" }}>✅ Visa mentioned</span>
                )}
              </div>

              {job.description && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
                  {job.description.slice(0, 220)}…
                </div>
              )}

              {job.skills && job.skills.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#ff9500", fontWeight: 600, marginBottom: 4 }}>⚠️ Skills you&apos;re missing</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {job.skills.map((s, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, background: "rgba(255,149,0,0.1)", color: "#ff9500", border: "1px solid rgba(255,149,0,0.35)", fontWeight: 500 }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Saved at + actions */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  Saved {new Date(job.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  {job.applyUrl && job.applyUrl !== "#" && (
                    <a href={job.applyUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10, fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12, textDecoration: "none", background: "var(--accent2)", color: "#0a0a0f" }}>
                      🚀 Apply
                    </a>
                  )}
                  <button onClick={() => handleUnsave(job.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10, fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12, cursor: "pointer", border: "1px solid rgba(255,107,107,0.3)", background: "rgba(255,107,107,0.08)", color: "var(--accent3)" }}>
                    🗑 Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

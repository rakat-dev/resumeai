"use client";
import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { getSavedJobs, unsaveJob, type SavedJob } from "@/lib/savedJobs";
import { loadJobCache } from "@/lib/jobCache";
import { getBaseResume } from "@/lib/baseResume";
import JDModal from "@/components/JDModal";

// ── Per-job enrichment ────────────────────────────────────────────────────
// Stored in parent state so badges survive re-renders.
// Source of truth:
//   viewedAt / tailoredAt / dismissedAt → /api/jobs (DB-backed)
//   fullDescription                     → IndexedDB cache (JD text only)
// IDB is fallback for status only when a job is absent from /api/jobs (e.g. dismissed).
type EnrichedState = {
  fullDescription?: string;
  viewedAt?:        string | null;
  tailoredAt?:      string | null;
  dismissedAt?:     string | null;
};

// ── Tailor result modal data ───────────────────────────────────────────────
type TailorResult = {
  jobId:    string;
  title:    string;
  company:  string;
  applyUrl: string;
  tailored: string;
};

// ── Dismissed job shape (from GET /api/jobs/dismissed) ────────────────────
type DismissedJob = {
  id:          string;
  title:       string;
  company:     string;
  location:    string;
  source:      string;
  sourceType:  string;
  applyUrl:    string;
  postedDate:  string;
  dismissedAt: string;
  viewedAt?:   string | null;
  tailoredAt?: string | null;
};

// ── Fire-and-forget status POST ────────────────────────────────────────────
async function postStatus(jobId: string, action: "viewed" | "tailored" | "dismissed" | "undismissed") {
  try {
    await fetch("/api/jobs/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, action }),
    });
  } catch (e) {
    console.warn("[postStatus] failed:", action, e);
  }
}

// ── Source badge ───────────────────────────────────────────────────────────
function SourceBadge({ source, sourceType }: { source: string; sourceType?: string }) {
  const C: Record<string, { bg: string; color: string }> = {
    greenhouse: { bg: "rgba(0,200,100,0.1)",   color: "#00c864" },
    lever:      { bg: "rgba(0,150,255,0.1)",   color: "#0096ff" },
    remotive:   { bg: "rgba(150,100,255,0.1)", color: "#9664ff" },
    jsearch:    { bg: "rgba(112,112,160,0.1)", color: "#7070a0" },
    other:      { bg: "rgba(112,112,160,0.1)", color: "#7070a0" },
  };
  const c = C[sourceType || "other"] || C.other;
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: c.bg, color: c.color, border: `1px solid ${c.color}40` }}>
      {source}
    </span>
  );
}

// ── Tailor result modal ────────────────────────────────────────────────────
function TailorResultModal({ result, onClose }: { result: TailorResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(result.tailored).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
      <div style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, width: "min(680px,95vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 1 }}>
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15 }}>✨ Tailored Resume</div>
            <div style={{ fontSize: 12, color: "var(--accent2)", fontWeight: 500 }}>{result.title} · {result.company}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={handleCopy}
              style={{ padding: "6px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
              {copied ? "✅ Copied!" : "📋 Copy"}
            </button>
            {result.applyUrl && result.applyUrl !== "#" && (
              <a href={result.applyUrl} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", padding: "6px 12px", borderRadius: 9, background: "var(--accent2)", color: "#0a0a0f", fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "'Syne',sans-serif" }}>
                🚀 Apply
              </a>
            )}
            <button onClick={onClose}
              style={{ padding: "6px 10px", borderRadius: 9, border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}>
              ✕
            </button>
          </div>
        </div>
        <div style={{ overflowY: "auto", padding: "16px 20px", flex: 1 }}>
          <pre style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
            {result.tailored}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────
const S = {
  card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 20 } as React.CSSProperties,
  tag:  { fontSize: 11, padding: "3px 9px", borderRadius: 100, background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)" } as React.CSSProperties,
  btn:  (bg: string, color: string) => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 14px", borderRadius: 10,
    fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12,
    cursor: "pointer", border: "none", background: bg, color,
    textDecoration: "none",
  } as React.CSSProperties),
};

// ── Main page ──────────────────────────────────────────────────────────────
export default function SavedPage() {
  const [saved,        setSaved]        = useState<SavedJob[]>([]);
  // enriched: parent-level Map so viewedAt/tailoredAt badges survive re-renders
  const [enriched,     setEnriched]     = useState<Map<string, EnrichedState>>(new Map());
  const [jdJob,        setJdJob]        = useState<SavedJob | null>(null);
  const [tailoringId,  setTailoringId]  = useState<string | null>(null);
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
  const [tailorErrors, setTailorErrors] = useState<Record<string, string>>({});

  // ── Dismissed tab state ───────────────────────────────────────────────────
  type ActiveTab = "saved" | "dismissed";
  const [activeTab,         setActiveTab]         = useState<ActiveTab>("saved");
  const [dismissedJobs,     setDismissedJobs]     = useState<(DismissedJob)[]>([]);
  const [dismissedLoading,  setDismissedLoading]  = useState(false);
  const [dismissedLoaded,   setDismissedLoaded]   = useState(false);
  const [dismissedErr,      setDismissedErr]      = useState("");

  // ── Two-phase load on mount ───────────────────────────────────────────────
  useEffect(() => {
    const currentSaved = getSavedJobs();
    setSaved(currentSaved);
    const savedIds = new Set(currentSaved.map(j => j.id));

    (async () => {
      // Phase 1 — IDB: fullDescription (JD text) + status as fallback only
      // IDB status is used only for jobs absent from the /api/jobs response
      // (e.g. dismissed jobs). It is never preferred over DB status.
      type IdbEntry = { fullDescription?: string; viewedAt?: string | null; tailoredAt?: string | null };
      const idbMap = new Map<string, IdbEntry>();
      const cache = await loadJobCache();
      if (cache) {
        cache.jobs.forEach(j => {
          if (savedIds.has(j.id)) {
            idbMap.set(j.id, {
              fullDescription: j.fullDescription ?? undefined,
              viewedAt:        j.viewedAt        ?? null,
              tailoredAt:      j.tailoredAt      ?? null,
            });
          }
        });
      }

      // Phase 2 — /api/jobs: DB-backed status (source of truth)
      // Dismissed jobs are excluded from this response (CP3 filter).
      // For dismissed saved jobs, we fall back to IDB status below.
      type DbEntry = { viewedAt?: string | null; tailoredAt?: string | null; dismissedAt?: string | null };
      const dbMap = new Map<string, DbEntry>();
      try {
        const res = await fetch("/api/jobs?filter=any");
        if (res.ok) {
          const data = await res.json() as { jobs: Array<{ id: string; viewedAt?: string | null; tailoredAt?: string | null; dismissedAt?: string | null }> };
          data.jobs.forEach(j => {
            if (savedIds.has(j.id)) {
              dbMap.set(j.id, {
                viewedAt:    j.viewedAt    ?? null,
                tailoredAt:  j.tailoredAt  ?? null,
                dismissedAt: j.dismissedAt ?? null,
              });
            }
          });
        }
      } catch (e) {
        console.warn("[saved] DB status fetch failed (non-fatal):", e);
      }

      // Merge — DB status takes precedence.
      // If a job is missing from /api/jobs (dismissed), fall back to IDB for
      // viewedAt/tailoredAt so previously-seen badges aren't lost.
      // dismissedAt for dismissed saved jobs is handled in CP6.
      const merged = new Map<string, EnrichedState>();
      currentSaved.forEach(job => {
        const idb      = idbMap.get(job.id) ?? {};
        const db       = dbMap.get(job.id);
        const inDb     = dbMap.has(job.id);
        merged.set(job.id, {
          fullDescription: idb.fullDescription,
          viewedAt:    inDb ? (db!.viewedAt    ?? null) : (idb.viewedAt    ?? null),
          tailoredAt:  inDb ? (db!.tailoredAt  ?? null) : (idb.tailoredAt  ?? null),
          dismissedAt: inDb ? (db!.dismissedAt ?? null) : null,
        });
      });
      setEnriched(merged);
    })();
  }, []);

  // ── Parent-level enriched updater ─────────────────────────────────────────
  // Badges read from this Map — never from per-card local state.
  const updateEnriched = useCallback((jobId: string, patch: Partial<EnrichedState>) => {
    setEnriched(prev => {
      const next = new Map(prev);
      next.set(jobId, { ...(prev.get(jobId) ?? {}), ...patch });
      return next;
    });
  }, []);

  // ── Dismissed tab: load on first switch ──────────────────────────────────
  const loadDismissed = useCallback(async () => {
    if (dismissedLoaded) return;
    setDismissedLoading(true);
    setDismissedErr("");
    try {
      const res  = await fetch("/api/jobs/dismissed");
      const data = await res.json() as { jobs?: DismissedJob[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load dismissed jobs");
      setDismissedJobs(data.jobs ?? []);
      setDismissedLoaded(true);
    } catch (e: unknown) {
      setDismissedErr(e instanceof Error ? e.message : "Failed to load dismissed jobs");
    }
    setDismissedLoading(false);
  }, [dismissedLoaded]);

  const handleSwitchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === "dismissed") loadDismissed();
  };

  // Restore a dismissed job — removes from dismissed list optimistically
  const handleRestore = (jobId: string) => {
    setDismissedJobs(prev => prev.filter(j => j.id !== jobId));
    postStatus(jobId, "undismissed");
  };

  // ── Get best available JD text ────────────────────────────────────────────
  const getJD = (job: SavedJob): { text: string; isFull: boolean } => {
    const e = enriched.get(job.id);
    if (e?.fullDescription) return { text: e.fullDescription, isFull: true };
    if (job.description)    return { text: job.description,   isFull: false };
    return { text: "Full JD unavailable for this job.", isFull: false };
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleUnsave = (id: string) => {
    unsaveJob(id);
    setSaved(getSavedJobs());
  };

  // View — opens apply URL, marks viewed
  const handleView = (job: SavedJob) => {
    const e = enriched.get(job.id);
    if (!e?.viewedAt) {
      updateEnriched(job.id, { viewedAt: new Date().toISOString() });
      postStatus(job.id, "viewed");
    }
    window.open(job.applyUrl, "_blank", "noopener,noreferrer");
  };

  // JD — opens modal, marks viewed
  const handleOpenJD = (job: SavedJob) => {
    setJdJob(job);
    const e = enriched.get(job.id);
    if (!e?.viewedAt) {
      updateEnriched(job.id, { viewedAt: new Date().toISOString() });
      postStatus(job.id, "viewed");
    }
  };

  // Tailor & Apply — inline tailor; marks tailored on API success (not on click)
  const handleTailor = async (job: SavedJob) => {
    setTailoringId(job.id);
    setTailorErrors(prev => { const n = { ...prev }; delete n[job.id]; return n; });

    const resume = getBaseResume();
    const { text: jd, isFull } = getJD(job);
    const jdForApi = isFull
      ? jd
      : `[Note: Full JD unavailable — using description preview]\n\n${jd}`;

    try {
      const res  = await fetch("/api/tailor", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ resume, jobDescription: jdForApi, jobTitle: job.title, company: job.company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tailoring failed");

      // Mark tailored only on success
      updateEnriched(job.id, { tailoredAt: new Date().toISOString() });
      postStatus(job.id, "tailored");

      setTailorResult({ jobId: job.id, title: job.title, company: job.company, applyUrl: job.applyUrl, tailored: data.tailored });
    } catch (e: unknown) {
      setTailorErrors(prev => ({ ...prev, [job.id]: e instanceof Error ? e.message : "Tailoring failed" }));
    }

    setTailoringId(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {/* JD modal */}
      {jdJob && (() => {
        const { text, isFull } = getJD(jdJob);
        const displayText = isFull ? text : `[Full JD unavailable — showing preview only]\n\n${text}`;
        return (
          <JDModal
            jobId={jdJob.id}
            title={jdJob.title}
            company={jdJob.company}
            description={displayText}
            onClose={() => setJdJob(null)}
          />
        );
      })()}

      {/* Tailor result modal */}
      {tailorResult && (
        <TailorResultModal result={tailorResult} onClose={() => setTailorResult(null)} />
      )}

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>💾 Saved Jobs</h1>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {(["saved","dismissed"] as const).map(tab => {
          const isActive = activeTab === tab;
          const label    = tab === "saved"
            ? `💾 Saved${saved.length > 0 ? ` (${saved.length})` : ""}`
            : `🚫 Dismissed${dismissedLoaded && dismissedJobs.length > 0 ? ` (${dismissedJobs.length})` : ""}`;
          return (
            <button key={tab} onClick={() => handleSwitchTab(tab)}
              style={{ padding: "8px 18px", borderRadius: 10, border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)", background: isActive ? "rgba(108,99,255,0.12)" : "var(--surface2)", color: isActive ? "var(--accent)" : "var(--muted)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne',sans-serif", transition: "all .15s" }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Saved tab ── */}
      {activeTab === "saved" && (saved.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--muted)" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔖</div>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No saved jobs yet</p>
          <p style={{ fontSize: 13 }}>Click the 🔖 bookmark on any job card to save it here</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {saved.map(job => {
            const e           = enriched.get(job.id) ?? {};
            const isTailoring = tailoringId === job.id;
            const tailorErr   = tailorErrors[job.id];
            const hasJD       = !!(e.fullDescription || job.description);

            return (
              <div key={job.id} style={{ ...S.card }}>
                {/* Title + badges */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{job.title}</div>
                    <div style={{ fontSize: 13, color: "var(--accent2)", fontWeight: 500 }}>{job.company}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "rgba(0,229,176,.1)", color: "var(--accent2)", border: "1px solid rgba(0,229,176,.3)", whiteSpace: "nowrap" }}>
                      🕐 {job.postedDate}
                    </span>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {/* Badges sourced from enriched parent state — not per-card local state */}
                      {!!e.viewedAt   && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(108,99,255,0.08)",  color: "var(--accent)",  border: "1px solid rgba(108,99,255,0.25)",  whiteSpace: "nowrap", fontWeight: 600 }}>👁 Viewed</span>}
                      {!!e.tailoredAt && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(0,229,176,0.08)",    color: "var(--accent2)", border: "1px solid rgba(0,229,176,0.25)",    whiteSpace: "nowrap", fontWeight: 600 }}>✨ Tailored</span>}
                      <SourceBadge source={job.source} sourceType={job.sourceType} />
                    </div>
                  </div>
                </div>

                {/* Metadata tags */}
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {job.location   && <span style={S.tag}>📍 {job.location}</span>}
                  {job.type       && <span style={S.tag}>💼 {job.type}</span>}
                  {job.salary     && <span style={S.tag}>💰 {job.salary}</span>}
                  {job.experience && <span style={S.tag}>⏱ {job.experience}</span>}
                  {job.sponsorshipTag === "mentioned" && (
                    <span style={{ ...S.tag, color: "#00c864", borderColor: "rgba(0,200,100,0.3)", background: "rgba(0,200,100,0.08)" }}>✅ Visa mentioned</span>
                  )}
                </div>

                {/* Description snippet */}
                {job.description && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
                    {job.description.slice(0, 220)}…
                  </div>
                )}

                {/* Gap skills */}
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

                {/* Tailor error */}
                {tailorErr && (
                  <div style={{ fontSize: 11, color: "var(--accent3)", marginTop: 8 }}>⚠️ {tailorErr}</div>
                )}

                {/* Action row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    Saved {new Date(job.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {/* View — opens apply URL, marks viewed */}
                    {job.applyUrl && job.applyUrl !== "#" && (
                      <button onClick={() => handleView(job)}
                        style={{ ...S.btn("var(--surface2)", "var(--text)"), border: "1px solid var(--border)" }}>
                        🔗 View
                      </button>
                    )}

                    {/* JD — opens full JD modal, marks viewed */}
                    {hasJD && (
                      <button onClick={() => handleOpenJD(job)}
                        style={{ ...S.btn("var(--surface2)", "var(--accent)"), border: "1px solid rgba(108,99,255,0.4)" }}>
                        📋 JD
                      </button>
                    )}

                    {/* Tailor & Apply — inline tailor, marks tailored on success */}
                    <button
                      onClick={() => { if (!isTailoring) handleTailor(job); }}
                      disabled={isTailoring}
                      style={{ ...S.btn("var(--accent)", "#fff"), opacity: isTailoring ? 0.6 : 1, cursor: isTailoring ? "not-allowed" : "pointer" }}>
                      {isTailoring ? "✨ Tailoring…" : "✨ Tailor & Apply"}
                    </button>

                    {/* Remove */}
                    <button onClick={() => handleUnsave(job.id)}
                      style={{ ...S.btn("rgba(255,107,107,0.08)", "var(--accent3)"), border: "1px solid rgba(255,107,107,0.3)" }}>
                      🗑 Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* ── Dismissed tab ── */}
      {activeTab === "dismissed" && (
        dismissedLoading ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)" }}>
            <div style={{ fontSize: 13 }}>Loading dismissed jobs…</div>
          </div>
        ) : dismissedErr ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--accent3)" }}>
            <p>⚠️ {dismissedErr}</p>
            <button onClick={() => { setDismissedLoaded(false); loadDismissed(); }}
              style={{ ...S.btn("var(--surface2)", "var(--text)"), border: "1px solid var(--border)", marginTop: 12 }}>
              Retry
            </button>
          </div>
        ) : dismissedJobs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--muted)" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🚫</div>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No dismissed jobs</p>
            <p style={{ fontSize: 13 }}>Jobs you dismiss from the job feed appear here</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {dismissedJobs.map(job => (
              <div key={job.id} style={{ ...S.card, opacity: 0.85 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{job.title}</div>
                    <div style={{ fontSize: 12, color: "var(--accent2)", fontWeight: 500 }}>{job.company}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(255,107,107,0.08)", color: "var(--accent3)", border: "1px solid rgba(255,107,107,0.25)", whiteSpace: "nowrap", fontWeight: 600 }}>
                      🚫 Dismissed {new Date(job.dismissedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {!!job.viewedAt   && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(108,99,255,0.08)",  color: "var(--accent)",  border: "1px solid rgba(108,99,255,0.25)",  whiteSpace: "nowrap", fontWeight: 600 }}>👁 Viewed</span>}
                      {!!job.tailoredAt && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(0,229,176,0.08)",    color: "var(--accent2)", border: "1px solid rgba(0,229,176,0.25)",    whiteSpace: "nowrap", fontWeight: 600 }}>✨ Tailored</span>}
                      <SourceBadge source={job.source} sourceType={job.sourceType} />
                    </div>
                  </div>
                </div>

                {job.location && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <span style={S.tag}>📍 {job.location}</span>
                    <span style={{ ...S.tag, fontSize: 10, color: "var(--muted)" }}>Posted {job.postedDate}</span>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
                  {job.applyUrl && job.applyUrl !== "#" && (
                    <a href={job.applyUrl} target="_blank" rel="noopener noreferrer"
                      style={{ ...S.btn("var(--surface2)", "var(--text)"), border: "1px solid var(--border)" }}>
                      🔗 View
                    </a>
                  )}
                  <button onClick={() => handleRestore(job.id)}
                    style={{ ...S.btn("rgba(0,229,176,0.08)", "var(--accent2)"), border: "1px solid rgba(0,229,176,0.3)" }}>
                    ↩ Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </AppLayout>
  );
}

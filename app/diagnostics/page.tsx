"use client";
import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import type {
  LatestRefreshDiagnostics,
  SourceDiagnostics,
  RejectedJobSample,
} from "@/lib/diagnostics";

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function Badge({ n, warn, danger }: { n: number; warn?: boolean; danger?: boolean }) {
  const base = "inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold";
  if (danger && n > 0) return <span className={`${base} bg-red-100 text-red-700`}>{n}</span>;
  if (warn && n > 0) return <span className={`${base} bg-amber-100 text-amber-700`}>{n}</span>;
  if (n === 0) return <span className={`${base} text-gray-400`}>0</span>;
  return <span className={`${base} bg-blue-50 text-blue-700`}>{n}</span>;
}

// ── Sample card ───────────────────────────────────────────────────────────────
function SampleCard({ s }: { s: RejectedJobSample }) {
  return (
    <div className="border border-gray-200 rounded p-2 text-xs space-y-0.5 bg-white">
      <div className="font-medium text-gray-800 truncate">{s.title ?? "(no title)"}</div>
      <div className="text-gray-500">{s.company ?? "—"} · {s.location ?? "—"}</div>
      <div className="flex gap-2 text-gray-400">
        <span className="bg-gray-100 rounded px-1 py-0.5 capitalize">{s.stage}</span>
        <span className="bg-gray-100 rounded px-1 py-0.5">{s.reason}</span>
        {s.posted_at && <span>{new Date(s.posted_at).toLocaleDateString()}</span>}
      </div>
      {s.snippet && (
        <div className="text-gray-500 italic line-clamp-2 leading-snug">{s.snippet}</div>
      )}
      {s.url && s.url !== "#" && (
        <a href={s.url} target="_blank" rel="noopener noreferrer"
           className="text-blue-500 hover:underline truncate block">
          {s.url.slice(0, 60)}{s.url.length > 60 ? "…" : ""}
        </a>
      )}
    </div>
  );
}

// ── Per-source samples panel ──────────────────────────────────────────────────
function SourceSamples({ src }: { src: SourceDiagnostics }) {
  const [open, setOpen] = useState(false);
  const samples = src.rejected_samples ?? [];
  if (samples.length === 0) return <span className="text-gray-400 text-xs">none</span>;
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="text-xs text-blue-600 hover:underline">
        {open ? "▾ hide" : `▸ show ${samples.length}`}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {samples.map((s, i) => <SampleCard key={i} s={s} />)}
        </div>
      )}
    </div>
  );
}

// ── Funnel row (adapter stage) ────────────────────────────────────────────────
function AdapterFunnelRow({ src }: { src: SourceDiagnostics }) {
  const hasAdapterDrops =
    src.dropped_by_date > 0 || src.dropped_by_location > 0 ||
    src.dropped_by_title > 0 || src.dropped_by_sponsorship > 0 ||
    src.dropped_by_duplicate > 0 || src.dropped_by_mapping > 0 ||
    src.dropped_by_http_error > 0;

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{src.source}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">{src.fetched}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">{src.mapped}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.dropped_by_date} warn={src.dropped_by_date > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.dropped_by_location} warn={src.dropped_by_location > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.dropped_by_title} warn={src.dropped_by_title > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.dropped_by_sponsorship} warn={src.dropped_by_sponsorship > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.dropped_by_duplicate} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.dropped_by_mapping} warn={src.dropped_by_mapping > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.dropped_by_http_error} danger={src.dropped_by_http_error > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-green-700">
        {src.adapter_kept}
        <span className="text-gray-400 font-normal ml-1">({pct(src.adapter_kept, src.fetched)})</span>
      </td>
    </tr>
  );
}

// ── Pipeline funnel row ───────────────────────────────────────────────────────
function PipelineFunnelRow({ src }: { src: SourceDiagnostics }) {
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{src.source}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">{src.adapter_kept}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.pipeline_title_drop} warn={src.pipeline_title_drop > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.pipeline_location_drop} warn={src.pipeline_location_drop > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.pipeline_fulltime_drop} warn={src.pipeline_fulltime_drop > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.pipeline_clearance_drop} warn={src.pipeline_clearance_drop > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.pipeline_date_drop} warn={src.pipeline_date_drop > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.pipeline_sponsorship_drop} warn={src.pipeline_sponsorship_drop > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.pipeline_duplicate_drop} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-green-700">
        {src.final_stored}
        <span className="text-gray-400 font-normal ml-1">({pct(src.final_stored, src.adapter_kept)})</span>
      </td>
    </tr>
  );
}

// ── Drift warnings ────────────────────────────────────────────────────────────
function DriftWarnings({ diag }: { diag: LatestRefreshDiagnostics }) {
  const allWarnings: { source: string; msg: string; isError: boolean }[] = [];

  for (const src of diag.sources) {
    for (const w of src.warnings ?? []) {
      const isError = w.toLowerCase().includes("http") || w.toLowerCase().includes("error");
      allWarnings.push({ source: src.source, msg: w, isError });
    }
    for (const e of src.http_errors ?? []) {
      const status = e.status ?? 0;
      if (status >= 400) {
        allWarnings.push({
          source: src.source,
          msg: `HTTP ${status}${e.tenant ? ` (${e.tenant})` : ""}: ${e.message ?? "no message"}`,
          isError: true,
        });
      }
    }
  }

  for (const w of diag.global_warnings ?? []) {
    allWarnings.push({ source: "global", msg: w, isError: true });
  }

  if (allWarnings.length === 0) {
    return (
      <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded p-3 text-sm">
        <span>✓</span>
        <span>No drift warnings — all sources look healthy.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {allWarnings.map((w, i) => (
        <div key={i}
          className={`flex gap-3 rounded p-2.5 text-sm border ${
            w.isError
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-amber-50 border-amber-200 text-amber-700"
          }`}>
          <span className="font-mono text-xs pt-0.5 shrink-0 opacity-60">{w.source}</span>
          <span>{w.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DiagnosticsPage() {
  const [diag, setDiag] = useState<LatestRefreshDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchDiag = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/jobs/diagnostics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.sources?.length === 0 && data.message) {
        setDiag(null);
        setError(data.message);
      } else {
        setDiag(data);
      }
      setLastFetched(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDiag(); }, [fetchDiag]);

  // ── Totals ──────────────────────────────────────────────────────────────
  const totals = diag ? {
    fetched:  diag.sources.reduce((s, d) => s + d.fetched, 0),
    stored:   diag.sources.reduce((s, d) => s + d.final_stored, 0),
    sources:  diag.sources.length,
  } : null;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Validator Diagnostics</h1>
            <p className="text-sm text-gray-500 mt-1">
              Funnel observability for the job ingestion pipeline. Shows the latest refresh run only.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastFetched && (
              <span className="text-xs text-gray-400">
                Fetched at {lastFetched.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchDiag}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* ── Loading / error states ────────────────────────────────────── */}
        {loading && !diag && (
          <div className="text-center py-16 text-gray-400">Loading diagnostics…</div>
        )}

        {!loading && error && !diag && (
          <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-700 text-sm">
            {error}
            <div className="mt-2 text-xs text-amber-500">
              Trigger a refresh at <code className="bg-amber-100 px-1 rounded">/api/jobs/refresh</code> first to populate data.
            </div>
          </div>
        )}

        {diag && (
          <>
            {/* ── Section A: Global summary ─────────────────────────────── */}
            <section>
              <h2 className="text-base font-semibold text-gray-700 mb-3">Global Summary</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Sources", value: totals?.sources ?? 0 },
                  { label: "Total Fetched", value: totals?.fetched.toLocaleString() ?? 0 },
                  { label: "Total Stored", value: totals?.stored.toLocaleString() ?? 0 },
                  { label: "Store Rate", value: totals ? pct(totals.stored, totals.fetched) : "—" },
                ].map(card => (
                  <div key={card.label} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">{card.label}</div>
                    <div className="text-2xl font-bold text-gray-800 mt-1">{card.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                <span>Started: <strong>{fmtTime(diag.refresh_started_at)}</strong></span>
                <span>Finished: <strong>{fmtTime(diag.refresh_finished_at)}</strong></span>
                <span>Duration: <strong>{fmtDuration(diag.refresh_started_at, diag.refresh_finished_at)}</strong></span>
              </div>
            </section>

            {/* ── Section E: Drift warnings (shown high up when present) ── */}
            <section>
              <h2 className="text-base font-semibold text-gray-700 mb-3">Drift Warnings</h2>
              <DriftWarnings diag={diag} />
            </section>

            {/* ── Section B: Adapter funnel ─────────────────────────────── */}
            <section>
              <h2 className="text-base font-semibold text-gray-700 mb-1">Adapter Stage</h2>
              <p className="text-xs text-gray-400 mb-3">
                What the adapter dropped before handing jobs to the pipeline.
                Amber = expected signal. Red = HTTP / mapping errors to investigate.
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium">Fetched</th>
                      <th className="px-3 py-2 text-right font-medium">Mapped</th>
                      <th className="px-3 py-2 text-right font-medium">−Date</th>
                      <th className="px-3 py-2 text-right font-medium">−Loc</th>
                      <th className="px-3 py-2 text-right font-medium">−Title</th>
                      <th className="px-3 py-2 text-right font-medium">−Sponsor</th>
                      <th className="px-3 py-2 text-right font-medium">−Dup</th>
                      <th className="px-3 py-2 text-right font-medium">−Map</th>
                      <th className="px-3 py-2 text-right font-medium">−HTTP</th>
                      <th className="px-3 py-2 text-right font-medium">Kept</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {diag.sources.map(src => <AdapterFunnelRow key={src.source} src={src} />)}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                      <td className="px-3 py-2 text-xs text-gray-700">Total</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.fetched, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.mapped, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.dropped_by_date, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.dropped_by_location, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.dropped_by_title, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.dropped_by_sponsorship, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.dropped_by_duplicate, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.dropped_by_mapping, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.dropped_by_http_error, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-bold text-green-700">
                        {diag.sources.reduce((s,d) => s+d.adapter_kept, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* ── Section C: Pipeline safety-net ───────────────────────── */}
            <section>
              <h2 className="text-base font-semibold text-gray-700 mb-1">Pipeline Stage</h2>
              <p className="text-xs text-gray-400 mb-3">
                Safety-net filters applied after adapter. High numbers here mean the adapter
                isn't pre-filtering something it should be.
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium">In</th>
                      <th className="px-3 py-2 text-right font-medium">−Title</th>
                      <th className="px-3 py-2 text-right font-medium">−Loc</th>
                      <th className="px-3 py-2 text-right font-medium">−Type</th>
                      <th className="px-3 py-2 text-right font-medium">−Clear</th>
                      <th className="px-3 py-2 text-right font-medium">−Date</th>
                      <th className="px-3 py-2 text-right font-medium">−Sponsor</th>
                      <th className="px-3 py-2 text-right font-medium">−Dup</th>
                      <th className="px-3 py-2 text-right font-medium">Stored</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {diag.sources.map(src => <PipelineFunnelRow key={src.source} src={src} />)}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                      <td className="px-3 py-2 text-xs text-gray-700">Total</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.adapter_kept, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.pipeline_title_drop, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.pipeline_location_drop, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.pipeline_fulltime_drop, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.pipeline_clearance_drop, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.pipeline_date_drop, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.pipeline_sponsorship_drop, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{diag.sources.reduce((s,d) => s+d.pipeline_duplicate_drop, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-bold text-green-700">
                        {diag.sources.reduce((s,d) => s+d.final_stored, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* ── Section D: Rejected samples ──────────────────────────── */}
            <section>
              <h2 className="text-base font-semibold text-gray-700 mb-3">Rejected Job Samples</h2>
              <p className="text-xs text-gray-400 mb-3">
                Up to 10 samples per reason per stage. Use these to spot false positives.
              </p>
              <div className="space-y-4">
                {diag.sources
                  .filter(src => (src.rejected_samples ?? []).length > 0)
                  .map(src => (
                    <div key={src.source} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-sm font-semibold text-gray-700">{src.source}</span>
                        <span className="text-xs text-gray-400">
                          {src.rejected_samples.length} sample{src.rejected_samples.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <SourceSamples src={src} />
                    </div>
                  ))}
                {diag.sources.every(src => (src.rejected_samples ?? []).length === 0) && (
                  <div className="text-gray-400 text-sm">No rejected samples recorded for this run.</div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}

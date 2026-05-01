"use client";
import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import type {
  LatestRefreshDiagnostics,
  SourceDiagnostics,
  RejectedJobSample,
} from "@/lib/diagnostics";
import {
  ATS_PROBE_RESULTS,
  groupProbesByBucket,
  BUCKET_META,
  type FailureBucket,
  type AtsProbeResult,
} from "@/lib/atsProbeResults";

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

// Sources whose adapter doesn't emit per-job drop counts. Their adapter-stage
// drop cells render as "—" instead of "0" — a misleading zero would imply the
// adapter measured those jobs and decided to keep them.
const NO_ADAPTER_DIAG_SOURCES = new Set<string>([
  "workday", "jsearch", "adzuna", "adzuna_targeted", "jooble",
  "phenom", "google_v2", "meta", "playwright_apple", "walmart_v2",
]);

function NotCapturedCell() {
  return (
    <span
      title="Adapter does not emit per-job diagnostics for this source — count not captured"
      className="text-gray-300 font-mono"
    >
      —
    </span>
  );
}

type DropReason = RejectedJobSample["reason"];

const ADAPTER_REASONS: { reason: DropReason; label: string }[] = [
  { reason: "date",        label: "Date" },
  { reason: "location",    label: "Location" },
  { reason: "title",       label: "Title" },
  { reason: "sponsorship", label: "Sponsorship" },
  { reason: "duplicate",   label: "Duplicate" },
  { reason: "mapping",     label: "Mapping / description" },
];

const PIPELINE_REASONS: { reason: DropReason; label: string }[] = [
  { reason: "title",       label: "Title" },
  { reason: "location",    label: "Location" },
  { reason: "date",        label: "Date / horizon" },
  { reason: "sponsorship", label: "Sponsorship" },
  { reason: "fulltime",    label: "Full-time" },
  { reason: "clearance",   label: "Clearance" },
  { reason: "duplicate",   label: "Duplicate" },
];

function adapterDropCount(src: SourceDiagnostics, reason: DropReason): number {
  switch (reason) {
    case "date":        return src.dropped_by_date;
    case "location":    return src.dropped_by_location;
    case "title":       return src.dropped_by_title;
    case "sponsorship": return src.dropped_by_sponsorship;
    case "duplicate":   return src.dropped_by_duplicate;
    case "mapping":     return src.dropped_by_mapping;
    default: return 0;
  }
}

function pipelineDropCount(src: SourceDiagnostics, reason: DropReason): number {
  switch (reason) {
    case "title":       return src.pipeline_title_drop;
    case "location":    return src.pipeline_location_drop;
    case "date":        return src.pipeline_date_drop;
    case "sponsorship": return src.pipeline_sponsorship_drop;
    case "fulltime":    return src.pipeline_fulltime_drop;
    case "clearance":   return src.pipeline_clearance_drop;
    case "duplicate":   return src.pipeline_duplicate_drop;
    default: return 0;
  }
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
// Groups by stage (adapter vs pipeline), then by reason. For each (stage,
// reason) where a drop count exists, shows the captured samples — or
// "Drops counted but no samples captured" when the count is non-zero but
// no sample rows reached the diagnostics row. Sample collection is
// adapter-side, not synthesised here, so a missing-samples state is real
// signal: it means the adapter counted but didn't keep an example.
function ReasonGroup({ label, count, samples }: {
  label: string;
  count: number;
  samples: RejectedJobSample[];
}) {
  return (
    <div className="ml-4 mb-3">
      <div className="text-xs">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-400 ml-2">
          {count} drop{count !== 1 ? "s" : ""}
          {samples.length > 0 && ` · ${samples.length} sample${samples.length !== 1 ? "s" : ""} captured`}
        </span>
      </div>
      {samples.length === 0 ? (
        <div className="text-xs text-gray-400 italic mt-0.5">Drops counted but no samples captured</div>
      ) : (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {samples.map((s, i) => <SampleCard key={i} s={s} />)}
        </div>
      )}
    </div>
  );
}

function SourceSamples({ src }: { src: SourceDiagnostics }) {
  const [open, setOpen] = useState(false);
  const samples = src.rejected_samples ?? [];
  const noTelemetry = NO_ADAPTER_DIAG_SOURCES.has(src.source);

  // Bucket samples by stage:reason for display.
  const samplesByKey = new Map<string, RejectedJobSample[]>();
  for (const s of samples) {
    const k = `${s.stage}:${s.reason}`;
    const arr = samplesByKey.get(k) ?? [];
    arr.push(s);
    samplesByKey.set(k, arr);
  }

  const adapterGroups = ADAPTER_REASONS
    .map(r => ({
      ...r,
      count: adapterDropCount(src, r.reason),
      samples: samplesByKey.get(`adapter:${r.reason}`) ?? [],
    }))
    .filter(g => g.count > 0 || g.samples.length > 0);

  const pipelineGroups = PIPELINE_REASONS
    .map(r => ({
      ...r,
      count: pipelineDropCount(src, r.reason),
      samples: samplesByKey.get(`pipeline:${r.reason}`) ?? [],
    }))
    .filter(g => g.count > 0 || g.samples.length > 0);

  // Source has nothing to show at all — let the parent skip rendering.
  if (
    samples.length === 0 &&
    adapterGroups.length === 0 &&
    pipelineGroups.length === 0 &&
    !noTelemetry
  ) {
    return null;
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="font-mono text-sm font-semibold text-gray-700">
          {src.source}
          {noTelemetry && (
            <span
              className="ml-2 inline-block text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 font-sans tracking-wide"
              title="Adapter does not emit per-job diagnostics for this source"
            >
              no telemetry
            </span>
          )}
        </span>
        <span className="text-xs text-gray-400">
          {samples.length} sample{samples.length !== 1 ? "s" : ""} · {open ? "▾ hide" : "▸ show"}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-2">
              Adapter drops
            </div>
            {noTelemetry ? (
              <div className="ml-4 text-xs italic text-gray-400">
                Adapter telemetry not captured for this source — no per-reason breakdown available.
              </div>
            ) : adapterGroups.length === 0 ? (
              <div className="ml-4 text-xs text-gray-400">No adapter drops in this run.</div>
            ) : (
              adapterGroups.map(g => (
                <ReasonGroup key={g.reason} label={g.label} count={g.count} samples={g.samples} />
              ))
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-purple-700 mb-2">
              Pipeline drops
            </div>
            {pipelineGroups.length === 0 ? (
              <div className="ml-4 text-xs text-gray-400">No pipeline drops in this run.</div>
            ) : (
              pipelineGroups.map(g => (
                <ReasonGroup key={g.reason} label={g.label} count={g.count} samples={g.samples} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Funnel row (adapter stage) ────────────────────────────────────────────────
// Sources in NO_ADAPTER_DIAG_SOURCES don't emit per-job drop counts; their
// adapter-only columns render "—" so a reader can't mistake "untelemetered"
// for "the adapter measured zero drops." Sponsorship and HTTP errors are
// route-computed (sponsorship from normalizeJobs, HTTP from fetch errors)
// so those remain real numbers for every source.
function AdapterFunnelRow({ src }: { src: SourceDiagnostics }) {
  const noTelemetry = NO_ADAPTER_DIAG_SOURCES.has(src.source);
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
        {src.source}
        {noTelemetry && (
          <span
            className="ml-1.5 inline-block text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 font-sans tracking-wide"
            title="Adapter does not emit per-job diagnostics — adapter-stage drop counts not captured"
          >
            no telemetry
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">{src.fetched}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">{src.mapped}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {noTelemetry ? <NotCapturedCell /> : <Badge n={src.dropped_by_date} warn={src.dropped_by_date > 0} />}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {noTelemetry ? <NotCapturedCell /> : <Badge n={src.dropped_by_location} warn={src.dropped_by_location > 0} />}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {noTelemetry ? <NotCapturedCell /> : <Badge n={src.dropped_by_title} warn={src.dropped_by_title > 0} />}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        <Badge n={src.dropped_by_sponsorship} warn={src.dropped_by_sponsorship > 0} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {noTelemetry ? <NotCapturedCell /> : <Badge n={src.dropped_by_duplicate} />}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {noTelemetry ? <NotCapturedCell /> : <Badge n={src.dropped_by_mapping} warn={src.dropped_by_mapping > 0} />}
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

// ── ATS Probe Log ─────────────────────────────────────────────────────────────
const BUCKET_STYLES: Record<FailureBucket, { bg: string; text: string; border: string }> = {
  viable:             { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  cloudflare_blocked: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  location_unusable:  { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  date_unparseable:   { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  not_on_ats:         { bg: "bg-gray-50",   text: "text-gray-500",   border: "border-gray-200" },
  endpoint_unknown:   { bg: "bg-gray-50",   text: "text-gray-400",   border: "border-gray-200" },
};

function BucketPill({ bucket }: { bucket: FailureBucket }) {
  const s = BUCKET_STYLES[bucket];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${s.bg} ${s.text} ${s.border} whitespace-nowrap`}>
      {BUCKET_META[bucket].label}
    </span>
  );
}

function ProbeRow({ r }: { r: AtsProbeResult }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <td className="px-3 py-2 text-xs font-medium text-gray-800 whitespace-nowrap">{r.company}</td>
        <td className="px-3 py-2 text-xs text-gray-500 uppercase tracking-wide">{r.ats}</td>
        <td className="px-3 py-2 font-mono text-[10px] text-gray-400 max-w-[180px] truncate">{r.endpoint.split("/wday/")[0]}</td>
        <td className="px-3 py-2 text-center">
          <span className={`font-mono text-xs font-semibold ${r.http_status === 200 ? "text-green-600" : "text-red-500"}`}>
            {r.http_status}
          </span>
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs">{r.fetched || "—"}</td>
        <td className="px-3 py-2 text-right font-mono text-xs text-amber-600">{r.dropped_by_date || "—"}</td>
        <td className="px-3 py-2 text-right font-mono text-xs text-amber-600">{r.dropped_by_location || "—"}</td>
        <td className="px-3 py-2 text-right font-mono text-xs text-amber-600">{r.dropped_by_title || "—"}</td>
        <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-green-700">{r.adapter_kept || "—"}</td>
        <td className="px-3 py-2"><BucketPill bucket={r.failure_bucket} /></td>
        <td className="px-3 py-2 text-gray-400 text-xs">{open ? "▾" : "▸"}</td>
      </tr>
      {open && (
        <tr className="bg-gray-50 border-t border-gray-100">
          <td colSpan={11} className="px-4 py-3">
            <div className="space-y-1 text-xs">
              <div><span className="font-medium text-gray-600">Endpoint:</span> <code className="bg-gray-100 px-1 rounded">{r.endpoint}</code></div>
              <div><span className="font-medium text-gray-600">Reason:</span> <span className="text-gray-700">{r.reason}</span></div>
              <div><span className="font-medium text-gray-600">Next action:</span> <span className="text-blue-700">{r.recommended_next_action}</span></div>
              <div><span className="font-medium text-gray-600">Probed:</span> <span className="text-gray-400">{r.probed_at}</span></div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AtsProbelog() {
  const grouped = groupProbesByBucket(ATS_PROBE_RESULTS);
  const bucketOrder: FailureBucket[] = [
    "viable", "cloudflare_blocked", "location_unusable", "date_unparseable", "not_on_ats", "endpoint_unknown",
  ];

  return (
    <section>
      <h2 className="text-base font-semibold text-gray-700 mb-1">ATS Expansion Probe Log</h2>
      <p className="text-xs text-gray-400 mb-3">
        Classification of every candidate source probed. Static — updated after each expansion batch.
        No sources here are active unless explicitly added to the registry.
      </p>

      {/* Bucket summary pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        {bucketOrder.map(bucket => {
          const count = grouped[bucket].length;
          if (count === 0) return null;
          const s = BUCKET_STYLES[bucket];
          return (
            <div key={bucket} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${s.bg} ${s.text} ${s.border}`}>
              <span className="font-semibold">{count}</span>
              <span>{BUCKET_META[bucket].label}</span>
            </div>
          );
        })}
      </div>

      {/* Full probe table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500 uppercase tracking-wide text-[10px]">
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">ATS</th>
              <th className="px-3 py-2 font-medium">Endpoint</th>
              <th className="px-3 py-2 text-center font-medium">HTTP</th>
              <th className="px-3 py-2 text-right font-medium">Fetched</th>
              <th className="px-3 py-2 text-right font-medium">−Date</th>
              <th className="px-3 py-2 text-right font-medium">−Loc</th>
              <th className="px-3 py-2 text-right font-medium">−Title</th>
              <th className="px-3 py-2 text-right font-medium">Kept</th>
              <th className="px-3 py-2 font-medium">Bucket</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y-0">
            {bucketOrder.map(bucket =>
              grouped[bucket].map(r => <ProbeRow key={`${r.company}-${r.ats}`} r={r} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
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
              <div className="border-l-4 border-blue-500 bg-blue-50 px-3 py-2 mb-3 rounded">
                <div className="text-[10px] uppercase tracking-widest text-blue-600 font-semibold">
                  Stage 1 of 2 · Adapter
                </div>
                <h2 className="text-base font-semibold text-blue-900">
                  What the source returned, before pipeline filters
                </h2>
                <p className="text-xs text-blue-800/70 mt-0.5">
                  Drop columns count individual jobs the adapter rejected. Amber = expected signal.
                  The HTTP errors column counts upstream/request failures, not job drops.
                  Sources marked <em>no telemetry</em> don&rsquo;t emit per-job adapter counts —
                  drop cells render as &mdash; rather than 0.
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium" title="Raw row count returned by the adapter's upstream API">Fetched</th>
                      <th className="px-3 py-2 text-right font-medium" title="Rows that survived adapter mapping/normalization">Mapped</th>
                      <th className="px-3 py-2 text-right font-medium" title="Individual jobs dropped because of date / horizon">−Date</th>
                      <th className="px-3 py-2 text-right font-medium" title="Individual jobs dropped because of non-US or unparseable location">−Loc</th>
                      <th className="px-3 py-2 text-right font-medium" title="Individual jobs dropped because the title didn't match SWE-IC criteria">−Title</th>
                      <th className="px-3 py-2 text-right font-medium" title="Individual jobs dropped because sponsorship was classified as not-supported">−Sponsor</th>
                      <th className="px-3 py-2 text-right font-medium" title="Individual jobs dropped as duplicates within this run">−Dup</th>
                      <th className="px-3 py-2 text-right font-medium" title="Individual jobs dropped due to mapping or description issues">−Map</th>
                      <th className="px-3 py-2 text-right font-medium text-red-500" title="Upstream HTTP / request failures contacting the source — NOT individual job drops">HTTP errors</th>
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
              <div className="border-l-4 border-purple-500 bg-purple-50 px-3 py-2 mb-3 rounded">
                <div className="text-[10px] uppercase tracking-widest text-purple-600 font-semibold">
                  Stage 2 of 2 · Pipeline
                </div>
                <h2 className="text-base font-semibold text-purple-900">
                  Safety-net filters applied after the adapter
                </h2>
                <p className="text-xs text-purple-800/70 mt-0.5">
                  Drop columns count individual jobs the pipeline rejected.
                  High numbers here mean the adapter isn&rsquo;t pre-filtering something it should be.
                </p>
              </div>
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

            {/* ── Section F: ATS Probe Log ─────────────────────────────── */}
            <AtsProbelog />

            {/* ── Section D: Rejected samples ──────────────────────────── */}
            <section>
              <h2 className="text-base font-semibold text-gray-700 mb-3">Rejected Job Samples</h2>
              <p className="text-xs text-gray-400 mb-3">
                Grouped by stage (adapter vs pipeline), then by reason.
                Up to 10 samples per reason per stage. Use these to spot false positives.
                A reason that shows &ldquo;Drops counted but no samples captured&rdquo; means the
                adapter counted the drop but didn&rsquo;t retain an example row.
              </p>
              <div className="space-y-4">
                {diag.sources.map(src => <SourceSamples key={src.source} src={src} />)}
                {diag.sources.every(src =>
                  (src.rejected_samples?.length ?? 0) === 0 &&
                  ADAPTER_REASONS.every(r => adapterDropCount(src, r.reason) === 0) &&
                  PIPELINE_REASONS.every(r => pipelineDropCount(src, r.reason) === 0) &&
                  !NO_ADAPTER_DIAG_SOURCES.has(src.source)
                ) && (
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

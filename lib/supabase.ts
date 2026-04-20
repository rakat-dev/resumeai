import { createClient } from "@supabase/supabase-js";

// ── Supabase client ───────────────────────────────────────────────────────
// anon client  — safe for read queries from API routes
// service client — used for writes (refresh/ingestion only, server-side)

// Fallback URLs prevent createClient from throwing during Next.js build-time
// module evaluation (e.g. Vercel preview deployments without env vars set).
// Actual requests will fail at runtime if env vars are genuinely missing.
const url    = process.env.SUPABASE_URL    || "https://placeholder.supabase.co";
const anon   = process.env.SUPABASE_ANON_KEY || "placeholder-anon-key";
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anon;

// Read client (used in /api/jobs GET)
export const supabase = createClient(url, anon, {
  auth: { persistSession: false },
});

// Write client (used in /api/jobs/refresh POST — server-side only)
export const supabaseAdmin = createClient(url, svcKey, {
  auth: { persistSession: false },
});

// ── DB row type (matches jobs table schema) ───────────────────────────────
export interface JobRow {
  id:                  string;
  source:              string;
  company:             string;
  title:               string;
  location:            string;
  country:             string;
  employment_type:     string | null;
  posted_at:           string | null;   // ISO timestamp
  description:         string | null;
  apply_url:           string;
  title_family:        string | null;
  sponsorship_status:  string;
  sponsorship_signals: unknown | null;
  fetched_at:          string;
  is_active:           boolean;
  position_rank:       number | null;   // 1..120 for no-date Tier A scrapers (Google etc.); NULL otherwise
  full_description:    string | null;   // full cleaned JD body (no truncation); NULL for sources without JD
}

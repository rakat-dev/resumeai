import { createClient } from "@supabase/supabase-js";

// ── Supabase client ───────────────────────────────────────────────────────
// anon client  — safe for read queries from API routes
// service client — used for writes (refresh/ingestion only, server-side)

const url    = process.env.SUPABASE_URL ?? "";
const anon   = process.env.SUPABASE_ANON_KEY ?? "";
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? anon;

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
}

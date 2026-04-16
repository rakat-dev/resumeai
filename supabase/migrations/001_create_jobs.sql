-- Migration: create jobs table
-- Run this in Supabase SQL Editor before first use

CREATE TABLE IF NOT EXISTS jobs (
  id                  TEXT PRIMARY KEY,
  source              TEXT NOT NULL,
  company             TEXT NOT NULL,
  title               TEXT NOT NULL,
  location            TEXT NOT NULL DEFAULT '',
  country             TEXT NOT NULL DEFAULT 'US',
  employment_type     TEXT,
  posted_at           TIMESTAMPTZ,
  description         TEXT,
  apply_url           TEXT NOT NULL,
  title_family        TEXT,
  sponsorship_status  TEXT NOT NULL DEFAULT 'not_mentioned',
  sponsorship_signals JSONB,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_jobs_posted_at  ON jobs (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_company    ON jobs (company);
CREATE INDEX IF NOT EXISTS idx_jobs_source     ON jobs (source);
CREATE INDEX IF NOT EXISTS idx_jobs_is_active  ON jobs (is_active);
CREATE INDEX IF NOT EXISTS idx_jobs_fetched_at ON jobs (fetched_at DESC);

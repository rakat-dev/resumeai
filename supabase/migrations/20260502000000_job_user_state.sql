-- Migration: job_user_state
-- Tracks per-user actions on jobs: viewed, tailored, dismissed.
--
-- job_id is globally unique across all sources because every scraper
-- prefixes its IDs with the source name (e.g. "gh-stripe-12345",
-- "amazon_v2-67890", "meta-11111"). No composite key is needed.
--
-- dismissed jobs are NOT filtered at the DB query level.
-- The API joins this table into the response and the route handler
-- filters dismissed jobs after the merge (CP3).

CREATE TABLE IF NOT EXISTS job_user_state (
  job_id        TEXT        NOT NULL,
  viewed_at     TIMESTAMPTZ NULL,
  tailored_at   TIMESTAMPTZ NULL,
  dismissed_at  TIMESTAMPTZ NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT job_user_state_pkey PRIMARY KEY (job_id)
);

-- Index for fast lookup of dismissed jobs during post-merge filter
CREATE INDEX IF NOT EXISTS idx_job_user_state_dismissed
  ON job_user_state (dismissed_at)
  WHERE dismissed_at IS NOT NULL;

-- Auto-update updated_at on any row modification
CREATE OR REPLACE FUNCTION set_job_user_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_user_state_updated_at ON job_user_state;
CREATE TRIGGER trg_job_user_state_updated_at
  BEFORE UPDATE ON job_user_state
  FOR EACH ROW EXECUTE FUNCTION set_job_user_state_updated_at();

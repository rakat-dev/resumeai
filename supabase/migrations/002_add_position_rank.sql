-- Migration 002: position_rank for no-date Tier A scrapers
--
-- Some Tier A career sites (Google careers, etc.) don't expose a posted-date
-- field. For these companies we paginate by sort=date and assign each job a
-- 1..120 "position rank" reflecting its order in the result list. The rank
-- becomes a synthetic recency signal used by the board's UI sorting and time
-- filters when posted_at is NULL.
--
-- Set by runFullWorkflowNoDate() in lib/playwrightScrapers.ts.
-- NULL for jobs sourced from APIs that DO expose a real posted date.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS position_rank INTEGER NULL;

-- Composite index: time-filtered queries on no-date jobs sort by rank
-- ascending (rank 1 is freshest). The partial-index variant only includes
-- rows where the column is non-null — keeps the index tiny.
CREATE INDEX IF NOT EXISTS idx_jobs_position_rank
  ON jobs (position_rank)
  WHERE position_rank IS NOT NULL;

-- Evidence date precision: day | month | year.
-- Sort key remains issue_date (first of the known period). Display must honour precision
-- and must never substitute created_at / retrieved_at / discovered_at.

ALTER TABLE evidence ADD COLUMN IF NOT EXISTS issue_date_precision text;

DO $upgrade$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = 'evidence'
      AND n.nspname = current_schema()
      AND c.conname = 'evidence_issue_date_precision_check'
  ) THEN
    ALTER TABLE evidence
      ADD CONSTRAINT evidence_issue_date_precision_check
      CHECK (issue_date_precision IS NULL OR issue_date_precision IN ('day', 'month', 'year'));
  END IF;
END
$upgrade$;

UPDATE evidence
   SET issue_date_precision = 'day'
 WHERE issue_date IS NOT NULL
   AND issue_date_precision IS NULL
   AND evidence_type IN ('bee_certificate', 'sworn_affidavit');

CREATE TABLE IF NOT EXISTS enrichment_runs (
  id text PRIMARY KEY,
  job_id text REFERENCES crawler_jobs (id),
  entity_id text REFERENCES entities (id),
  batch_size integer NOT NULL DEFAULT 25,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  attempted integer NOT NULL DEFAULT 0,
  enriched integer NOT NULL DEFAULT 0,
  certificates_found integer NOT NULL DEFAULT 0,
  registrations_found integer NOT NULL DEFAULT 0,
  domains_found integer NOT NULL DEFAULT 0,
  sectors_added integer NOT NULL DEFAULT 0,
  sources_added integer NOT NULL DEFAULT 0,
  reviews_created integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  current_company text,
  current_entity_id text,
  stop_requested integer NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
  error text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS enrichment_runs_created_idx ON enrichment_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS enrichment_runs_status_idx ON enrichment_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS enrichment_runs_job_idx ON enrichment_runs (job_id);

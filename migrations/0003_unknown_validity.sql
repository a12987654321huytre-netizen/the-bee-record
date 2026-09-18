-- Widen evidence.lifecycle_state so missing expiry is Validity unconfirmed,
-- not Current. 0002 already applied on production without this value, so the
-- existing column CHECK must be dropped and recreated. Looks up the constraint
-- by definition because PostgreSQL auto-names inline CHECKs.

DO $upgrade$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = 'evidence'
      AND n.nspname = current_schema()
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%lifecycle_state%'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%unknown_validity%'
  LOOP
    EXECUTE format('ALTER TABLE evidence DROP CONSTRAINT %I', r.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = 'evidence'
      AND n.nspname = current_schema()
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%unknown_validity%'
  ) THEN
    ALTER TABLE evidence
      ADD CONSTRAINT evidence_lifecycle_state_check
      CHECK (lifecycle_state IN (
        'discovered', 'current', 'historical', 'superseded', 'expired',
        'expiring_soon', 'disputed', 'unknown_validity'
      ));
  END IF;
END
$upgrade$;

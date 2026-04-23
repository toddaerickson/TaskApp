-- Migration: drop phases feature
-- Applied after 001_schema.sql; idempotent.
DROP TABLE IF EXISTS routine_phases;
-- SQLite does not support DROP COLUMN; handled by SQLITE_SCHEMA rebuild.
-- PostgreSQL:
DO $$ BEGIN
  ALTER TABLE routines DROP COLUMN IF EXISTS phase_start_date;
  ALTER TABLE routine_exercises DROP COLUMN IF EXISTS phase_id;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

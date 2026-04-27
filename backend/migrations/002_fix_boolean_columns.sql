-- Fix column types on databases where the original `_ensure_columns`
-- shim added tracks_symptoms / is_warmup as INTEGER instead of BOOLEAN.
-- PG can cast 0/1 → bool safely. SQLite ignores column types so this
-- is a no-op there (and SQLite isn't running this file anyway — the
-- migrator is PG-only; SQLite uses the inline init_db path).
--
-- Wrapped in DO blocks so each conversion guards itself: the ALTER
-- only fires if the column is still integer-typed. Re-running this
-- file (which the migrator won't do, since it's stamped, but
-- defense-in-depth for manual replay) is a no-op on a converted DB.
--
-- Earlier draft of the same logic lived inline in init_db and ran on
-- every cold boot. Now it ships exactly once through the migration
-- runner and gets stamped in schema_migrations.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'routines' AND column_name = 'tracks_symptoms'
          AND data_type = 'integer'
    ) THEN
        ALTER TABLE routines ALTER COLUMN tracks_symptoms DROP DEFAULT;
        ALTER TABLE routines ALTER COLUMN tracks_symptoms
            TYPE BOOLEAN USING tracks_symptoms::boolean;
        ALTER TABLE routines ALTER COLUMN tracks_symptoms SET DEFAULT FALSE;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'workout_sessions' AND column_name = 'tracks_symptoms'
          AND data_type = 'integer'
    ) THEN
        ALTER TABLE workout_sessions ALTER COLUMN tracks_symptoms DROP DEFAULT;
        ALTER TABLE workout_sessions ALTER COLUMN tracks_symptoms
            TYPE BOOLEAN USING tracks_symptoms::boolean;
        ALTER TABLE workout_sessions ALTER COLUMN tracks_symptoms SET DEFAULT FALSE;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'session_sets' AND column_name = 'is_warmup'
          AND data_type = 'integer'
    ) THEN
        ALTER TABLE session_sets ALTER COLUMN is_warmup DROP DEFAULT;
        ALTER TABLE session_sets ALTER COLUMN is_warmup
            TYPE BOOLEAN USING is_warmup::boolean;
        ALTER TABLE session_sets ALTER COLUMN is_warmup SET DEFAULT FALSE;
    END IF;
END $$;

-- Corrective safety migration. PR #107 retroactively edited 001_schema.sql
-- to add `exercises.evidence_tier` and `routines.target_minutes`. Any DB
-- whose `schema_migrations` row for `001_schema.sql` was stamped *before*
-- those edits landed silently skipped the new ALTERs — which means
-- `/missed-reminders` (PR #112, SELECT target_minutes) and the tier chip
-- (PR #107, SELECT evidence_tier) would throw `column does not exist`
-- on those installs.
--
-- The fix is two ALTER TABLE ADD COLUMN IF NOT EXISTS that no-op on any
-- DB created from the post-#107 baseline (columns already there) and
-- safely add them on a stamped-pre-#107 prod DB. PG-only; the SQLite
-- mirror in app/database.py SQLITE_SCHEMA + _ensure_columns covers dev.
--
-- Rule for next time: schema changes go in a NEW numbered migration
-- file, not by editing 001_schema.sql. The architect agent's audit
-- flagged this as a SEVERE prod risk.

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS evidence_tier TEXT;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS target_minutes INTEGER;

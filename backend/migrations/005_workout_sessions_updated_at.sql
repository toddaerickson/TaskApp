-- PR-Y3: add updated_at to workout_sessions so update_session can do
-- optimistic-concurrency checks like update_routine + update_task.
-- Backfilled with started_at for existing rows (sensible default — the
-- only mutation since creation we know about is the row's existence).
-- TIMESTAMPTZ for parity with routines/tasks.updated_at; trigger keeps
-- it fresh on subsequent UPDATEs without route-level bookkeeping.

ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE workout_sessions SET updated_at = started_at WHERE updated_at IS NULL;

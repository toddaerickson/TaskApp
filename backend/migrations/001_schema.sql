-- TaskApp Schema

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS folders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subfolders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    subfolder_id INTEGER REFERENCES subfolders(id) ON DELETE SET NULL,
    parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    note TEXT,
    priority INTEGER DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
    status TEXT DEFAULT 'none' CHECK (status IN (
        'none', 'next_action', 'active', 'waiting',
        'hold', 'postponed', 'someday', 'cancelled'
    )),
    starred BOOLEAN DEFAULT FALSE,
    start_date DATE,
    due_date DATE,
    due_time TIME,
    repeat_type TEXT DEFAULT 'none' CHECK (repeat_type IN (
        'none', 'daily', 'weekly', 'biweekly',
        'monthly', 'quarterly', 'semiannual', 'yearly'
    )),
    repeat_from TEXT DEFAULT 'due_date' CHECK (repeat_from IN ('due_date', 'completion_date')),
    sort_order INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS reminders (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    remind_at TIMESTAMPTZ NOT NULL,
    reminded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Workout module
-- ============================================================

-- Exercises: a library. user_id NULL = global/seeded; otherwise user-owned.
CREATE TABLE IF NOT EXISTS exercises (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT,
    category TEXT DEFAULT 'strength' CHECK (category IN (
        'strength', 'mobility', 'stretch', 'cardio', 'balance', 'rehab'
    )),
    primary_muscle TEXT,
    equipment TEXT,
    difficulty INTEGER DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
    is_bodyweight BOOLEAN DEFAULT FALSE,
    measurement TEXT DEFAULT 'reps' CHECK (measurement IN (
        'reps', 'duration', 'distance', 'reps_weight'
    )),
    instructions TEXT,
    cue TEXT,
    contraindications TEXT,
    min_age INTEGER,
    max_age INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Soft-delete marker. NULL = active. The row stays in the table
    -- when archived so routines and sessions still resolve names /
    -- images; list endpoints filter `WHERE archived_at IS NULL` by
    -- default.
    archived_at TIMESTAMPTZ,
    -- Evidence-quality tier surfaced as a UI chip. NULL = unclassified.
    -- Allowed values RCT / MECHANISM / PRACTITIONER / THEORETICAL,
    -- enforced client-side via Pydantic Literal on create. No CHECK
    -- constraint in SQL because we want NULL to remain valid for
    -- existing rows without a default.
    evidence_tier TEXT
);
-- Idempotent ALTER for DBs created before soft-delete shipped. Mirrors
-- _ensure_columns behavior on the SQLite side.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS evidence_tier TEXT;

CREATE TABLE IF NOT EXISTS exercise_images (
    id SERIAL PRIMARY KEY,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    caption TEXT,
    sort_order INTEGER DEFAULT 0,
    content_hash TEXT,
    -- Screen-reader description. Nullable; the API substitutes a
    -- per-exercise default when this is NULL.
    alt_text TEXT
);
ALTER TABLE exercise_images ADD COLUMN IF NOT EXISTS alt_text TEXT;

-- Routines: a saved workout template (e.g. "Ankle Mobility AM")
CREATE TABLE IF NOT EXISTS routines (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT DEFAULT 'general' CHECK (goal IN (
        'strength', 'mobility', 'cardio', 'rehab', 'general'
    )),
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    reminder_time TEXT,          -- "HH:MM" local time; NULL = off
    reminder_days TEXT,          -- CSV of "mon,tue,..." or "daily"; NULL = daily when time set
    -- When true, sessions started from this routine inherit the flag (see
    -- workout_sessions.tracks_symptoms) and get pain-monitored progression
    -- (Silbernagel-style advance/hold/back-off) plus the per-exercise pain
    -- chip + symptom logger. Default FALSE keeps strength routines
    -- untouched; the field is added via ALTER on existing databases so
    -- pre-existing routines stay opted-out.
    tracks_symptoms BOOLEAN NOT NULL DEFAULT FALSE,
    -- Operator-set wall-clock estimate in minutes (Pydantic enforces
    -- 1-180). NULL = unspecified; mobile hides the duration pill on the
    -- routine card when null. Orthogonal to `goal` — a 5-min snack can
    -- still be a strength routine.
    target_minutes INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE routines ADD COLUMN IF NOT EXISTS target_minutes INTEGER;

CREATE TABLE IF NOT EXISTS routine_exercises (
    id SERIAL PRIMARY KEY,
    routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    sort_order INTEGER DEFAULT 0,
    target_sets INTEGER DEFAULT 1,
    target_reps INTEGER,
    target_weight REAL,
    target_duration_sec INTEGER,
    rest_sec INTEGER DEFAULT 60,
    tempo TEXT,
    keystone BOOLEAN DEFAULT FALSE,
    notes TEXT,
    -- Target RPE per working set (1-10). NULL = no target. Pydantic
    -- layer enforces the range.
    target_rpe INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions: a logged workout
CREATE TABLE IF NOT EXISTS workout_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    routine_id INTEGER REFERENCES routines(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    rpe INTEGER CHECK (rpe BETWEEN 1 AND 10),
    mood INTEGER CHECK (mood BETWEEN 1 AND 5),
    notes TEXT,
    -- Snapshot of the routine's tracks_symptoms at POST /sessions time.
    -- Flipping the routine flag afterwards doesn't mutate the in-progress
    -- session (avoids "values changed under me" surprises mid-workout).
    -- Ad-hoc sessions (routine_id NULL) get FALSE.
    tracks_symptoms BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_sets (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight REAL,
    duration_sec INTEGER,
    distance_m REAL,
    rpe INTEGER CHECK (rpe BETWEEN 1 AND 10),
    -- Per-set pain score (0 none, 10 worst). Only written when the parent
    -- session has tracks_symptoms=TRUE; strength sessions leave NULL and
    -- the progression dispatcher falls through to the RPE path.
    pain_score INTEGER CHECK (pain_score BETWEEN 0 AND 10),
    -- Per-set laterality: 'left' | 'right' | NULL (bilateral). Stored as
    -- TEXT rather than an ENUM so SQLite + PG share the same path.
    side TEXT,
    -- Warmup sets: excluded from volume + progression suggestion. Default
    -- FALSE so pre-column rows behave exactly as before.
    is_warmup BOOLEAN DEFAULT FALSE,
    completed BOOLEAN DEFAULT TRUE,
    notes TEXT
);

-- Symptom log (for rehab routines tracking pain/tightness over time)
CREATE TABLE IF NOT EXISTS symptom_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES workout_sessions(id) ON DELETE SET NULL,
    body_part TEXT NOT NULL,
    severity INTEGER NOT NULL CHECK (severity BETWEEN 0 AND 10),
    notes TEXT,
    logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin-endpoint access log. No user_id because /admin/* is gated by a
-- shared token (SNAPSHOT_AUTH_TOKEN), not a JWT. Correlate with request_id
-- for the matching log line; client_ip + user_agent identify the caller.
CREATE TABLE IF NOT EXISTS admin_audit (
    id SERIAL PRIMARY KEY,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    request_id TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    client_ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_folder_id ON tasks(folder_id);
CREATE INDEX IF NOT EXISTS idx_tasks_subfolder_id ON tasks(subfolder_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(user_id, completed);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(user_id, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON tasks(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_tasks_starred ON tasks(user_id, starred);
CREATE INDEX IF NOT EXISTS idx_tasks_sort_order ON tasks(user_id, folder_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_subfolders_folder_id ON subfolders(folder_id);
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_task_id ON reminders(task_id);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at, reminded);
CREATE INDEX IF NOT EXISTS idx_exercises_user_id ON exercises(user_id);
CREATE INDEX IF NOT EXISTS idx_exercises_category ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_exercise_images_ex_id ON exercise_images(exercise_id);
-- Dedup guard: one image per (exercise, content_hash). Partial index so
-- pre-feature NULL-hashed rows don't trip the constraint; new inserts
-- always supply a hash.
--
-- The ADD COLUMN IF NOT EXISTS below is here (not in _ensure_columns in
-- database.py) because init_db() runs the full schema file before
-- _ensure_columns. Databases created before the content_hash feature
-- shipped would fail the CREATE UNIQUE INDEX on a missing column;
-- guarding the column inline keeps the file self-contained and safe
-- to re-run on every deploy. Postgres-only; SQLite uses SQLITE_SCHEMA
-- in database.py which already includes content_hash in its CREATE.
ALTER TABLE exercise_images ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercise_images_hash
    ON exercise_images(exercise_id, content_hash)
    WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id);
CREATE INDEX IF NOT EXISTS idx_routine_ex_routine ON routine_exercises(routine_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON workout_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_sets_session ON session_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_symptom_logs_user ON symptom_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);
-- Uniqueness: slug is unique per user, with a separate partial index for globals.
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercises_global_slug ON exercises(slug) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercises_user_slug ON exercises(user_id, slug) WHERE user_id IS NOT NULL;
-- Prevent duplicate (session, exercise, set_number) — catches double-tap races.
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_sets_key ON session_sets(session_id, exercise_id, set_number);
-- FK lookup indexes (ON DELETE RESTRICT targets).
CREATE INDEX IF NOT EXISTS idx_routine_ex_exercise ON routine_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS idx_session_sets_exercise ON session_sets(exercise_id);

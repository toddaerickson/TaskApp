"""
Database layer supporting both SQLite (local dev) and PostgreSQL (production).
SQLite requires no installation — just works. Set DATABASE_URL to a postgresql:// URL to use Postgres.
"""
import os
import sqlite3
from contextlib import contextmanager
from app.config import DATABASE_URL, DB_TYPE

if DB_TYPE == "postgresql":
    import psycopg2
    import psycopg2.extras


class DictRow(dict):
    """Make SQLite rows behave like psycopg2 RealDictRow."""
    def __getitem__(self, key):
        return super().__getitem__(key)


def _dict_factory(cursor, row):
    return DictRow({col[0]: row[idx] for idx, col in enumerate(cursor.description)})


def _get_sqlite_connection():
    db_path = DATABASE_URL.replace("sqlite:///", "")
    conn = sqlite3.connect(db_path)
    conn.row_factory = _dict_factory
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _get_pg_connection():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False
    return conn


@contextmanager
def get_db():
    conn = _get_pg_connection() if DB_TYPE == "postgresql" else _get_sqlite_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# SQLite schema (hand-tuned for compatibility)
SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subfolders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    starred BOOLEAN DEFAULT 0,
    start_date TEXT,
    due_date TEXT,
    due_time TEXT,
    repeat_type TEXT DEFAULT 'none' CHECK (repeat_type IN (
        'none', 'daily', 'weekly', 'biweekly',
        'monthly', 'quarterly', 'semiannual', 'yearly'
    )),
    repeat_from TEXT DEFAULT 'due_date' CHECK (repeat_from IN ('due_date', 'completion_date')),
    sort_order INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT 0,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    remind_at TEXT NOT NULL,
    reminded BOOLEAN DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT,
    category TEXT DEFAULT 'strength' CHECK (category IN (
        'strength', 'mobility', 'stretch', 'cardio', 'balance', 'rehab'
    )),
    primary_muscle TEXT,
    equipment TEXT,
    difficulty INTEGER DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
    is_bodyweight BOOLEAN DEFAULT 0,
    measurement TEXT DEFAULT 'reps' CHECK (measurement IN (
        'reps', 'duration', 'distance', 'reps_weight'
    )),
    instructions TEXT,
    cue TEXT,
    contraindications TEXT,
    min_age INTEGER,
    max_age INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exercise_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    caption TEXT,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT DEFAULT 'general' CHECK (goal IN (
        'strength', 'mobility', 'cardio', 'rehab', 'general'
    )),
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    reminder_time TEXT,
    reminder_days TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routine_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    sort_order INTEGER DEFAULT 0,
    target_sets INTEGER DEFAULT 1,
    target_reps INTEGER,
    target_weight REAL,
    target_duration_sec INTEGER,
    rest_sec INTEGER DEFAULT 60,
    tempo TEXT,
    keystone BOOLEAN DEFAULT 0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS workout_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    routine_id INTEGER REFERENCES routines(id) ON DELETE SET NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    rpe INTEGER CHECK (rpe BETWEEN 1 AND 10),
    mood INTEGER CHECK (mood BETWEEN 1 AND 5),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight REAL,
    duration_sec INTEGER,
    distance_m REAL,
    rpe INTEGER CHECK (rpe BETWEEN 1 AND 10),
    completed BOOLEAN DEFAULT 1,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS symptom_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES workout_sessions(id) ON DELETE SET NULL,
    body_part TEXT NOT NULL,
    severity INTEGER NOT NULL CHECK (severity BETWEEN 0 AND 10),
    notes TEXT,
    logged_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exercises_user_id ON exercises(user_id);
CREATE INDEX IF NOT EXISTS idx_exercises_category ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id);
CREATE INDEX IF NOT EXISTS idx_routine_ex_routine ON routine_exercises(routine_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON workout_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_sets_session ON session_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_symptom_logs_user ON symptom_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_exercise_images_ex_id ON exercise_images(exercise_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercises_global_slug ON exercises(slug) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercises_user_slug ON exercises(user_id, slug) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_sets_key ON session_sets(session_id, exercise_id, set_number);
CREATE INDEX IF NOT EXISTS idx_routine_ex_exercise ON routine_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS idx_session_sets_exercise ON session_sets(exercise_id);
"""


def init_db():
    if DB_TYPE == "postgresql":
        schema_path = os.path.join(os.path.dirname(__file__), "..", "migrations", "001_schema.sql")
        with open(schema_path) as f:
            sql = f.read()
    else:
        sql = SQLITE_SCHEMA

    with get_db() as conn:
        cur = conn.cursor()
        if DB_TYPE == "sqlite":
            cur.executescript(sql)
        else:
            cur.execute(sql)

        # Idempotent column adds for existing databases. CREATE TABLE IF NOT
        # EXISTS won't modify a pre-existing table, so features that add new
        # columns must also apply ALTER TABLEs here (guarded against rerun).
        _ensure_columns(cur, "routines", [
            ("reminder_time", "TEXT"),
            ("reminder_days", "TEXT"),
        ])


def _ensure_columns(cur, table: str, columns: list[tuple[str, str]]) -> None:
    """Add columns to `table` if they don't already exist. Safe to run on
    every startup. Works identically on SQLite and Postgres because
    `ALTER TABLE ... ADD COLUMN` is supported on both with the same syntax
    for simple-typed columns."""
    if DB_TYPE == "sqlite":
        cur.execute(f"PRAGMA table_info({table})")
        have = {r["name"] for r in cur.fetchall()}
    else:
        cur.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
            (table,),
        )
        have = {r["column_name"] for r in cur.fetchall()}
    for name, typ in columns:
        if name not in have:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {name} {typ}")

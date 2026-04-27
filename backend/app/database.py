"""
Database layer supporting both SQLite (local dev) and PostgreSQL (production).
SQLite requires no installation — just works. Set DATABASE_URL to a postgresql:// URL to use Postgres.

Routes throughout this app are written in SQLite dialect: `?` placeholders
and reads of `cur.lastrowid` after INSERTs. On PostgreSQL we wrap the raw
psycopg2 cursor in `_CompatCursor` so the same SQL Just Works — `?` is
rewritten to `%s` at execute time, and `lastrowid` is resolved via
`SELECT lastval()` on demand.
"""
import logging
import sqlite3
import time
from contextlib import contextmanager
from app.config import DATABASE_URL, DB_TYPE

if DB_TYPE == "postgresql":
    import psycopg2
    import psycopg2.extras

log = logging.getLogger(__name__)


def is_unique_violation(exc: Exception) -> bool:
    """Portable check for a UNIQUE / duplicate-key constraint violation.
    Matches both sqlite3.IntegrityError and psycopg2.errors.UniqueViolation
    without importing psycopg2 at call sites that might run on SQLite only."""
    if isinstance(exc, sqlite3.IntegrityError):
        # SQLite lumps all constraint violations together — good enough for
        # the retry and 400-mapping cases we use this for.
        return True
    return getattr(exc, "pgcode", None) == "23505"


class DictRow(dict):
    """Make SQLite rows behave like psycopg2 RealDictRow."""
    def __getitem__(self, key):
        return super().__getitem__(key)


def _dict_factory(cursor, row):
    return DictRow({col[0]: row[idx] for idx, col in enumerate(cursor.description)})


def _adapt_sql_for_pg(sql: str, *, has_params: bool) -> str:
    """SQL dialect shims so SQLite-flavored queries run on Postgres:
      - `?` placeholder  → `%s` (only when params were passed)
      - `datetime('now')` → `NOW()`
      - `date('now')` → `CURRENT_DATE` (caught silent-killer audit:
        `task_routes.list_tasks` used `date('now')` for the
        hide_future_start filter; PG raised `function date(unknown)
        does not exist` only when that filter was active)
      - ` LIKE ` → ` ILIKE ` so case-insensitive search matches
        SQLite's default `LIKE` behavior. Surrounded by spaces to
        avoid mangling a column or string literal that contains the
        substring "LIKE". The existing call sites that need
        case-sensitive matching can use `~` directly on PG; none do
        today.
      - `1`/`0` boolean literals have to be handled by the caller; we
        don't try to guess which integer columns are BOOLEAN.
    """
    if has_params and "?" in sql:
        sql = sql.replace("?", "%s")
    if "datetime('now')" in sql:
        sql = sql.replace("datetime('now')", "NOW()")
    if "date('now')" in sql:
        sql = sql.replace("date('now')", "CURRENT_DATE")
    if " LIKE " in sql:
        sql = sql.replace(" LIKE ", " ILIKE ")
    return sql


class _CompatCursor:
    """Wraps a psycopg2 cursor so SQLite-style code works unchanged:
      - `?` placeholders are rewritten to `%s` at execute time.
      - `lastrowid` is resolved via `SELECT lastval()` on demand.
    Any attribute/method not listed here delegates to the wrapped cursor
    (fetchone, fetchall, fetchmany, execute, close, description, etc.).
    """
    __slots__ = ("_cur",)

    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=None):
        sql = _adapt_sql_for_pg(sql, has_params=params is not None)
        if params is None:
            return self._cur.execute(sql)
        return self._cur.execute(sql, params)

    def executemany(self, sql, params):
        sql = _adapt_sql_for_pg(sql, has_params=True)
        return self._cur.executemany(sql, params)

    @property
    def lastrowid(self):
        # psycopg2 cursors don't populate lastrowid. lastval() returns the
        # most-recent sequence value in the session; correct for any table
        # with a SERIAL/IDENTITY id, which is all of ours.
        #
        # IMPORTANT: Read lastrowid immediately after each INSERT, before
        # any other execute() call. A second INSERT (even into a different
        # table) will advance lastval() and this property will silently
        # return the wrong id.
        self._cur.execute("SELECT lastval() AS v")
        row = self._cur.fetchone()
        return row["v"] if row else None

    def __getattr__(self, name):
        return getattr(self._cur, name)

    def __iter__(self):
        return iter(self._cur)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self._cur.close()


class _CompatConnection:
    """Wraps a psycopg2 connection so `conn.cursor()` yields `_CompatCursor`."""
    __slots__ = ("_conn",)

    def __init__(self, conn):
        self._conn = conn

    def cursor(self, *args, **kwargs):
        return _CompatCursor(self._conn.cursor(*args, **kwargs))

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _get_sqlite_connection():
    db_path = DATABASE_URL.replace("sqlite:///", "")
    conn = sqlite3.connect(db_path)
    conn.row_factory = _dict_factory
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


_NO_RETRY_PGCODES = {"28P01", "28000", "3D000", "42501"}


def _get_pg_connection():
    conn = psycopg2.connect(
        DATABASE_URL,
        cursor_factory=psycopg2.extras.RealDictCursor,
        connect_timeout=10,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=3,
    )
    conn.autocommit = False
    return _CompatConnection(conn)


def _get_pg_health_connection():
    """Fast-path connection for health probes — no retry, short timeout."""
    conn = psycopg2.connect(
        DATABASE_URL,
        cursor_factory=psycopg2.extras.RealDictCursor,
        connect_timeout=3,
    )
    conn.autocommit = True
    return conn


@contextmanager
def get_db():
    if DB_TYPE != "postgresql":
        conn = _get_sqlite_connection()
    else:
        max_retries, delay = 3, 0.5
        conn = None
        for attempt in range(max_retries):
            try:
                conn = _get_pg_connection()
                break
            except Exception as exc:
                pgcode = getattr(exc, "pgcode", None)
                if pgcode in _NO_RETRY_PGCODES or attempt == max_retries - 1:
                    raise
                log.warning("DB connect attempt %d failed (%s), retrying in %.1fs",
                            attempt + 1, exc, delay)
                time.sleep(delay)
                delay *= 2
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    else:
        conn.commit()
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
    created_at TEXT DEFAULT (datetime('now')),
    -- Soft-delete marker. NULL = active; set to a timestamp when the
    -- user archives. List endpoints filter this out by default; the
    -- row stays so routines and historical sessions still resolve.
    archived_at TEXT,
    -- Evidence-quality tier surfaced as a UI chip. NULL = unclassified;
    -- the operator-curated entries that ship with explicit RCT /
    -- MECHANISM / PRACTITIONER / THEORETICAL strings light up the chip.
    -- Validated client-side via a Pydantic Literal on create.
    evidence_tier TEXT
);

CREATE TABLE IF NOT EXISTS exercise_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    caption TEXT,
    sort_order INTEGER DEFAULT 0,
    content_hash TEXT,
    -- Screen-reader description. NULL = use the auto-default
    -- "{exercise.name} demonstration" rendered server-side at read time.
    -- Stored separately from `caption` because caption is user-facing
    -- copy (often empty) while alt_text is always meaningful for a11y.
    alt_text TEXT
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
    tracks_symptoms INTEGER NOT NULL DEFAULT 0,
    -- Operator-set wall-clock estimate in minutes (1-180). NULL =
    -- unspecified; mobile hides the duration pill on the routine card
    -- when null. Replaces the temptation to overload `goal` with a
    -- "quick" bucket — duration is orthogonal to goal.
    target_minutes INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
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
    notes TEXT,
    target_rpe INTEGER,
    updated_at TEXT DEFAULT (datetime('now'))
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
    tracks_symptoms INTEGER NOT NULL DEFAULT 0,
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
    pain_score INTEGER CHECK (pain_score BETWEEN 0 AND 10),
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

CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    request_id TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    client_ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

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
CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id);
CREATE INDEX IF NOT EXISTS idx_routine_ex_routine ON routine_exercises(routine_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON workout_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_sets_session ON session_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_symptom_logs_user ON symptom_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_exercise_images_ex_id ON exercise_images(exercise_id);
-- Dedup guard: an exercise can only hold one image per content hash. Partial
-- index so existing NULL-hashed rows (pre-feature) don't trip the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercise_images_hash
    ON exercise_images(exercise_id, content_hash)
    WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercises_global_slug ON exercises(slug) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercises_user_slug ON exercises(user_id, slug) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_sets_key ON session_sets(session_id, exercise_id, set_number);
CREATE INDEX IF NOT EXISTS idx_routine_ex_exercise ON routine_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS idx_session_sets_exercise ON session_sets(exercise_id);
"""


def init_db():
    """Schema bootstrap. Two paths:

    - **SQLite (dev / tests)**: run the inline `SQLITE_SCHEMA` +
      `_ensure_columns` ALTERs every time. This is the dev convenience
      path — a fresh clone "just works" with no extra step. Tests run
      against a fresh SQLite DB per test, so this runs constantly.

    - **Postgres (prod)**: do NOT run DDL on app boot. The numbered
      `migrations/*.sql` files are applied exactly once each via
      `scripts/migrate.py`, invoked from fly.toml's `release_command`
      before the new app version takes traffic. Boot only verifies
      that `schema_migrations` exists with at least one row applied;
      raise loudly otherwise so the deploy aborts before serving
      requests against a stale schema.

    The previous PG behavior — running CREATE TABLE IF NOT EXISTS +
    a forest of _ensure_columns ALTERs on every cold start — coupled
    startup to schema state, slowed Neon cold-start by ~hundreds of
    ms, and risked two parallel Fly machines racing the ALTERs during
    a rolling deploy. Tier 2 audit (PR #N) split that into an explicit
    deploy-time runner."""
    if DB_TYPE == "postgresql":
        with get_db() as conn:
            cur = conn.cursor()
            try:
                cur.execute("SELECT COUNT(*) AS n FROM schema_migrations")
                row = cur.fetchone()
                count = row["n"] if row else 0
            except Exception as e:
                # Table missing → migrator never ran. Don't try to fix
                # it from inside the app process; that's the precise
                # coupling we just removed. Fail loudly so the deploy
                # surfaces the problem before serving traffic.
                raise RuntimeError(
                    "schema_migrations table missing — run "
                    "`python scripts/migrate.py` before starting the app. "
                    f"Underlying error: {type(e).__name__}: {e}"
                ) from e
            if count == 0:
                raise RuntimeError(
                    "schema_migrations table is empty — no migrations "
                    "have been applied. Run `python scripts/migrate.py`."
                )
            log.info("PG schema verified: %d migration(s) applied", count)
        return

    # SQLite (dev) — keep the existing auto-init path.
    with get_db() as conn:
        cur = conn.cursor()
        cur.executescript(SQLITE_SCHEMA)

        # Idempotent column adds for existing dev databases. CREATE
        # TABLE IF NOT EXISTS won't modify a pre-existing table, so
        # features that add new columns also re-apply ALTERs here.
        # PG mode never reaches this block — it goes through the
        # numbered-migration runner instead.
        _ensure_columns(cur, "routines", [
            ("reminder_time", "TEXT"),
            ("reminder_days", "TEXT"),
            ("updated_at", "TEXT"),
            ("tracks_symptoms", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("target_minutes", "INTEGER"),
        ])
        _ensure_columns(cur, "routine_exercises", [
            ("updated_at", "TEXT"),
            ("target_rpe", "INTEGER"),
        ])
        _ensure_columns(cur, "workout_sessions", [
            ("tracks_symptoms", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ])
        _ensure_columns(cur, "session_sets", [
            ("pain_score", "INTEGER"),
            ("side", "TEXT"),
            ("is_warmup", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ])
        _ensure_columns(cur, "exercises", [
            ("archived_at", "TEXT"),
            ("evidence_tier", "TEXT"),
        ])
        _ensure_columns(cur, "exercise_images", [
            ("content_hash", "TEXT"),
            ("alt_text", "TEXT"),
        ])


def _ensure_columns(cur, table: str, columns: list[tuple[str, str]]) -> None:
    """Add columns to `table` if they don't already exist. Safe to run on
    every startup.

    Postgres path emits `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` directly
    so two Fly machines booting concurrently during a rolling deploy can't
    race a SELECT-then-ALTER against each other and crash the second
    instance with `DuplicateColumn`. PG 9.6+ takes the right catalog lock
    inside `IF NOT EXISTS`, so the second runner is a no-op.

    SQLite (dev only, single process) keeps the read-then-write path
    because older SQLite versions don't support `ADD COLUMN IF NOT EXISTS`
    consistently."""
    if DB_TYPE == "sqlite":
        cur.execute(f"PRAGMA table_info({table})")
        have = {r["name"] for r in cur.fetchall()}
        for name, typ in columns:
            if name not in have:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {name} {typ}")
        return
    for name, typ in columns:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {typ}")

"""
Database layer supporting both SQLite (local dev) and PostgreSQL (production).
SQLite requires no installation — just works. Set DATABASE_URL to a postgresql:// URL to use Postgres.
"""
import os
import re
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


def _convert_pg_to_sqlite(sql: str) -> str:
    """Convert PostgreSQL DDL to SQLite-compatible SQL."""
    sql = sql.replace("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT")
    sql = sql.replace("TIMESTAMPTZ", "TEXT")
    sql = sql.replace("DEFAULT NOW()", "DEFAULT (datetime('now'))")
    sql = re.sub(r"CREATE INDEX IF NOT EXISTS \w+ ON", "CREATE INDEX IF NOT EXISTS idx ON", sql)
    # Remove CHECK constraints that SQLite handles differently (keep them, SQLite supports CHECK)
    return sql


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
    title TEXT NOT NULL,
    note TEXT,
    priority INTEGER DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
    status TEXT DEFAULT 'none' CHECK (status IN (
        'none', 'next_action', 'active', 'waiting',
        'hold', 'postponed', 'someday', 'cancelled'
    )),
    starred BOOLEAN DEFAULT 0,
    due_date TEXT,
    due_time TEXT,
    repeat_type TEXT DEFAULT 'none' CHECK (repeat_type IN (
        'none', 'daily', 'weekly', 'biweekly',
        'monthly', 'quarterly', 'semiannual', 'yearly'
    )),
    repeat_from TEXT DEFAULT 'due_date' CHECK (repeat_from IN ('due_date', 'completion_date')),
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

import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from app.config import DATABASE_URL


def get_connection():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    import os
    schema_path = os.path.join(os.path.dirname(__file__), "..", "migrations", "001_schema.sql")
    with open(schema_path) as f:
        sql = f.read()
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)

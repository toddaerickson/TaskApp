"""Unit tests for `_adapt_sql_for_pg` — the SQLite-flavor → Postgres
shim that lets the codebase write SQLite-style SQL and have it work
on both backends.

These are pure-string tests (no DB connection) — the adapter is a
single function that runs on every cur.execute() in PG mode, so
regressing it would silently break PG-only call paths. Two prod bugs
hide in this layer:

- `date('now')` is SQLite-only. PG raises `function date(unknown)
  does not exist` only when the call site is exercised. Caught the
  first time the audit reviewed task_routes.list_tasks's
  `?hide_future_start=true` filter against PG.
- SQLite's `LIKE` is case-insensitive on ASCII; PG's is case-sensitive.
  Search routes that "worked locally" silently miss any uppercase
  query against the prod Neon DB.
"""
from app.database import _adapt_sql_for_pg


def test_question_mark_placeholders_rewritten_to_percent_s():
    sql = "SELECT * FROM tasks WHERE id = ? AND user_id = ?"
    out = _adapt_sql_for_pg(sql, has_params=True)
    assert out == "SELECT * FROM tasks WHERE id = %s AND user_id = %s"


def test_question_mark_left_alone_when_no_params():
    """Without params, `?` could appear inside a string literal we shouldn't
    touch (e.g. a `WHERE col LIKE '%?'` literal). The adapter only rewrites
    when we know params were passed."""
    sql = "SELECT '?' AS literal"
    out = _adapt_sql_for_pg(sql, has_params=False)
    assert out == sql


def test_datetime_now_rewritten_to_now():
    sql = "INSERT INTO tasks (title, created_at) VALUES (?, datetime('now'))"
    out = _adapt_sql_for_pg(sql, has_params=True)
    assert "NOW()" in out
    assert "datetime('now')" not in out


def test_date_now_rewritten_to_current_date():
    """The fix for the silent-killer audit finding: SQLite's date('now')
    is unknown in PG. Without this rewrite, the
    ?hide_future_start=true filter on /tasks raises
    `function date(unknown) does not exist`."""
    sql = "WHERE start_date <= date('now')"
    out = _adapt_sql_for_pg(sql, has_params=False)
    assert "CURRENT_DATE" in out
    assert "date('now')" not in out


def test_like_rewritten_to_ilike():
    """SQLite's LIKE is case-insensitive on ASCII; PG's is case-sensitive.
    Search routes worked locally + failed silently in prod. The space-
    surrounded match avoids mangling column names or string literals
    that happen to contain the substring `LIKE`."""
    sql = "SELECT * FROM tasks WHERE title LIKE ? OR note LIKE ?"
    out = _adapt_sql_for_pg(sql, has_params=True)
    assert "ILIKE" in out
    assert " LIKE " not in out


def test_like_inside_string_literal_left_alone():
    """The space-surrounded replace is the safety: a literal string
    containing 'LIKE' (no surrounding spaces) shouldn't be rewritten.
    `WHEREcol LIKE` (no leading space) wouldn't match — but real SQL
    always has the space, so the failure mode is purely defensive."""
    # The substring "LIKE" with no surrounding spaces — e.g. inside a
    # column name or a comment. Verify it survives.
    sql = "SELECT 'iLIKEtacos' AS x"
    out = _adapt_sql_for_pg(sql, has_params=False)
    assert out == sql

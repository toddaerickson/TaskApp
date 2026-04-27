"""Tests for `scripts/migrate.py` — the Postgres migration runner.

Tier 2 from the codebase audit: stop running DDL on app boot. The
runner is PG-only by design (SQLite uses the inline `init_db` path),
so most of these tests skip cleanly on the SQLite matrix leg.
"""
import pytest

from app.config import DB_TYPE
from scripts import migrate

PG_ONLY = pytest.mark.skipif(
    DB_TYPE != "postgresql",
    reason="migrate.py is PG-only; SQLite uses init_db",
)


def test_discover_migrations_returns_sorted_list():
    """File discovery is just sorted glob. The numeric prefix scheme
    (`001_`, `002_`, …) keeps lexicographic order in apply order well
    past `100_`. This test guards against a regression where someone
    drops the sort or returns by mtime."""
    files = migrate.discover_migrations()
    assert len(files) >= 2  # at least 001_schema.sql + 002_fix_boolean_columns.sql
    names = [p.name for p in files]
    assert names == sorted(names)
    assert "001_schema.sql" in names
    assert "002_fix_boolean_columns.sql" in names


@PG_ONLY
def test_dry_run_lists_pending_without_applying(client, capsys):
    """--dry-run reports which migrations would run but doesn't touch
    schema_migrations."""
    from app.database import get_db
    # The conftest `client` fixture already ran migrate.main([]) so the
    # tracking table is populated. Wipe just the tracking rows so we
    # can observe a "would apply" path.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM schema_migrations")
    capsys.readouterr()  # drain
    rc = migrate.main(["--dry-run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Would apply" in out
    assert "001_schema.sql" in out
    # Verify nothing was stamped.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS n FROM schema_migrations")
        assert cur.fetchone()["n"] == 0


@PG_ONLY
def test_apply_then_rerun_is_no_op(client, capsys):
    """Idempotency: running twice in a row applies once + reports
    nothing pending the second time. Critical for fly.toml's
    release_command which fires on every deploy."""
    capsys.readouterr()
    # Conftest already ran migrations. Second run should be a no-op.
    rc = migrate.main([])
    assert rc == 0
    out = capsys.readouterr().out
    assert "already applied" in out


@PG_ONLY
def test_status_shows_applied_count(client, capsys):
    capsys.readouterr()
    rc = migrate.main(["--status"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Applied" in out
    # Conftest applied everything; pending count should be 0.
    assert "Pending (0)" in out


def test_main_returns_2_on_sqlite():
    """SQLite hits the migrator's "wrong DB" guard. Operator running
    `python scripts/migrate.py` against a dev SQLite by mistake gets a
    clear error, not a confusing partial migration."""
    if DB_TYPE != "sqlite":
        pytest.skip("This test verifies SQLite-mode rejection")
    rc = migrate.main([])
    assert rc == 2

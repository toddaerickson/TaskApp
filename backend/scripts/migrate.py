"""
Postgres schema migration runner.

Tier 2 from the codebase audit: stop running DDL on every Fly cold-boot.
The previous pattern lived in `init_db` in `app/database.py` and ran a
forest of `CREATE TABLE IF NOT EXISTS` + `_ensure_columns` (idempotent
ALTER TABLE) calls on EVERY app process startup. That coupled startup
to schema state, slowed cold starts (Neon wake + DDL), and risked two
parallel Fly machines racing the ALTERs during a rolling deploy.

This runner introduces a `schema_migrations` tracking table and applies
numbered `*.sql` files from `backend/migrations/` exactly once per
filename. Operator runs it once at deploy time via fly.toml's
release_command. Idempotent: rerun is safe.

The existing `001_schema.sql` is the baseline — it uses
`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` everywhere,
so applying it against a fully-migrated DB is a no-op that just
stamps the row in `schema_migrations`. Going forward, every schema
change ships as `backend/migrations/NNN_xxx.sql`.

SQLite (dev / tests) stays on the existing `init_db` path:
`SQLITE_SCHEMA` + `_ensure_columns()`. The dual-write rule from
CLAUDE.md still applies — schema changes go in BOTH the new
numbered SQL file (PG) and the inline SQLite path.

Usage:
    venv/bin/python scripts/migrate.py            # apply pending
    venv/bin/python scripts/migrate.py --dry-run  # list pending only
    venv/bin/python scripts/migrate.py --status   # show applied + pending

Exit codes:
    0  success (or no migrations pending)
    1  a migration failed; transaction rolled back
    2  not running against PG (dev should use init_db)
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import DB_TYPE  # noqa: E402
from app.database import get_db  # noqa: E402

MIGRATIONS_DIR = ROOT / "migrations"


def discover_migrations() -> list[Path]:
    """Sorted list of `*.sql` files in `backend/migrations/`. Filenames
    must sort lexicographically into apply order — use a numeric prefix
    like `001_`, `002_`, etc. so the order survives alphabetic sort
    well past `100_`."""
    if not MIGRATIONS_DIR.is_dir():
        return []
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def ensure_tracking_table(cur) -> None:
    """Bootstrap the schema_migrations table itself. Can't be a
    migration since we'd have no way to know whether it's applied."""
    cur.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"""
    )


def applied_filenames(cur) -> set[str]:
    cur.execute("SELECT filename FROM schema_migrations")
    return {row["filename"] for row in cur.fetchall()}


def apply_one(cur, path: Path) -> None:
    """Read + execute a single migration file. Wrapped by the caller's
    transaction (get_db's commit-on-success). psycopg2 lets us send
    multiple statements in one execute() call when we don't pass
    params — which is what migration files do."""
    sql = path.read_text()
    if sql.strip():
        cur.execute(sql)
    cur.execute(
        "INSERT INTO schema_migrations (filename) VALUES (%s)",
        (path.name,),
    )


def main(argv: list[str] | None = None) -> int:
    """Entry point. `argv` is exposed so the test conftest can call
    `main([])` without argparse picking up pytest's own argv."""
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true",
                   help="List pending migrations without applying any.")
    p.add_argument("--status", action="store_true",
                   help="Show applied vs pending migrations.")
    args = p.parse_args(argv)

    if DB_TYPE != "postgresql":
        print(
            "ERROR: scripts/migrate.py only runs against Postgres. "
            "SQLite (dev / tests) uses the inline init_db path.",
            file=sys.stderr,
        )
        return 2

    files = discover_migrations()
    if not files:
        print("No migration files found in backend/migrations/.")
        return 0

    with get_db() as conn:
        cur = conn.cursor()
        ensure_tracking_table(cur)
        applied = applied_filenames(cur)
        pending = [p for p in files if p.name not in applied]

        if args.status:
            print(f"Applied ({len(applied)}):")
            for p in files:
                if p.name in applied:
                    print(f"  ✓ {p.name}")
            print(f"Pending ({len(pending)}):")
            for p in pending:
                print(f"  · {p.name}")
            return 0

        if not pending:
            print(f"All {len(files)} migrations already applied. Nothing to do.")
            return 0

        if args.dry_run:
            print(f"Would apply {len(pending)} migration(s):")
            for p in pending:
                print(f"  · {p.name}")
            return 0

        print(f"Applying {len(pending)} migration(s)…")
        for path in pending:
            try:
                apply_one(cur, path)
                print(f"  ✓ {path.name}")
            except Exception as e:
                # get_db's __exit__ rolls back the whole transaction so
                # nothing partial sticks. The error message itself goes
                # through the FastAPI logging filter when called as a
                # release_command — operator sees it in `fly logs`.
                print(f"  ✗ {path.name}: {type(e).__name__}: {e}", file=sys.stderr)
                raise

    print(f"Done. {len(pending)} migration(s) applied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

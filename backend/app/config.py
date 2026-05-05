import os
from pathlib import Path

# Use SQLite for local dev (no install needed), PostgreSQL for production
# Set DATABASE_URL env var to a postgresql:// URL to use PostgreSQL
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///taskapp.db")

# Neon and a few other providers default to the legacy `postgres://` form;
# psycopg2 accepts both, but our DB_TYPE detection below keys on the
# modern scheme. Normalize so the rest of the app sees one canonical value.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

DB_TYPE = "postgresql" if DATABASE_URL.startswith("postgresql") else "sqlite"

_DEV_JWT_SECRET = "dev-secret-change-in-production"
JWT_SECRET = os.environ.get("JWT_SECRET", _DEV_JWT_SECRET)
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 72

# Refuse to run against Postgres with the public dev secret — tokens would
# be forgeable by anyone who can read this repo.
if JWT_SECRET == _DEV_JWT_SECRET and DB_TYPE == "postgresql":
    raise RuntimeError(
        "JWT_SECRET is unset in a non-SQLite environment. "
        "Set it via `fly secrets set JWT_SECRET=$(openssl rand -hex 48)`."
    )

# Public origin where this backend serves `/static/exercise-images/<hash>.<ext>`.
# Used by app/image_urls.py to expand `local:` sentinel URLs (rows whose
# bytes are committed to backend/seed_data/exercise_images/) into a fully-
# qualified URL the mobile / web client can stick into <Image source>.
# Falsy → emit relative URLs starting with "/static/...". Mobile native
# rejects relative URIs, so production MUST set this. Empty string lets
# tests run without ceremony, since the test client never actually loads
# the bytes — only assertions about the returned URL string matter.
BACKEND_PUBLIC_URL = os.environ.get("BACKEND_PUBLIC_URL", "").rstrip("/")

# Image storage directory. Resolves the bytes that back `local:<filename>`
# sentinel URLs.
#
# Default: `backend/seed_data/exercise_images/` — what's been shipping in
# git since PR #103. Override via `IMAGE_STORAGE_DIR` env var; the
# StaticFiles mount in main.py picks up whatever path lands here.
#
# Pluggable backend support (R2 / S3) lands in PR-A2b. PR-A2a (this PR)
# only makes the LOCAL directory configurable so the abstraction layer
# doesn't ship as a no-op refactor.
_DEFAULT_IMAGE_DIR = (
    Path(__file__).resolve().parent.parent / "seed_data" / "exercise_images"
)
IMAGE_STORAGE_DIR = Path(
    os.environ.get("IMAGE_STORAGE_DIR", str(_DEFAULT_IMAGE_DIR))
)

# Cloudflare R2 credentials. Read at import time but NOT used yet — the
# `R2Storage` wrapper in app/r2_storage.py is wired but no route calls it.
# PR-A2b adds the upload pipeline and PR-A2c adds the backfill. Setting
# these in advance is harmless: an unset value just means R2Storage
# raises `RuntimeError("R2 not configured")` if instantiated.
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.environ.get("R2_BUCKET", "")
# Public read URL of the R2 bucket. Either Cloudflare's
# `pub-<hash>.r2.dev` or a custom domain. The resolver in image_urls.py
# will start using this in PR-A2b once `r2:<filename>` sentinels begin
# appearing in the DB.
R2_PUBLIC_URL = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")


def r2_configured() -> bool:
    """All four credentials + bucket + public URL set. Falsy → R2Storage
    refuses to construct. Single-vendor conditional that future routes
    can use to gate behavior without re-checking each var."""
    return all([
        R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY,
        R2_BUCKET,
        R2_PUBLIC_URL,
    ])

import os

# Use SQLite for local dev (no install needed), PostgreSQL for production
# Set DATABASE_URL env var to a postgresql:// URL to use PostgreSQL
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///taskapp.db")
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

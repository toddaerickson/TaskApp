import os

# Use SQLite for local dev (no install needed), PostgreSQL for production
# Set DATABASE_URL env var to a postgresql:// URL to use PostgreSQL
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///taskapp.db")
DB_TYPE = "postgresql" if DATABASE_URL.startswith("postgresql") else "sqlite"

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 72

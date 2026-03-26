import os

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost:5432/taskapp")
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 72

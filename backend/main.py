import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.routes import (
    auth_routes, folder_routes, tag_routes, task_routes,
    subfolder_routes, reminder_routes,
    exercise_routes, routine_routes, session_routes,
    export_routes, admin_routes,
)
from app.config import DB_TYPE
from app.database import init_db

# Uvicorn configures its own loggers, but our app modules (logger names
# starting with `app.` or `__main__`) don't inherit its handlers. Set up
# basicConfig so `log.exception(...)` lands in `fly logs` with a traceback
# instead of being silently dropped into a 500.
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("taskapp")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize DB schema (idempotent — uses CREATE IF NOT EXISTS).
    init_db()
    yield
    # No shutdown work currently.


app = FastAPI(title="TaskApp API", version="1.0.0", lifespan=lifespan)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """Last-resort catch-all so prod exceptions leave a traceback in the
    logs instead of a bare `500 Internal Server Error`. Route-level
    HTTPExceptions are handled by FastAPI's default and don't reach here."""
    log.exception("Unhandled exception in %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})

# CORS: allow local dev origins + anything in CORS_ORIGINS env (comma-
# separated). Set CORS_ORIGINS to your deployed frontend URL in prod, e.g.
# `https://taskapp.vercel.app,https://taskapp-teric.vercel.app`.
_extra = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
_origins = [
    "http://localhost:8081",    # expo web
    "http://localhost:19006",   # older expo web
    "http://localhost:3000",
    *_extra,
]
# In dev (SQLite), if CORS_ORIGINS is unset, fall back to allow-all so a
# fresh clone "just works". In prod (Postgres), refuse to start without an
# explicit allowlist — `*` would let any site call the API on behalf of
# logged-in users.
if not _extra:
    if DB_TYPE == "postgresql":
        raise RuntimeError(
            "CORS_ORIGINS must be set in production. "
            "Example: `fly secrets set CORS_ORIGINS=https://taskapp.vercel.app`."
        )
    _origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # Auth is Bearer-token in the Authorization header (see app/auth.py
    # using HTTPBearer) — no cookies, no sessions. Keeping credentials off
    # avoids the spec gotcha where `*` origins/headers get silently
    # ignored on credentialed requests.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(folder_routes.router)
app.include_router(tag_routes.router)
app.include_router(task_routes.router)
app.include_router(subfolder_routes.router)
app.include_router(reminder_routes.router)
app.include_router(exercise_routes.router)
app.include_router(routine_routes.router)
app.include_router(session_routes.router)
app.include_router(export_routes.router)
app.include_router(admin_routes.router)


@app.get("/health")
def health():
    return {"status": "ok"}

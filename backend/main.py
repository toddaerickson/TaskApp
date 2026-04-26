import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.routes import (
    auth_routes, folder_routes, tag_routes, task_routes,
    subfolder_routes, reminder_routes,
    exercise_routes, routine_routes, session_routes,
    export_routes, admin_routes,
)
from app.config import DB_TYPE
from app.database import init_db
from app.rate_limit import limiter
from app.admin_audit import AdminAuditMiddleware
from app.request_id import (
    RequestIDMiddleware, current_request_id, install_logging_filter,
)
from app.sentry_setup import init_sentry

# Sentry init must run BEFORE FastAPI is created so the integrations can
# patch Starlette/FastAPI internals on import. No-op when SENTRY_DSN is
# not set — dev/CI/tests stay quiet.
init_sentry()

# Uvicorn configures its own loggers, but our app modules (logger names
# starting with `app.` or `__main__`) don't inherit its handlers. Set up
# basicConfig so `log.exception(...)` lands in `fly logs` with a traceback
# instead of being silently dropped into a 500.
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s [rid=%(request_id)s]: %(message)s",
)
install_logging_filter()
log = logging.getLogger("taskapp")

@asynccontextmanager
async def lifespan(app: FastAPI):
    import time as _time
    t0 = _time.monotonic()
    init_db()
    log.info("DB initialized in %.1fs (type=%s)", _time.monotonic() - t0, DB_TYPE)
    yield


app = FastAPI(title="TaskApp API", version="1.0.0", lifespan=lifespan)

# Request-ID tagging: every request gets a short id (either the client's
# X-Request-Id or a fresh uuid4[:12]). Log records and error responses
# pick it up via contextvar so a mobile crash can be paired with a
# server log line.
app.add_middleware(RequestIDMiddleware)

# Machine-readable error codes. Mobile `describeApiError` maps known codes
# to specific UX messages; any status without an entry falls back to the
# caller's string detail.
_STATUS_TO_CODE: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
}


def _code_for_status(status: int) -> str:
    return _STATUS_TO_CODE.get(status, "error")


@app.exception_handler(StarletteHTTPException)
async def _http_exc_handler(request: Request, exc: StarletteHTTPException):
    """Uniform error shape: {"detail": str|list, "code": str, "request_id": str}.

    Routes can opt into a specific code by raising
    `HTTPException(status_code, detail={"detail": "...", "code": "x"})`;
    otherwise the code is derived from the status. The request_id is
    the same short id echoed back via the X-Request-Id header.

    Any additional keys on a dict-detail (e.g. `current` for a 409
    reconcile payload) are carried through at the top level so the
    client can recover in a single round-trip.
    """
    detail = exc.detail
    code: str | None = None
    extras: dict = {}
    if isinstance(detail, dict):
        code = detail.get("code")
        # Preserve extras — anything beyond `code` + `detail` — so a
        # route can piggyback reconcile data on a 4xx.
        extras = {k: v for k, v in detail.items() if k not in ("code", "detail")}
        detail = detail.get("detail", detail)
    if not isinstance(code, str) or not code:
        code = _code_for_status(exc.status_code)
    body = {"detail": detail, "code": code, "request_id": current_request_id()}
    body.update(extras)
    return JSONResponse(
        status_code=exc.status_code,
        content=body,
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def _validation_exc_handler(request: Request, exc: RequestValidationError):
    # Pydantic v2 errors can embed unserializable objects (e.g. the
    # original ValueError in `ctx`); run them through jsonable_encoder
    # so the response body encodes cleanly.
    return JSONResponse(
        status_code=422,
        content={
            "detail": jsonable_encoder(exc.errors()),
            "code": "validation_error",
            "request_id": current_request_id(),
        },
    )


# slowapi rate limiter. Install the shared Limiter on app.state and register
# a custom 429 handler so the body carries our `code` field too. The
# SlowAPIMiddleware wires the limiter into the request lifecycle.
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "detail": f"Rate limit exceeded: {exc.detail}",
            "code": "rate_limited",
            "request_id": current_request_id(),
        },
    )


app.add_middleware(SlowAPIMiddleware)
# Records every /admin/* request in admin_audit. Must be registered here so
# it sees the response status; per-route decoration can't observe that.
app.add_middleware(AdminAuditMiddleware)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """Last-resort catch-all so prod exceptions leave a traceback in the
    logs instead of a bare `500 Internal Server Error`. Route-level
    HTTPExceptions are handled by `_http_exc_handler` above."""
    log.exception("Unhandled exception in %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal Server Error",
            "code": "internal_error",
            "request_id": current_request_id(),
        },
    )

# CORS: allow local dev origins + anything in CORS_ORIGINS env (comma-
# separated). Set CORS_ORIGINS to your deployed frontend URL in prod, e.g.
# `https://taskapp-workout.vercel.app` (comma-separated if multiple
# origins — add preview domains one at a time as needed).
_extra = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
_origins = [
    "http://localhost:8081",    # expo web
    "http://localhost:19006",   # older expo web
    "http://localhost:3000",
    *_extra,
]
# Dev (SQLite) + unset CORS_ORIGINS → allow-all so a fresh clone "just
# works". Prod (Postgres) + unset → boot with only localhost origins and
# log loudly. We used to RuntimeError here, which crash-looped the Fly
# machine and got masked as "403 host_not_allowed" from the edge proxy
# — the operator saw a network failure instead of a clear startup error.
# Boot-and-warn keeps /health reachable so the ops path is obvious.
_cors_misconfigured = False
if not _extra:
    if DB_TYPE == "postgresql":
        _cors_misconfigured = True
        log.error(
            "CORS_ORIGINS is not set in production. Browser requests from "
            "the frontend will be blocked until you set it via `fly secrets "
            "set CORS_ORIGINS=https://your-frontend.vercel.app`. The app "
            "will still serve /health and respond to curl requests so you "
            "can diagnose from the Fly dashboard."
        )
    else:
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

# Self-hosted exercise images. Rows whose `url` column is the sentinel
# `local:<filename>` (see app/image_urls.py) get expanded by the hydrator
# to `${BACKEND_PUBLIC_URL}/static/exercise-images/<filename>`. The bytes
# are committed in `backend/seed_data/exercise_images/`. StaticFiles
# serves them with sane caching headers; the hash-keyed filenames are
# safe to cache aggressively because changing an image creates a new
# filename rather than mutating an old one.
_IMAGE_DIR = Path(__file__).resolve().parent / "seed_data" / "exercise_images"
_IMAGE_DIR.mkdir(parents=True, exist_ok=True)


class _NoDotfilesStaticFiles(StaticFiles):
    """StaticFiles that 404s any path segment beginning with a dot. The
    image dir starts life with no real assets; without this guard a stray
    `.DS_Store`, editor swap file, or future SOPS leftover would be
    publicly fetchable from the unauthenticated mount."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        from starlette.responses import PlainTextResponse
        for segment in path.split("/"):
            if segment.startswith("."):
                return PlainTextResponse("Not Found", status_code=404)
        return await super().get_response(path, scope)


app.mount(
    "/static/exercise-images",
    _NoDotfilesStaticFiles(directory=str(_IMAGE_DIR)),
    name="exercise-images",
)

# Production must set BACKEND_PUBLIC_URL because RN native rejects
# relative URIs — without it, every self-hosted image (once PR4 backfills
# bytes) renders as the "Image unavailable" fallback in iOS/Android. Mirror
# the CORS_ORIGINS warn-loudly pattern so a missing secret stays
# diagnosable without crash-looping the boot.
from app.config import BACKEND_PUBLIC_URL  # noqa: E402 — needed for diagnostic flag
_public_url_misconfigured = False
if DB_TYPE == "postgresql" and not BACKEND_PUBLIC_URL:
    _public_url_misconfigured = True
    log.error(
        "BACKEND_PUBLIC_URL is not set in production. Self-hosted "
        "exercise images will be served as relative URLs that RN native "
        "clients reject. Set it via `fly secrets set "
        "BACKEND_PUBLIC_URL=https://your-backend.fly.dev`."
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
    if DB_TYPE != "postgresql":
        return {"status": "ok"}
    try:
        from app.database import _get_pg_health_connection
        conn = _get_pg_health_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1 AS one")
            cur.fetchone()
        finally:
            conn.close()
        return {"status": "ok"}
    except Exception as e:
        log.warning("Health check DB probe failed: %s", e)
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "detail": "db_unreachable"},
        )


@app.get("/health/detailed")
def health_detailed():
    """Diagnostic health view — safe to call unauthenticated. Reports
    which config surfaces are set so the operator can see via curl or
    the Fly dashboard exactly what's missing when the app is alive but
    the frontend can't talk to it. Intentionally never returns a 5xx
    so a broken config stays observable — a 200 body with fields set
    to False is the right "diagnosable" state.

    Fields:
      - db_type: "sqlite" or "postgresql"
      - db_reachable: True when a SELECT 1 round-trips
      - cors_origins_configured: True when CORS_ORIGINS env is non-empty
      - jwt_secret_configured: True when JWT_SECRET was set from env
        (not the public dev fallback)
      - sentry_configured: True when SENTRY_DSN is set (optional)

    Returns secrets' *presence*, never their *values*. Safe to call
    from an untrusted edge monitor."""
    from app.config import JWT_SECRET
    # Import guard — the dev-fallback string lives in config.py and we
    # don't want to re-export it. Matching the length is a cheap proxy.
    jwt_is_dev = JWT_SECRET == "dev-secret-change-in-production"

    # Probe the DB with a 1-second budget. Wraps any connection / auth
    # failure into db_reachable=False rather than letting it bubble; the
    # whole point of this endpoint is to return a useful status even when
    # downstream dependencies are broken.
    db_reachable = False
    db_error: str | None = None
    try:
        from app.database import get_db
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 AS one")
            row = cur.fetchone()
            db_reachable = bool(row and row.get("one") == 1)
    except Exception as e:  # noqa: BLE001 — intentionally broad; report any failure
        db_error = f"{type(e).__name__}: {e}"[:200]

    return {
        "status": "ok",
        "db_type": DB_TYPE,
        "db_reachable": db_reachable,
        "db_error": db_error,
        "cors_origins_configured": not _cors_misconfigured,
        "jwt_secret_configured": not jwt_is_dev,
        "sentry_configured": bool(os.environ.get("SENTRY_DSN")),
        # False in PG/prod when BACKEND_PUBLIC_URL is unset. Self-hosted
        # exercise images will fail to render on RN native clients until
        # the secret is set (web stays functional via same-origin
        # relative URLs).
        "public_url_configured": not _public_url_misconfigured,
    }

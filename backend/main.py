import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
from app.request_id import (
    RequestIDMiddleware, current_request_id, install_logging_filter,
)

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
    # Startup: initialize DB schema (idempotent — uses CREATE IF NOT EXISTS).
    init_db()
    yield
    # No shutdown work currently.


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
    """
    detail = exc.detail
    code: str | None = None
    if isinstance(detail, dict):
        code = detail.get("code")
        detail = detail.get("detail", detail)
    if not isinstance(code, str) or not code:
        code = _code_for_status(exc.status_code)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail, "code": code, "request_id": current_request_id()},
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

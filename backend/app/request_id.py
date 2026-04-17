"""Request-ID threading.

Every inbound request gets a short id (generated fresh, or reused from
the client's `X-Request-Id` header when present). The id is:

  1. Stored in a ContextVar so log records inside the handler can render it.
  2. Echoed back on the response header so a mobile crash report can be
     paired with the server log line.
  3. Surfaced via `request.state.request_id` for handlers that want it.

Correlation only — not a security token.
"""
from contextvars import ContextVar
import logging
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

REQUEST_ID_HEADER = "X-Request-Id"
_DEFAULT_ID = "-"

_request_id_ctx: ContextVar[str] = ContextVar("request_id", default=_DEFAULT_ID)


def current_request_id() -> str:
    return _request_id_ctx.get(_DEFAULT_ID)


def _new_id() -> str:
    # 12 hex chars is enough collision resistance for correlation within a
    # short window and keeps the id short enough to paste comfortably.
    return uuid.uuid4().hex[:12]


class RequestIDFilter(logging.Filter):
    """Inject the current request id onto every log record so formatters
    can reference `%(request_id)s`. Records from outside any request
    (startup / shutdown / background) get the default sentinel."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id_ctx.get(_DEFAULT_ID)
        return True


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(REQUEST_ID_HEADER)
        rid = incoming if incoming and len(incoming) <= 64 else _new_id()
        token = _request_id_ctx.set(rid)
        request.state.request_id = rid
        try:
            response = await call_next(request)
        finally:
            _request_id_ctx.reset(token)
        response.headers[REQUEST_ID_HEADER] = rid
        return response


def install_logging_filter(logger: logging.Logger | None = None) -> None:
    """Attach the request-id filter to a logger's handlers (defaults to root)
    so the %(request_id)s format field resolves in every message."""
    target = logger or logging.getLogger()
    fltr = RequestIDFilter()
    # Attach to both the logger itself and every handler it owns. Logger-
    # level filters drop before propagation; handler-level filters catch
    # records that reach this handler via a different path.
    if not any(isinstance(f, RequestIDFilter) for f in target.filters):
        target.addFilter(fltr)
    for handler in target.handlers:
        if not any(isinstance(f, RequestIDFilter) for f in handler.filters):
            handler.addFilter(fltr)

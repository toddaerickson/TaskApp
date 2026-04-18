"""Admin-endpoint audit middleware.

Every request to `/admin/*` is recorded in the `admin_audit` table after
the response is determined. Captures method, path, request id (for log
correlation), status code, duration, client IP, and user-agent.

No user_id: admin auth is a shared `SNAPSHOT_AUTH_TOKEN`, not a JWT, so
we identify the caller by IP + UA. Pair with the `rid=…` server log line
via request_id when a deeper look is needed.
"""
import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.database import get_db
from app.request_id import current_request_id

log = logging.getLogger(__name__)


class AdminAuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        is_admin = request.url.path.startswith("/admin")
        if not is_admin:
            return await call_next(request)

        start = time.monotonic()
        response = await call_next(request)
        duration_ms = int((time.monotonic() - start) * 1000)

        try:
            client_ip = request.client.host if request.client else None
            user_agent = request.headers.get("user-agent")
            rid = current_request_id()
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO admin_audit
                    (method, path, request_id, status_code, duration_ms,
                     client_ip, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        request.method, request.url.path, rid,
                        response.status_code, duration_ms, client_ip, user_agent,
                    ),
                )
        except Exception as e:
            # Audit logging must never break the response. Log and move on.
            log.warning("admin_audit insert failed: %s", e)

        return response

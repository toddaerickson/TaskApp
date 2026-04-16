"""
Admin endpoints that aren't user-facing.

`GET /admin/snapshot` streams the current exercise-library snapshot as
JSON. Used by the .github/workflows/snapshot.yml Action (triggered by
a repository_dispatch event fired every time an image is saved) to keep
backend/seed_data/exercise_snapshot.json in sync with production.

Auth: a shared secret passed via `Authorization: Bearer <token>`. The
server compares against `SNAPSHOT_AUTH_TOKEN` env var. Both sides (Fly
secret + GitHub Actions secret) must agree. If the env var is unset,
the endpoint returns 503 — fail closed.
"""
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import JSONResponse

from app.database import get_db
from app.snapshot import build_snapshot

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_snapshot_token(authorization: Optional[str]) -> None:
    expected = os.environ.get("SNAPSHOT_AUTH_TOKEN", "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin snapshot endpoint not configured",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    if authorization.removeprefix("Bearer ").strip() != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


@router.get("/snapshot")
def snapshot(
    authorization: Optional[str] = Header(default=None),
    user_email: Optional[str] = Query(
        default=None,
        description=(
            "If provided, include that user's personal exercises (promoted to globals) "
            "in addition to existing globals."
        ),
    ),
):
    _require_snapshot_token(authorization)

    user_id: Optional[int] = None
    with get_db() as conn:
        cur = conn.cursor()
        if user_email:
            cur.execute("SELECT id FROM users WHERE email = ?", (user_email,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"User '{user_email}' not found")
            user_id = row["id"]
        payload = build_snapshot(cur, user_id)

    # Pretty-printed so a raw git diff is human-readable.
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": 'attachment; filename="exercise_snapshot.json"',
            "Cache-Control": "no-store",
        },
    )

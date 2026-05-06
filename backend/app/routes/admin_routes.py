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

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import JSONResponse

from app.database import get_db
from app.image_urls import resolve_image_url
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


@router.get("/sample-image-urls")
def sample_image_urls(
    authorization: Optional[str] = Header(default=None),
    n: int = Query(default=20, ge=1, le=200),
):
    """Return up to `n` resolved image URLs for the smoke-test
    workflow (CI #1).

    Authenticated by the same `SNAPSHOT_AUTH_TOKEN` shared secret as
    `/admin/snapshot` — gating prevents the endpoint from being a
    free row-listing for the public.

    Sampling: prefers self-hosted (`local:` / `r2:`) rows because
    those are the ones the smoke test is designed to catch rotting.
    Random across the full table when not enough self-hosted rows
    exist (e.g. before backfill runs). Returns the resolved public
    URL for each row, not the raw sentinel — the workflow can HEAD
    each one directly without needing to know the resolver rules.
    """
    _require_snapshot_token(authorization)

    with get_db() as conn:
        cur = conn.cursor()
        # Prefer self-hosted rows. Random sampling is dialect-portable
        # via ORDER BY RANDOM() (SQLite) / RANDOM() (PG — same name).
        cur.execute(
            "SELECT url FROM exercise_images "
            "WHERE url LIKE 'local:%' OR url LIKE 'r2:%' "
            "ORDER BY RANDOM() LIMIT ?",
            (n,),
        )
        rows = [r["url"] for r in cur.fetchall()]
        # If we don't have enough self-hosted rows yet, top up with
        # https: rows so the smoke test still has a meaningful
        # sample during the migration window.
        if len(rows) < n:
            cur.execute(
                "SELECT url FROM exercise_images "
                "WHERE url NOT LIKE 'local:%' AND url NOT LIKE 'r2:%' "
                "ORDER BY RANDOM() LIMIT ?",
                (n - len(rows),),
            )
            rows.extend(r["url"] for r in cur.fetchall())

    # Resolve to public URLs so the caller doesn't need to know the
    # sentinel scheme. Drop empties (resolver returns "" for malformed
    # sentinels — those are bugs the smoke test SHOULD see, but as
    # 404s on a fetch attempt rather than as JSON nulls).
    resolved = [u for u in (resolve_image_url(r) for r in rows) if u]
    return {"urls": resolved}

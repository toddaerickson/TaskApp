import asyncio
import logging
import os
import time
import urllib.parse
import urllib.request
import json as _json
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

log = logging.getLogger(__name__)
from app.database import get_db
from app.auth import get_current_user_id
from app.github_dispatch import dispatch_library_updated
from app.models import (
    ExerciseCreate, ExerciseUpdate, ExerciseResponse,
    ExerciseImageCreate, ExerciseImageResponse,
    BulkImageRequest, BulkImageResult,
)
from app.hydrate import hydrate_exercises_with_images

router = APIRouter(prefix="/exercises", tags=["exercises"])


def _hydrate_one(cur, row: dict) -> dict:
    hydrate_exercises_with_images(cur, [row])
    return row


@router.get("", response_model=list[ExerciseResponse])
def list_exercises(
    category: str | None = None,
    search: str | None = Query(None, min_length=1),
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        sql = "SELECT * FROM exercises WHERE (user_id IS NULL OR user_id = ?)"
        params: list = [user_id]
        if category:
            sql += " AND category = ?"
            params.append(category)
        if search:
            sql += " AND LOWER(name) LIKE ?"
            params.append(f"%{search.lower()}%")
        sql += " ORDER BY name ASC"
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        return hydrate_exercises_with_images(cur, rows)


@router.get("/{exercise_id}", response_model=ExerciseResponse)
def get_exercise(exercise_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM exercises WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
            (exercise_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        return _hydrate_one(cur, row)


@router.post("", response_model=ExerciseResponse)
def create_exercise(req: ExerciseCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO exercises
            (user_id, name, slug, category, primary_muscle, equipment, difficulty,
             is_bodyweight, measurement, instructions, cue, contraindications, min_age, max_age)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, req.name, req.slug, req.category, req.primary_muscle, req.equipment,
             req.difficulty, bool(req.is_bodyweight), req.measurement, req.instructions,
             req.cue, req.contraindications, req.min_age, req.max_age),
        )
        ex_id = cur.lastrowid
        cur.execute("SELECT * FROM exercises WHERE id = ?", (ex_id,))
        return _hydrate_one(cur, cur.fetchone())


@router.put("/{exercise_id}", response_model=ExerciseResponse)
def update_exercise(exercise_id: int, req: ExerciseUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        # Allow edits on global exercises (user_id IS NULL) OR user's own exercises.
        # Single-user self-hosted: any authenticated user can tune the shared library.
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot edit another user's exercise")
        fields = {k: v for k, v in req.model_dump(exclude_unset=True).items()}
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            params = list(fields.values()) + [exercise_id]
            cur.execute(f"UPDATE exercises SET {sets} WHERE id = ?", tuple(params))
        cur.execute("SELECT * FROM exercises WHERE id = ?", (exercise_id,))
        return _hydrate_one(cur, cur.fetchone())


@router.delete("/{exercise_id}")
def delete_exercise(exercise_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if row["user_id"] != user_id:
            raise HTTPException(403, "Cannot delete a global exercise")
        cur.execute("DELETE FROM exercises WHERE id = ?", (exercise_id,))
    return {"ok": True}


@router.post("/{exercise_id}/images", response_model=ExerciseImageResponse)
def add_image(
    exercise_id: int,
    req: ExerciseImageCreate,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot add image to another user's exercise")
        cur.execute(
            "INSERT INTO exercise_images (exercise_id, url, caption, sort_order) VALUES (?, ?, ?, ?)",
            (exercise_id, req.url, req.caption, req.sort_order or 0),
        )
        img_id = cur.lastrowid
        cur.execute("SELECT id, url, caption, sort_order FROM exercise_images WHERE id = ?", (img_id,))
        result = cur.fetchone()
    # Tell GitHub the library changed; workflow debounces via concurrency group.
    background_tasks.add_task(dispatch_library_updated)
    return result


@router.post("/images/bulk", response_model=list[BulkImageResult])
def bulk_images(
    req: BulkImageRequest,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
):
    """Admin: paste rows mapping slug -> [urls]. Appends by default; replace=true clears existing first."""
    results: list[BulkImageResult] = []
    with get_db() as conn:
        cur = conn.cursor()
        for entry in req.entries:
            cur.execute(
                "SELECT id, user_id FROM exercises WHERE slug = ? AND (user_id IS NULL OR user_id = ?)",
                (entry.slug, user_id),
            )
            row = cur.fetchone()
            if not row:
                results.append(BulkImageResult(slug=entry.slug, status="not_found"))
                continue
            ex_id = row["id"]
            replaced = 0
            if entry.replace:
                cur.execute("SELECT COUNT(*) AS c FROM exercise_images WHERE exercise_id = ?", (ex_id,))
                replaced = cur.fetchone()["c"]
                cur.execute("DELETE FROM exercise_images WHERE exercise_id = ?", (ex_id,))
            cur.execute(
                "SELECT COALESCE(MAX(sort_order), -1) AS m FROM exercise_images WHERE exercise_id = ?",
                (ex_id,),
            )
            start = cur.fetchone()["m"] + 1
            added = 0
            for i, url in enumerate(entry.urls):
                url = url.strip()
                if not url:
                    continue
                cur.execute(
                    "INSERT INTO exercise_images (exercise_id, url, sort_order) VALUES (?, ?, ?)",
                    (ex_id, url, start + i),
                )
                added += 1
            results.append(BulkImageResult(slug=entry.slug, status="ok",
                                            added=added, replaced=replaced))
    if any(r.status == "ok" and (r.added or r.replaced) for r in results):
        background_tasks.add_task(dispatch_library_updated)
    return results


class ImageCandidate(BaseModel):
    url: str
    thumb: str | None = None
    source: str | None = None
    width: int | None = None
    height: int | None = None


def _coerce_int(v) -> int | None:
    try:
        return int(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


# In-memory TTL cache for search results. Key: (query_lower, n).
# Scoped to the process; fine for single-instance deployments.
_SEARCH_CACHE: dict[tuple[str, int], tuple[float, list[ImageCandidate]]] = {}
_SEARCH_TTL_SEC = 300  # 5 min — long enough to help the "reopen modal" flow
_SEARCH_BUDGET_SEC = 8.0


def _search_pixabay(query: str, n: int) -> list[ImageCandidate]:
    key = os.environ.get("PIXABAY_KEY")
    if not key:
        return []
    url = "https://pixabay.com/api/?" + urllib.parse.urlencode({
        "key": key, "q": query, "per_page": max(3, min(n, 200)),
        "image_type": "photo", "safesearch": "true",
    })
    try:
        with urllib.request.urlopen(url, timeout=6) as r:
            data = _json.loads(r.read().decode())
    except Exception as e:
        log.warning("Pixabay search failed for %r: %s", query, e)
        return []
    return [
        ImageCandidate(
            url=h.get("webformatURL") or h.get("largeImageURL", ""),
            thumb=h.get("previewURL"),
            source="pixabay.com",
            width=h.get("imageWidth"), height=h.get("imageHeight"),
        )
        for h in data.get("hits", [])[:n]
        if h.get("webformatURL") or h.get("largeImageURL")
    ]


def _search_ddg(query: str, n: int) -> list[ImageCandidate]:
    try:
        from ddgs import DDGS  # type: ignore
    except ImportError:
        log.warning("ddgs package not installed; skipping DDG search")
        return []
    try:
        with DDGS(timeout=6) as d:
            rows = list(d.images(query, max_results=n, safesearch="moderate"))
    except Exception as e:
        log.warning("DDG search failed for %r: %s", query, e)
        return []
    out: list[ImageCandidate] = []
    for r in rows[:n]:
        u = r.get("image")
        if not u:
            continue
        out.append(ImageCandidate(
            url=u,
            thumb=r.get("thumbnail"),
            source=r.get("source") or r.get("host"),
            width=_coerce_int(r.get("width")),
            height=_coerce_int(r.get("height")),
        ))
    return out


def _merge_candidates(pix: list[ImageCandidate], ddg: list[ImageCandidate], n: int) -> list[ImageCandidate]:
    merged: list[ImageCandidate] = []
    seen: set[str] = set()
    for pair in zip(pix, ddg):
        for c in pair:
            if c.url and c.url not in seen:
                seen.add(c.url)
                merged.append(c)
    for c in pix[len(ddg):] + ddg[len(pix):]:
        if c.url and c.url not in seen:
            seen.add(c.url)
            merged.append(c)
    return merged[:n]


@router.get("/{exercise_id}/search-images", response_model=list[ImageCandidate])
async def search_images(
    exercise_id: int,
    q: str | None = Query(None, description="Override the search query (defaults to exercise name)"),
    n: int = Query(6, ge=1, le=15),
    user_id: int = Depends(get_current_user_id),
):
    """Return candidate image URLs from free sources (DuckDuckGo + optional
    Pixabay). Caller picks one and POSTs to /exercises/{id}/images. Pixabay
    is used when PIXABAY_KEY env is set; otherwise DDG only.

    - Providers run concurrently in a thread pool (both do blocking I/O).
    - Total time is capped at 8s; if a provider misses the deadline its
      results are dropped and whatever arrived is returned.
    - Results are cached in-process for 5 minutes keyed on (query, n).
    """
    with get_db() as conn:
        cur = conn.cursor()
        # Scope to globals or the caller's own exercise. Matches other endpoints.
        cur.execute(
            "SELECT name FROM exercises WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
            (exercise_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        query = (q or row["name"]).strip()

    key = (query.lower(), n)
    cached = _SEARCH_CACHE.get(key)
    now = time.time()
    if cached and now - cached[0] < _SEARCH_TTL_SEC:
        return cached[1]

    tasks = [
        asyncio.to_thread(_search_pixabay, query, n),
        asyncio.to_thread(_search_ddg, query, n),
    ]
    try:
        pix, ddg = await asyncio.wait_for(asyncio.gather(*tasks), timeout=_SEARCH_BUDGET_SEC)
    except asyncio.TimeoutError:
        log.warning("Image search exceeded %.1fs budget for %r", _SEARCH_BUDGET_SEC, query)
        # Whatever finished by cancellation is gone; return empty rather than hang.
        pix, ddg = [], []

    merged = _merge_candidates(pix, ddg, n)
    _SEARCH_CACHE[key] = (now, merged)
    # Bound the cache so a long-running server doesn't leak memory.
    if len(_SEARCH_CACHE) > 200:
        oldest = sorted(_SEARCH_CACHE.items(), key=lambda kv: kv[1][0])[:100]
        for k, _ in oldest:
            _SEARCH_CACHE.pop(k, None)
    return merged


@router.delete("/images/{image_id}")
def delete_image(image_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT i.id, e.user_id FROM exercise_images i
            JOIN exercises e ON e.id = i.exercise_id WHERE i.id = ?
        """, (image_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Image not found")
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Forbidden")
        cur.execute("DELETE FROM exercise_images WHERE id = ?", (image_id,))
    return {"ok": True}

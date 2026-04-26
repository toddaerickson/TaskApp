import asyncio
import hashlib
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


def _image_hash(url: str) -> str:
    """Stable fingerprint for dedup. Content-level hashing would require
    downloading each URL which is heavy; URL-string hashing catches the
    dominant duplicate case (same image added twice — bulk-paste repeats,
    admin Find-click-save round trips, sweep runs) without the network
    cost. Normalize before hashing so trivial whitespace/casing variants
    in the scheme collapse to the same key."""
    parts = urllib.parse.urlsplit(url.strip())
    normalized = urllib.parse.urlunsplit((
        parts.scheme.lower(),
        parts.netloc.lower(),
        parts.path,
        parts.query,
        "",  # drop URL fragment — doesn't affect the resource
    ))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


@router.get("", response_model=list[ExerciseResponse])
def list_exercises(
    category: str | None = None,
    search: str | None = Query(None, min_length=1),
    # Soft-delete: archived rows live in the table but are filtered out
    # of normal list responses. Opt-in via ?include_archived=true so the
    # library screen can render an "archived" toggle.
    include_archived: bool = False,
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        sql = "SELECT * FROM exercises WHERE (user_id IS NULL OR user_id = ?)"
        params: list = [user_id]
        if not include_archived:
            sql += " AND archived_at IS NULL"
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


_EXERCISE_UPDATE_COLUMNS = {
    "name", "category", "primary_muscle", "equipment", "difficulty",
    "is_bodyweight", "measurement", "instructions", "cue", "contraindications",
}


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
        # Allow-list the columns so the dynamic UPDATE never interpolates
        # a column name that wasn't hand-approved here.
        fields = {
            k: v for k, v in req.model_dump(exclude_unset=True).items()
            if k in _EXERCISE_UPDATE_COLUMNS
        }
        if "is_bodyweight" in fields:
            fields["is_bodyweight"] = bool(fields["is_bodyweight"])
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            params = list(fields.values()) + [exercise_id]
            cur.execute(f"UPDATE exercises SET {sets} WHERE id = ?", tuple(params))
        cur.execute("SELECT * FROM exercises WHERE id = ?", (exercise_id,))
        return _hydrate_one(cur, cur.fetchone())


@router.delete("/{exercise_id}")
def delete_exercise(exercise_id: int, user_id: int = Depends(get_current_user_id)):
    """Soft-delete. The row stays in the table so that routines and
    historical sessions that reference it still resolve. List endpoints
    hide archived rows by default; pass `include_archived=true` to see
    them. Un-archive via POST /exercises/{id}/restore.
    Prior behavior (hard delete with 409-on-referenced) is gone — the
    whole point of soft-delete is to make retirement low-friction."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        # Allow archiving globals (user_id IS NULL) OR the caller's own
        # exercises. Matches update_exercise's guard.
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot delete another user's exercise")
        cur.execute(
            "UPDATE exercises SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
            (exercise_id,),
        )
    return {"ok": True}


@router.post("/{exercise_id}/restore", response_model=ExerciseResponse)
def restore_exercise(exercise_id: int, user_id: int = Depends(get_current_user_id)):
    """Un-archive a soft-deleted exercise. Idempotent: restoring a row
    that was never archived is a no-op and returns the row unchanged."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot restore another user's exercise")
        cur.execute(
            "UPDATE exercises SET archived_at = NULL WHERE id = ?",
            (exercise_id,),
        )
        cur.execute("SELECT * FROM exercises WHERE id = ?", (exercise_id,))
        return _hydrate_one(cur, cur.fetchone())


@router.post("/{exercise_id}/images", response_model=ExerciseImageResponse)
def add_image(
    exercise_id: int,
    req: ExerciseImageCreate,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
):
    """Attach an image URL to an exercise. Idempotent: if the same URL is
    already attached (by content_hash) the existing row is returned, no
    duplicate stored. Keeps the library clean when an admin pastes the
    same URL twice or Find → Save lands on an image already seen."""
    h = _image_hash(req.url)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id, name FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot add image to another user's exercise")
        default_alt = f"{row['name']} demonstration"
        # Dedup: same (exercise, content_hash) means the same image. Return
        # the existing row instead of inserting. 200 with the stored data
        # is idempotent — callers can't tell the difference from a fresh
        # insert, which is the point.
        cur.execute(
            "SELECT id, url, caption, sort_order, alt_text FROM exercise_images "
            "WHERE exercise_id = ? AND content_hash = ?",
            (exercise_id, h),
        )
        existing = cur.fetchone()
        if existing:
            if not existing.get("alt_text"):
                existing["alt_text"] = default_alt
            return existing
        cur.execute(
            "INSERT INTO exercise_images (exercise_id, url, caption, sort_order, content_hash, alt_text) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (exercise_id, req.url, req.caption, req.sort_order or 0, h, req.alt_text),
        )
        img_id = cur.lastrowid
        cur.execute("SELECT id, url, caption, sort_order, alt_text FROM exercise_images WHERE id = ?", (img_id,))
        result = cur.fetchone()
        if not result.get("alt_text"):
            result["alt_text"] = default_alt
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
            # Dedup within the batch AND against existing rows for this
            # exercise. Same hash twice = same image; don't double-insert.
            cur.execute(
                "SELECT content_hash FROM exercise_images "
                "WHERE exercise_id = ? AND content_hash IS NOT NULL",
                (ex_id,),
            )
            seen_hashes = {r["content_hash"] for r in cur.fetchall()}
            added = 0
            for i, url in enumerate(entry.urls):
                url = url.strip()
                if not url:
                    continue
                h = _image_hash(url)
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)
                cur.execute(
                    "INSERT INTO exercise_images (exercise_id, url, sort_order, content_hash) "
                    "VALUES (?, ?, ?, ?)",
                    (ex_id, url, start + i, h),
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

# Per-provider negative cache. When a provider fails (network, 5xx, missing
# key), we remember for a short window so repeated "Find" clicks don't
# hammer the failing API. Key: (provider_name, query_lower, n).
_NEG_CACHE: dict[tuple[str, str, int], float] = {}
_NEG_TTL_SEC = 60


def _neg_key(provider: str, query: str, n: int) -> tuple[str, str, int]:
    return (provider, query.lower(), n)


def _neg_skip(provider: str, query: str, n: int) -> bool:
    k = _neg_key(provider, query, n)
    ts = _NEG_CACHE.get(k)
    if ts is None:
        return False
    if time.time() - ts > _NEG_TTL_SEC:
        _NEG_CACHE.pop(k, None)
        return False
    return True


def _neg_mark(provider: str, query: str, n: int) -> None:
    _NEG_CACHE[_neg_key(provider, query, n)] = time.time()


def _run_provider(
    provider: str,
    fn: "callable",
    query: str,
    n: int,
) -> list[ImageCandidate]:
    """Wrap a provider call with the negative cache. Returns [] when the
    provider is in cooldown, when it raises, or when it returns nothing —
    in the latter two cases marks it failed so the next call skips."""
    if _neg_skip(provider, query, n):
        log.debug("Skipping %s for %r — recent failure", provider, query)
        return []
    try:
        out = fn(query, n)
    except Exception as e:
        log.warning("%s search raised for %r: %s", provider, query, e)
        _neg_mark(provider, query, n)
        return []
    if not out:
        # Empty result isn't necessarily a failure (could be a real zero-
        # hit query), but repeating on the same query doesn't help either.
        # Short TTL means we'll try again soon if the source recovers.
        _neg_mark(provider, query, n)
    return out


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


def _search_wikimedia(query: str, n: int) -> list[ImageCandidate]:
    """Commons Images search — no API key, no rate limit, public-domain or
    free-license images. A good third fallback when Pixabay/DDG miss."""
    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": 6,  # File: namespace
        "gsrlimit": max(3, min(n * 2, 20)),  # over-fetch; many hits lack URLs
        "prop": "imageinfo",
        "iiprop": "url|size",
        "iiurlwidth": 300,
        "format": "json",
    }
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    # Commons requires a User-Agent; default urllib string gets blocked.
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "TaskApp/1.0 (+contact: self-hosted)"},
    )
    with urllib.request.urlopen(req, timeout=6) as r:
        data = _json.loads(r.read().decode())
    pages = (data.get("query") or {}).get("pages") or {}
    out: list[ImageCandidate] = []
    for page in pages.values():
        ii = (page.get("imageinfo") or [{}])[0]
        u = ii.get("url")
        if not u:
            continue
        out.append(ImageCandidate(
            url=u,
            thumb=ii.get("thumburl"),
            source="commons.wikimedia.org",
            width=_coerce_int(ii.get("width")),
            height=_coerce_int(ii.get("height")),
        ))
        if len(out) >= n:
            break
    return out


def _merge_candidates(groups: list[list[ImageCandidate]], n: int) -> list[ImageCandidate]:
    """Round-robin interleave across provider groups, de-duplicated by url,
    capped at n. Keeps one provider from dominating the picker even if it
    returns many more hits than the others."""
    merged: list[ImageCandidate] = []
    seen: set[str] = set()
    max_len = max((len(g) for g in groups), default=0)
    for i in range(max_len):
        for g in groups:
            if i >= len(g):
                continue
            c = g[i]
            if c.url and c.url not in seen:
                seen.add(c.url)
                merged.append(c)
                if len(merged) >= n:
                    return merged
    return merged[:n]


@router.get("/{exercise_id}/search-images", response_model=list[ImageCandidate])
async def search_images(
    exercise_id: int,
    q: str | None = Query(None, description="Override the search query (defaults to exercise name)"),
    n: int = Query(6, ge=1, le=15),
    user_id: int = Depends(get_current_user_id),
):
    """Return candidate image URLs from free sources (Pixabay, DuckDuckGo,
    Wikimedia Commons). Caller picks one and POSTs to /exercises/{id}/images.
    Pixabay is only called when PIXABAY_KEY env is set; Wikimedia has no key.

    - Providers run concurrently in a thread pool (all do blocking I/O).
    - A provider that failed (raised or returned nothing) in the last 60s
      is skipped — repeated Find clicks don't hammer a down API.
    - Total time is capped at 8s; if a provider misses the deadline its
      results are dropped and whatever arrived is returned.
    - Successful merged results are cached in-process for 5 minutes keyed
      on (query, n).
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

    provider_fns = [
        ("pixabay", _search_pixabay),
        ("ddg", _search_ddg),
        ("wikimedia", _search_wikimedia),
    ]
    tasks = [
        asyncio.to_thread(_run_provider, name, fn, query, n)
        for (name, fn) in provider_fns
    ]
    try:
        groups = await asyncio.wait_for(asyncio.gather(*tasks), timeout=_SEARCH_BUDGET_SEC)
    except asyncio.TimeoutError:
        log.warning("Image search exceeded %.1fs budget for %r", _SEARCH_BUDGET_SEC, query)
        # Whatever finished by cancellation is gone; return empty rather than hang.
        groups = [[] for _ in provider_fns]

    merged = _merge_candidates(groups, n)
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

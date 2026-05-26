import asyncio
import hashlib
import logging
import os
import time
import urllib.parse
import urllib.request
import json as _json
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel

log = logging.getLogger(__name__)
from app import config
from app.database import get_db
from app.auth import get_current_user_id
from app.github_dispatch import dispatch_library_updated
from app.image_download import DownloadError, download_image
from app.rate_limit import limiter
from app.models import (
    ExerciseCreate, ExerciseUpdate, ExerciseResponse,
    ExerciseImageCreate, ExerciseImageResponse,
    BulkImageRequest, BulkImageResult,
)
from app.hydrate import hydrate_exercises_with_images
from app.image_urls import R2_PREFIX, resolve_image_url

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


def _r2_upload(downloaded) -> str:
    """Upload a downloaded image to R2; return the r2: sentinel URL.
    Raises RuntimeError on R2 transport failure. Separated from the
    download step so dedup-by-content-hash can short-circuit the
    upload."""
    r2_filename = f"{downloaded.sha256}{downloaded.extension}"
    from app.r2_storage import R2Storage
    R2Storage().put_object(
        r2_filename, downloaded.bytes_, downloaded.content_type,
    )
    return f"{R2_PREFIX}{r2_filename}"


def _resolve_image_storage(url: str) -> tuple[str, str]:
    """One-shot download+upload for callers that don't need per-step
    control (bulk_images). Returns (store_url, content_hash). Must be
    called OUTSIDE any get_db() block (network I/O).

    R2 PUT is idempotent at the content-hash key, so a duplicate
    upload during a same-batch repeat is wasted RTT but harmless on
    the bucket. Raises DownloadError (422) or RuntimeError (502)."""
    if config.r2_configured():
        downloaded = download_image(url)
        store_url = _r2_upload(downloaded)
        return (store_url, downloaded.sha256)
    return (url, _image_hash(url))


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
             is_bodyweight, measurement, instructions, cue, contraindications, min_age, max_age,
             evidence_tier)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, req.name, req.slug, req.category, req.primary_muscle, req.equipment,
             req.difficulty, bool(req.is_bodyweight), req.measurement, req.instructions,
             req.cue, req.contraindications, req.min_age, req.max_age,
             req.evidence_tier),
        )
        ex_id = cur.lastrowid
        cur.execute("SELECT * FROM exercises WHERE id = ?", (ex_id,))
        return _hydrate_one(cur, cur.fetchone())


_EXERCISE_UPDATE_COLUMNS = {
    "name", "category", "primary_muscle", "equipment", "difficulty",
    "is_bodyweight", "measurement", "instructions", "cue", "contraindications",
    "evidence_tier",
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


@router.delete("/{exercise_id}/permanent")
def permanently_delete_exercise(
    exercise_id: int, user_id: int = Depends(get_current_user_id)
):
    """Hard-delete an exercise. Pre-checks for references in
    `routine_exercises` and `session_sets` (both `ON DELETE RESTRICT`)
    and returns 409 with a human-readable count instead of a raw FK
    violation. `exercise_images` rows cascade out automatically.

    Complements the soft-delete (`DELETE /exercises/{id}`) — that path
    is for retiring a move you no longer want to see; this one is for
    cleaning up a row you never want resolved again, e.g. an admin typo
    or an outdated duplicate. Per the multi-agent plan review, the
    permanent path is gated by an operator confirmation in the UI; the
    409 here is a backstop for sloppy clients.

    R2-stored image bytes (rows with `r2:<filename>` URLs) are best-
    effort unlinked from the bucket after the row is deleted from PG.
    A failed R2 delete logs a warning but doesn't block the response —
    the row is already gone in the DB and an orphan object in R2 is
    a much smaller problem than the API call failing after deletion.
    """
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot delete another user's exercise")
        # Pre-flight reference check. Same dialect (SQLite + PG both
        # support COUNT) so no branching needed. We surface specific
        # counts in the detail so the client can render "Used in 3
        # routines and 12 sessions — remove there first" rather than a
        # generic 409.
        cur.execute(
            "SELECT COUNT(*) AS c FROM routine_exercises WHERE exercise_id = ?",
            (exercise_id,),
        )
        routine_count = cur.fetchone()["c"]
        cur.execute(
            "SELECT COUNT(*) AS c FROM session_sets WHERE exercise_id = ?",
            (exercise_id,),
        )
        set_count = cur.fetchone()["c"]
        if routine_count or set_count:
            bits: list[str] = []
            if routine_count:
                bits.append(f"{routine_count} routine{'s' if routine_count != 1 else ''}")
            if set_count:
                bits.append(f"{set_count} logged set{'s' if set_count != 1 else ''}")
            raise HTTPException(
                409,
                f"Used in {' and '.join(bits)}. Remove those references first.",
            )
        # Capture R2-prefixed image filenames BEFORE the cascade deletes
        # the rows (we need the keys to unlink from the bucket).
        cur.execute(
            "SELECT url FROM exercise_images WHERE exercise_id = ?",
            (exercise_id,),
        )
        r2_filenames = [
            r["url"][len(R2_PREFIX):]
            for r in cur.fetchall()
            if r["url"].startswith(R2_PREFIX)
        ]
        # Images cascade out via FK ON DELETE CASCADE.
        cur.execute("DELETE FROM exercises WHERE id = ?", (exercise_id,))

    # Best-effort R2 cleanup — outside the DB transaction so a network
    # blip doesn't roll back the local commit. Volume grows by one
    # orphaned object on failure; a future cleanup script can sweep.
    if r2_filenames and config.r2_configured():
        try:
            from app.r2_storage import R2Storage
            r2 = R2Storage()
            for filename in r2_filenames:
                try:
                    r2.delete_object(filename)
                except Exception as e:
                    log.warning("R2 unlink failed for %s: %s", filename, e)
        except Exception as e:
            log.warning("R2 client init failed during permanent-delete: %s", e)
    return {"ok": True}


@router.post("/{exercise_id}/images", response_model=ExerciseImageResponse)
def add_image(
    exercise_id: int,
    req: ExerciseImageCreate,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
):
    """Attach an image to an exercise.

    Two paths, gated by `config.r2_configured()`:

    - **R2 configured (PR-A2b):** server-side download from `req.url`
      (SSRF-safe via `image_download.download_image`), upload bytes
      to the R2 bucket keyed by sha256 content hash, store
      `r2:<sha256>.<ext>` in the DB. Bytes never depend on the
      original URL again — the row resolves through the bucket's
      public URL.

    - **R2 NOT configured (default / dev):** preserve the legacy
      behavior — store `req.url` as-is in the DB. Resolver passes
      `https:` URLs through; clients fetch the bytes from the
      original host. Same byte-rot risk that's been there.

    Idempotent in both modes: a second POST with the same image (same
    content hash for R2 mode, same URL hash for legacy mode) returns
    the existing row.
    """
    # Pre-flight ownership check in a brief DB block — 403/404 before
    # any expensive network I/O, then close the conn so it's released
    # during the slow download / upload that follows. The previous
    # shape held a Neon connection across `download_image` (up to 10s)
    # + R2 `put_object`, which under N concurrent admin saves would
    # pin every Neon connection slot Fly's pool will issue. Silent-
    # killer audit finding S2.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id, name FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot add image to another user's exercise")
        default_alt = f"{row['name']} demonstration"

    # Compute content_hash + (in R2 mode) buffer the downloaded bytes.
    # Done OUTSIDE the DB block. In legacy mode this is cheap — just
    # hash the URL string.
    downloaded = None
    if config.r2_configured():
        try:
            downloaded = download_image(req.url)
        except DownloadError as e:
            raise HTTPException(422, f"Could not import image: {e}") from e
        content_hash = downloaded.sha256
    else:
        content_hash = _image_hash(req.url)

    # Dedup check in a brief DB block. If found, return existing without
    # touching R2. Preserves the "second POST of the same image is free"
    # contract that the existing dedup test asserts.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, url, caption, sort_order, alt_text FROM exercise_images "
            "WHERE exercise_id = ? AND content_hash = ?",
            (exercise_id, content_hash),
        )
        existing = cur.fetchone()
        if existing:
            if not existing.get("alt_text"):
                existing["alt_text"] = default_alt
            existing["url"] = resolve_image_url(existing["url"])
            return existing

    # Not a dup → upload to R2 (still outside the DB block). Failures
    # surface as 502 because the bytes aren't durable; we must NOT
    # insert a row claiming they are.
    if downloaded is not None:
        try:
            store_url = _r2_upload(downloaded)
        except RuntimeError as e:
            raise HTTPException(502, f"R2 upload failed: {e}") from e
    else:
        store_url = req.url

    # Final brief DB block — insert + re-fetch for the response.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO exercise_images (exercise_id, url, caption, sort_order, content_hash, alt_text) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (exercise_id, store_url, req.caption, req.sort_order or 0, content_hash, req.alt_text),
        )
        img_id = cur.lastrowid
        cur.execute("SELECT id, url, caption, sort_order, alt_text FROM exercise_images WHERE id = ?", (img_id,))
        result = cur.fetchone()
        if not result.get("alt_text"):
            result["alt_text"] = default_alt
        result["url"] = resolve_image_url(result["url"])
    # Tell GitHub the library changed; workflow debounces via concurrency group.
    background_tasks.add_task(dispatch_library_updated)
    return result


@router.post("/images/bulk", response_model=list[BulkImageResult])
def bulk_images(
    req: BulkImageRequest,
    background_tasks: BackgroundTasks,
    user_id: int = Depends(get_current_user_id),
):
    """Admin: paste rows mapping slug -> [urls]. Appends by default;
    replace=true clears existing first.

    R2-aware (PR-Y1, finding S1): when the deploy has R2 configured,
    each URL is server-side-downloaded and uploaded to the bucket,
    same as the single-image `add_image` route. Previously this route
    skipped that path and inserted raw upstream URLs even in R2 mode,
    silently undermining the byte-rot fix that R2 was meant to deliver.
    URLs that fail download/upload (SSRF-blocked, non-image, oversized,
    R2 transport error) are skipped and counted into `failed` so the
    admin sees per-entry success without a 4xx aborting the whole batch.
    """
    results: list[BulkImageResult] = []

    # Phase 1: brief DB scan for slug → exercise_id resolution. Closed
    # before any network work so we don't hold Neon during downloads.
    slug_to_ex: dict[str, int] = {}
    with get_db() as conn:
        cur = conn.cursor()
        for entry in req.entries:
            cur.execute(
                "SELECT id FROM exercises WHERE slug = ? AND (user_id IS NULL OR user_id = ?)",
                (entry.slug, user_id),
            )
            row = cur.fetchone()
            if row:
                slug_to_ex[entry.slug] = row["id"]

    # Phase 2: outside the DB, resolve each URL (download + R2 upload
    # in R2 mode, or pass-through hash in legacy mode). One failure
    # doesn't kill the entry — the URL is dropped and counted.
    resolved: dict[str, list[tuple[str, str]]] = {}  # slug → [(store_url, hash), ...]
    failed: dict[str, int] = {}
    for entry in req.entries:
        if entry.slug not in slug_to_ex:
            continue
        per_entry: list[tuple[str, str]] = []
        fail_count = 0
        seen_in_batch: set[str] = set()
        for url in entry.urls:
            url = url.strip()
            if not url or url in seen_in_batch:
                continue
            seen_in_batch.add(url)
            try:
                store_url, h = _resolve_image_storage(url)
            except (DownloadError, RuntimeError) as e:
                log.warning("bulk_images: skipping %s for %s: %s", url, entry.slug, e)
                fail_count += 1
                continue
            per_entry.append((store_url, h))
        resolved[entry.slug] = per_entry
        failed[entry.slug] = fail_count

    # Phase 3: short DB block for the actual writes.
    with get_db() as conn:
        cur = conn.cursor()
        for entry in req.entries:
            if entry.slug not in slug_to_ex:
                results.append(BulkImageResult(slug=entry.slug, status="not_found"))
                continue
            ex_id = slug_to_ex[entry.slug]
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
            # Dedup against existing rows for this exercise (within-batch
            # dedup already handled by seen_in_batch above).
            cur.execute(
                "SELECT content_hash FROM exercise_images "
                "WHERE exercise_id = ? AND content_hash IS NOT NULL",
                (ex_id,),
            )
            seen_hashes = {r["content_hash"] for r in cur.fetchall()}
            added = 0
            for i, (store_url, h) in enumerate(resolved.get(entry.slug, [])):
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)
                cur.execute(
                    "INSERT INTO exercise_images (exercise_id, url, sort_order, content_hash) "
                    "VALUES (?, ?, ?, ?)",
                    (ex_id, store_url, start + i, h),
                )
                added += 1
            results.append(BulkImageResult(
                slug=entry.slug, status="ok",
                added=added, replaced=replaced, failed=failed.get(entry.slug, 0),
            ))
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
@limiter.limit("30/minute")
async def search_images(
    request: Request,
    exercise_id: int,
    q: str | None = Query(None, description="Override the search query (defaults to exercise name)"),
    n: int = Query(6, ge=1, le=15),
    user_id: int = Depends(get_current_user_id),
):
    # 30/min cap is generous for legitimate operator browsing (1 search every
    # 2s) but cuts a leaked-token bot off before it gets the upstream
    # providers (Pixabay/DDG/Wikimedia) to ban our Fly egress IP. Wraps
    # `request: Request` so slowapi can extract the client IP for the bucket.
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

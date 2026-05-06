"""URL resolver for exercise images.

Three storage paths coexist:

  1. Remote — `https://...` URLs the admin pasted via Find / bulk-paste.
     Pass through unchanged. The byte rot risk is exactly why we're
     migrating off these (PR-A2c backfills them to R2).

  2. Self-hosted local — rows whose `url` column is the sentinel
     `local:<filename>` (e.g. `local:abc123def456.jpg`). The bytes
     live at `IMAGE_STORAGE_DIR/<filename>` (default
     `backend/seed_data/exercise_images/`) and are served by the
     StaticFiles mount in `main.py`.

  3. R2 — rows whose `url` column is the sentinel `r2:<filename>`.
     The bytes live in the configured R2 bucket and serve via the
     bucket's public URL (`R2_PUBLIC_URL`). New admin uploads land
     here when `config.r2_configured()` is True (PR-A2b).

The resolver runs at API-response time (in `hydrate_exercises_with_images`
and the `add_image` route) so the DB row stays compact and the public
URL stays computable even if the deploy target hostname changes.
"""
from app import config

LOCAL_PREFIX = "local:"
R2_PREFIX = "r2:"
STATIC_PATH = "/static/exercise-images"


def _is_safe_filename(filename: str) -> bool:
    """Reject filenames that could escape the serving directory or
    point at a different bucket prefix. Single check shared between
    `local:` and `r2:` resolvers."""
    return bool(filename) and "/" not in filename and "\\" not in filename and ".." not in filename


def resolve_image_url(url: str) -> str:
    """Expand a sentinel URL → public URL. Pass through everything else.

    `r2:<filename>` → `${R2_PUBLIC_URL}/<filename>` when R2 is
    configured. When R2 is NOT configured (dev / unconfigured prod)
    the row is unresolvable and we return the empty string — the
    client renders the broken-image fallback rather than an
    accidentally-relative path.

    `local:<filename>` → `${BACKEND_PUBLIC_URL}/static/exercise-images/<filename>`.
    Falsy `BACKEND_PUBLIC_URL` returns a relative path (test client
    only — RN native rejects relative URIs in production).

    Path-traversal hardening: filenames containing `/`, `\\`, or `..`
    return empty string. The StaticFiles mount has its own subclass
    guard but a malformed sentinel that survives that gate could still
    produce surprising URLs.

    `config.*` values are read on each call (not closed over at import
    time) so tests can `monkeypatch.setattr(config, ...)` without
    re-importing this module.
    """
    if not url:
        return url
    if url.startswith(R2_PREFIX):
        filename = url[len(R2_PREFIX):]
        if not _is_safe_filename(filename):
            return ""
        if not config.R2_PUBLIC_URL:
            # Row references R2 but the deploy isn't configured for it.
            # Returning empty surfaces as a broken image (visible) rather
            # than silently routing to a relative path that 404s.
            return ""
        return f"{config.R2_PUBLIC_URL}/{filename}"
    if url.startswith(LOCAL_PREFIX):
        filename = url[len(LOCAL_PREFIX):]
        if not _is_safe_filename(filename):
            return ""
        return f"{config.BACKEND_PUBLIC_URL}{STATIC_PATH}/{filename}"
    return url

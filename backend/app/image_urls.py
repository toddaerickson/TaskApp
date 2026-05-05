"""URL resolver for exercise images.

Two storage paths coexist:

  1. Remote — `https://...` URLs the admin pasted via Find / bulk-paste.
     Pass through unchanged. The byte rot risk is exactly why we're
     migrating off these (PRs 3-5 in this sequence).

  2. Self-hosted — rows whose `url` column is the sentinel
     `local:<filename>` (e.g. `local:abc123def456.jpg`). The bytes live
     at `backend/seed_data/exercise_images/<filename>` and are served by
     the StaticFiles mount in `main.py`.

The resolver runs at API-response time (in `hydrate_exercises_with_images`
and the `add_image` route) so the DB row stays compact and the public
URL stays computable even if the deploy target hostname changes — flip
`BACKEND_PUBLIC_URL` and every existing row's URL recomputes on the
next GET.
"""
from app import config

LOCAL_PREFIX = "local:"
STATIC_PATH = "/static/exercise-images"


def resolve_image_url(url: str) -> str:
    """Expand `local:<filename>` → public URL. Pass through everything else.

    When `BACKEND_PUBLIC_URL` is empty the returned URL is the *relative*
    path `/static/exercise-images/<filename>`. That's only useful in the
    test client (which serves the same origin) — production must set
    `BACKEND_PUBLIC_URL` because RN's native `<Image>` requires a
    fully-qualified URI.

    `config.BACKEND_PUBLIC_URL` is read on each call (not closed over at
    import time) so a test can `monkeypatch.setattr(config,
    'BACKEND_PUBLIC_URL', '...')` without re-importing this module.

    Path-traversal hardening: filenames containing `/`, `\\`, or `..`
    return empty string. The StaticFiles mount has its own subclass
    guard (`_NoDotfilesStaticFiles`) but a malformed sentinel that
    survives that gate could still produce surprising URLs (e.g. a
    `local:../etc/passwd` rendering as a path the browser would
    request). Single-user self-hosted = the only way bad sentinels
    enter the DB is operator typo or a corrupted backfill, but the
    cost of validation is one substring check.
    """
    if not url or not url.startswith(LOCAL_PREFIX):
        return url
    filename = url[len(LOCAL_PREFIX):]
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return ""
    return f"{config.BACKEND_PUBLIC_URL}{STATIC_PATH}/{filename}"

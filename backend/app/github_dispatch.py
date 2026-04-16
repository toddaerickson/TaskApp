"""
Fire a GitHub `repository_dispatch` event so a Workflow can pick up the
latest exercise-library snapshot and commit it to the repo. Called from
the image-save hot path in a `BackgroundTask` — failures are logged but
never propagate to the HTTP response.

Config (all via env):
  GITHUB_DISPATCH_TOKEN — fine-grained PAT with `contents:write` on the target repo
  GITHUB_DISPATCH_REPO  — "owner/repo" (default "toddaerickson/TaskApp")
  GITHUB_DISPATCH_EVENT — event_type string (default "library-updated")

If GITHUB_DISPATCH_TOKEN is unset, the function is a no-op — so dev and
CI don't need the secret.
"""
import logging
import os

import httpx

log = logging.getLogger(__name__)

_API_BASE = "https://api.github.com"


def dispatch_library_updated() -> None:
    """Fire-and-forget POST to GitHub. Safe to call from a sync route via
    FastAPI's BackgroundTasks — httpx makes a single sync HTTP call with a
    short timeout, then we log and return. Never raises."""
    token = os.environ.get("GITHUB_DISPATCH_TOKEN", "").strip()
    if not token:
        # Expected in dev / CI — skip silently at DEBUG.
        log.debug("GITHUB_DISPATCH_TOKEN not set; skipping library-updated dispatch")
        return

    repo = os.environ.get("GITHUB_DISPATCH_REPO", "toddaerickson/TaskApp").strip()
    event = os.environ.get("GITHUB_DISPATCH_EVENT", "library-updated").strip()
    url = f"{_API_BASE}/repos/{repo}/dispatches"

    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "taskapp-backend/1",
                },
                json={"event_type": event},
            )
        if r.status_code >= 400:
            # 422 = unknown repo / event. 401/403 = token scope issue.
            log.warning(
                "GitHub dispatch failed: %s %s — %s",
                r.status_code, r.reason_phrase, r.text[:300],
            )
        else:
            log.info("Dispatched '%s' to %s (status %s)", event, repo, r.status_code)
    except Exception:
        log.exception("GitHub dispatch raised")

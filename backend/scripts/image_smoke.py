"""
CLI: HEAD-check a sample of self-hosted image URLs from a running
backend, alert if any persistently fail (PR-A2c CI workflow #1).

Usage (script invoked from .github/workflows/image-smoke.yml):
    python backend/scripts/image_smoke.py \
        --backend https://taskapp-workout.fly.dev \
        --token "$SNAPSHOT_AUTH_TOKEN" \
        --sample-size 20

Operator can run locally to debug a CI alert by exporting the same
env vars.

Retry policy: each URL is HEAD-checked up to 3 times with 30s of
backoff between attempts (matches the backup-pipeline issue-thread
dedup pattern). A URL is only marked failed when ALL retries fail —
the workflow then opens / comments on the alert issue.

Exit code: 0 if every sampled URL returns 2xx within retry budget;
1 if any URL persistently fails. Prints a per-URL outcome line so
the operator can scan the run log.
"""
from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request


def fetch_sample(backend: str, token: str, n: int) -> list[str]:
    """Hit /admin/sample-image-urls on the backend, return the URL
    list. Raises on non-200 — caller treats that as workflow failure
    (the backend is the source of truth for what to smoke)."""
    req = urllib.request.Request(
        f"{backend.rstrip('/')}/admin/sample-image-urls?n={n}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise RuntimeError(f"sample-image-urls returned {resp.status}")
        import json
        body = json.loads(resp.read().decode())
    urls = body.get("urls", [])
    if not isinstance(urls, list):
        raise RuntimeError(f"unexpected sample-image-urls payload: {body!r}")
    return urls


def head_with_retry(url: str, *, attempts: int = 3, backoff: float = 30.0,
                    timeout: float = 20.0) -> tuple[bool, str]:
    """HEAD `url`, retrying transient failures. Returns (ok, detail).
    detail is empty string on ok, last error text on failure."""
    last_err = ""
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if 200 <= resp.status < 300:
                    return True, ""
                last_err = f"HTTP {resp.status}"
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
        except urllib.error.URLError as e:
            last_err = f"URL error: {e.reason}"
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {e}"
        if i < attempts - 1:
            time.sleep(backoff)
    return False, last_err


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--backend", required=True,
                   help="Backend URL, e.g. https://taskapp-workout.fly.dev")
    p.add_argument("--token", required=True,
                   help="SNAPSHOT_AUTH_TOKEN value (Bearer auth on /admin/sample-image-urls)")
    p.add_argument("--sample-size", type=int, default=20,
                   help="How many URLs to sample. Default 20.")
    p.add_argument("--attempts", type=int, default=3,
                   help="Retry attempts per URL. Default 3.")
    p.add_argument("--backoff", type=float, default=30.0,
                   help="Seconds between retries. Default 30.")
    args = p.parse_args()

    print(f"Fetching sample of up to {args.sample_size} URLs from {args.backend}…")
    try:
        urls = fetch_sample(args.backend, args.token, args.sample_size)
    except Exception as e:  # noqa: BLE001
        print(f"::error::Could not fetch sample from backend: {e}", file=sys.stderr)
        return 1

    if not urls:
        # Empty sample means no images exist yet. Don't alarm; fresh
        # deploys / pre-backfill state is OK.
        print("Sample empty (no images in DB yet). Treating as success.")
        return 0

    print(f"Checking {len(urls)} URLs (up to {args.attempts} attempts each)…")
    failed: list[tuple[str, str]] = []
    for url in urls:
        ok, detail = head_with_retry(
            url, attempts=args.attempts, backoff=args.backoff,
        )
        if ok:
            print(f"  ok    {url}")
        else:
            print(f"  FAIL  {url} — {detail}", file=sys.stderr)
            failed.append((url, detail))

    if failed:
        print(
            f"\n::error::{len(failed)}/{len(urls)} URLs failed after "
            f"{args.attempts} attempts each. See per-URL log above.",
            file=sys.stderr,
        )
        return 1
    print(f"\nAll {len(urls)} sampled URLs OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

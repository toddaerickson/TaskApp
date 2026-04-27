"""
CLI: backfill exercise images by downloading remote URLs into the
`backend/seed_data/exercise_images/` directory and rewriting the rows'
`url` column to the `local:<bytes_hash>.<ext>` sentinel.

After this runs successfully, every backfilled row's image renders out
of FastAPI's `/static/exercise-images` mount instead of whatever CDN
happened to host it last week. Operator runs the script LOCALLY (in a
git work tree), then `git add seed_data/exercise_images && git commit
&& deploy` so the bytes ship with the next image.

Usage:
    venv/bin/python scripts/backfill_exercise_images.py             # dry-run
    venv/bin/python scripts/backfill_exercise_images.py --apply     # actually mutate
    venv/bin/python scripts/backfill_exercise_images.py --apply --max 5

Refuses `--apply` unless the resolved `--image-dir` lives inside a git
work tree (heuristic: a `.git` directory exists at or above it). This
keeps an `fly ssh console && python scripts/backfill_exercise_images.py
--apply` from silently bricking every image — Fly's container FS is
ephemeral, the bytes vanish on next deploy, and the DB rewrite (Neon,
persistent) leaves every URL pointing at nothing. Use `--no-git-check`
for unusual setups.

The script is idempotent: rerunning re-downloads only the URLs not yet
self-hosted, and a duplicate (exercise, content_hash) wouldn't be created
by the loop because it only ever updates the `url` column on existing
rows — never INSERTs.

Pipe through `tee` to capture the per-row log if you want a record of
which URLs went where.
"""
import argparse
import hashlib
import ipaddress
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

# Allow running as `python scripts/backfill_exercise_images.py` from backend/.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import get_db  # noqa: E402
from app.image_urls import LOCAL_PREFIX  # noqa: E402


# Conservative cap. The biggest exercise demo we've seen is ~600 KB; 5 MB
# leaves headroom for an animated GIF and still bounds a misbehaving
# server (or a redirect-chain to something huge) without hanging the
# operator's terminal.
MAX_BYTES_DEFAULT = 5 * 1024 * 1024
TIMEOUT_DEFAULT = 10  # seconds

# Allowed image MIME types → file extension.
_CONTENT_TYPE_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

# URL-path-extension fallback when the server omits or lies about
# Content-Type (some CDN fronts strip it for cached responses).
_URL_EXT_ALLOWED = {"jpg", "jpeg", "png", "webp", "gif"}


@dataclass
class RowOutcome:
    image_id: int
    url: str
    status: str  # "ok" | "skip" | "fail"
    detail: str
    new_url: str | None = None
    bytes_written: int = 0


# ---------- helpers ----------

def is_inside_git_work_tree(path: Path) -> bool:
    """True if `path` (or any ancestor) contains a `.git` entry. Cheap
    sanity check that we're not running on an ephemeral container FS."""
    p = path.resolve()
    for candidate in (p, *p.parents):
        if (candidate / ".git").exists():
            return True
    return False


def is_safe_remote_host(host: str) -> bool:
    """Reject hosts that resolve to private / loopback / link-local /
    cloud-metadata addresses. Operator-curated DB content is *mostly*
    safe but the script is invoked offline against a DB that any
    authenticated user can write to via `add_image`. SSRF here would
    leak the operator's local network or land hostile bytes on disk
    (which PR 4 will then commit). Public IPs only."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # Unresolvable → let urlopen fail naturally with a URLError.
        return True
    for fam, _, _, _, sockaddr in infos:
        ip_str = sockaddr[0]
        # Drop IPv6 zone identifier if present.
        if "%" in ip_str:
            ip_str = ip_str.split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False
    return True


def extract_extension(content_type: str | None, url: str) -> str | None:
    """Pick a canonical lowercase extension (no leading dot) for a stored
    image. Prefer the server's Content-Type; fall back to the URL path
    extension. Returns None if neither path produces a supported type
    so the caller can skip rather than write `.unknown` files."""
    if content_type:
        ct = content_type.split(";", 1)[0].strip().lower()
        if ct in _CONTENT_TYPE_EXT:
            return _CONTENT_TYPE_EXT[ct]
    path = urllib.parse.urlsplit(url).path
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if ext in _URL_EXT_ALLOWED:
        return "jpeg" if ext == "jpeg" else ext
    return None


def download_image(
    url: str,
    *,
    max_bytes: int = MAX_BYTES_DEFAULT,
    timeout: float = TIMEOUT_DEFAULT,
) -> tuple[bytes, str | None]:
    """Fetch up to `max_bytes` from `url`. Loops `read()` until EOF or
    cap so chunked-encoded responses can't silently truncate — `read(n)`
    is documented as "up to n", and a chunk boundary inside that window
    can return short. A truncated body would still hash deterministically
    and end up on disk under a plausible name; the loop closes that.

    Raises urllib.error.URLError / HTTPError on transport failures,
    ValueError when the body exceeds `max_bytes`. Sets a real User-Agent
    because Wikimedia (and a few others) refuse the default urllib UA.
    Returns (body, content_type)."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "TaskApp-image-backfill/1.0 (https://github.com/toddaerickson/TaskApp)",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — operator-invoked
        content_type = resp.headers.get("Content-Type")
        buf = bytearray()
        cap = max_bytes + 1  # read one extra byte so we can detect overflow
        while len(buf) < cap:
            chunk = resp.read(cap - len(buf))
            if not chunk:
                break
            buf.extend(chunk)
    if len(buf) > max_bytes:
        raise ValueError(f"response exceeds max_bytes={max_bytes}")
    return bytes(buf), content_type


def compute_filename(body: bytes, ext: str) -> str:
    """Content-addressed filename. Two URLs serving identical bytes
    collapse to the same on-disk file, which is the dedup we wanted from
    URL-hashing in PR 1 but didn't actually get because admins paste the
    same image at different URLs all the time."""
    h = hashlib.sha256(body).hexdigest()
    return f"{h}.{ext}"


# ---------- per-row + loop ----------

def backfill_one(
    cur,
    row: dict,
    image_dir: Path,
    *,
    dry_run: bool,
    max_bytes: int,
    timeout: float,
    allow_private_hosts: bool = False,
) -> RowOutcome:
    """Process one image row. Skips already-self-hosted rows + unsupported
    content types + private/loopback hosts. Writes bytes to disk + UPDATEs
    the `url` column when not dry-run."""
    url = row["url"] or ""
    image_id = row["id"]
    if url.startswith(LOCAL_PREFIX):
        return RowOutcome(image_id, url, "skip", "already self-hosted")
    if not (url.startswith("http://") or url.startswith("https://")):
        return RowOutcome(image_id, url, "skip", "not an http(s) URL")

    if not allow_private_hosts:
        host = urllib.parse.urlsplit(url).hostname or ""
        if not is_safe_remote_host(host):
            return RowOutcome(
                image_id, url, "skip",
                f"host {host!r} resolves to a non-public address (SSRF guard)",
            )

    try:
        body, content_type = download_image(url, max_bytes=max_bytes, timeout=timeout)
    except urllib.error.HTTPError as e:
        return RowOutcome(image_id, url, "fail", f"HTTP {e.code}")
    except urllib.error.URLError as e:
        return RowOutcome(image_id, url, "fail", f"URL error: {e.reason}")
    except (TimeoutError, ValueError) as e:
        return RowOutcome(image_id, url, "fail", str(e))
    except Exception as e:  # noqa: BLE001 — operator-invoked, surface anything
        return RowOutcome(image_id, url, "fail", f"{type(e).__name__}: {e}")

    ext = extract_extension(content_type, url)
    if not ext:
        return RowOutcome(image_id, url, "fail", f"unsupported content-type: {content_type!r}")

    filename = compute_filename(body, ext)
    new_url = f"{LOCAL_PREFIX}{filename}"
    target = image_dir / filename

    if dry_run:
        return RowOutcome(image_id, url, "ok", "dry-run", new_url=new_url, bytes_written=len(body))

    # Don't rewrite an existing file with the same name (same bytes →
    # same hash → identical content). Saves a write + makes reruns cheap.
    if not target.exists():
        target.write_bytes(body)

    cur.execute("UPDATE exercise_images SET url = ? WHERE id = ?", (new_url, image_id))
    return RowOutcome(image_id, url, "ok", "downloaded", new_url=new_url, bytes_written=len(body))


def backfill_all(
    cur,
    image_dir: Path,
    *,
    dry_run: bool,
    max_rows: int | None,
    max_bytes: int,
    timeout: float,
    allow_private_hosts: bool = False,
    conn=None,
) -> list[RowOutcome]:
    """Iterate every exercise_images row and call backfill_one. Bounded
    by `max_rows` for safety so a misconfigured run stops early instead
    of hammering the network.

    Commits per row when `conn` is supplied + not dry-run, so a failure
    on row N preserves rewrites of rows 1..N-1 instead of rolling them
    all back. The on-disk file is content-addressed and idempotent on
    rerun; the DB UPDATE is the side-effect we don't want to lose."""
    cur.execute("SELECT id, url FROM exercise_images ORDER BY id ASC")
    rows = cur.fetchall()
    out: list[RowOutcome] = []
    for row in rows:
        if max_rows is not None and len(out) >= max_rows:
            break
        outcome = backfill_one(
            cur, row, image_dir,
            dry_run=dry_run, max_bytes=max_bytes, timeout=timeout,
            allow_private_hosts=allow_private_hosts,
        )
        out.append(outcome)
        if conn is not None and not dry_run and outcome.status == "ok":
            conn.commit()
    return out


# ---------- CLI ----------

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true",
                   help="Actually download bytes + UPDATE rows. Default is dry-run.")
    p.add_argument("--max", type=int, default=None, dest="max_rows",
                   help="Cap how many rows to process (per run). Useful for testing.")
    p.add_argument("--max-bytes", type=int, default=MAX_BYTES_DEFAULT,
                   help=f"Reject any single image larger than this (bytes). Default: {MAX_BYTES_DEFAULT}.")
    p.add_argument("--timeout", type=float, default=TIMEOUT_DEFAULT,
                   help=f"Per-request timeout in seconds. Default: {TIMEOUT_DEFAULT}.")
    p.add_argument("--image-dir", default=str(ROOT / "seed_data" / "exercise_images"),
                   help="Directory to write image bytes into.")
    p.add_argument("--no-git-check", action="store_true",
                   help="Skip the 'image-dir must live in a git work tree' guard. "
                        "Only set this if you have your own plan for persisting bytes.")
    p.add_argument("--allow-private-hosts", action="store_true",
                   help="Disable the SSRF guard. Only set when intentionally "
                        "downloading from a trusted internal mirror.")
    args = p.parse_args()

    image_dir = Path(args.image_dir).resolve()
    image_dir.mkdir(parents=True, exist_ok=True)

    if args.apply and not args.no_git_check and not is_inside_git_work_tree(image_dir):
        print(
            f"\nERROR: --apply refused — {image_dir} is not inside a git work\n"
            f"tree. Running this against an ephemeral filesystem (e.g. inside\n"
            f"a Fly machine) downloads bytes that vanish on next deploy while\n"
            f"the DB UPDATE persists, leaving every image broken.\n\n"
            f"Run this on your laptop where the bytes can be `git add`ed\n"
            f"+ committed, OR pass --no-git-check if you know what you're\n"
            f"doing.",
            file=sys.stderr,
        )
        return 2

    if args.apply:
        print(
            f"\nReady to mutate. After this run completes you MUST:\n"
            f"  1. cd {ROOT.parent}\n"
            f"  2. git add backend/seed_data/exercise_images\n"
            f"  3. git commit -m 'chore: backfill self-hosted exercise images'\n"
            f"  4. deploy backend so /static/exercise-images can serve them\n"
        )

    with get_db() as conn:
        cur = conn.cursor()
        outcomes = backfill_all(
            cur, image_dir,
            dry_run=not args.apply,
            max_rows=args.max_rows,
            max_bytes=args.max_bytes,
            timeout=args.timeout,
            allow_private_hosts=args.allow_private_hosts,
            conn=conn,
        )

    ok = sum(1 for o in outcomes if o.status == "ok")
    skipped = sum(1 for o in outcomes if o.status == "skip")
    failed = sum(1 for o in outcomes if o.status == "fail")
    bytes_total = sum(o.bytes_written for o in outcomes)

    for o in outcomes:
        if o.status == "ok":
            print(f"  ok    [{o.image_id:>5}] {o.url} → {o.new_url} ({o.bytes_written} B)")
        elif o.status == "skip":
            print(f"  skip  [{o.image_id:>5}] {o.url} — {o.detail}")
        else:
            print(f"  FAIL  [{o.image_id:>5}] {o.url} — {o.detail}", file=sys.stderr)

    mode = "dry-run" if not args.apply else "applied"
    print(
        f"\n{mode}: {len(outcomes)} processed, {ok} ok, {skipped} skipped, "
        f"{failed} failed, {bytes_total} bytes",
    )
    if not args.apply:
        print("Re-run with --apply to actually download + rewrite URLs.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

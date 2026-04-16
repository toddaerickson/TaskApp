"""
CLI: capture a snapshot of the exercise library (globals + one user's
personal exercises) into `backend/seed_data/exercise_snapshot.json`.

The same payload is available via `GET /admin/snapshot` — this CLI is the
out-of-band path for one-time migrations or cases where the HTTP endpoint
isn't reachable (e.g. the app machine is down but the DB is up).

Usage (local dev):
    venv/bin/python scripts/snapshot_exercises.py \
        --user you@example.com \
        --out seed_data/exercise_snapshot.json

Usage (production, one-time migration):
    fly ssh console -a taskapp-workout
    cd /app && python scripts/snapshot_exercises.py --user you@example.com \
        --out /tmp/snapshot.json

Read-only against the DB. Safe to run any time.
"""
import argparse
import json
import sys
from pathlib import Path

# Allow running as `python scripts/snapshot_exercises.py` from backend/.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import get_db  # noqa: E402
from app.snapshot import build_snapshot  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--user", help="Email of the user whose personal exercises to promote to globals. "
                                  "Omit to capture only existing globals.")
    p.add_argument("--out", default="seed_data/exercise_snapshot.json",
                   help="Path to write the snapshot JSON (default: seed_data/exercise_snapshot.json).")
    args = p.parse_args()

    with get_db() as conn:
        cur = conn.cursor()
        user_id = None
        if args.user:
            cur.execute("SELECT id FROM users WHERE email = ?", (args.user,))
            row = cur.fetchone()
            if not row:
                print(f"error: user '{args.user}' not found", file=sys.stderr)
                return 1
            user_id = row["id"]

        payload = build_snapshot(cur, user_id)

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = ROOT / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")

    n_img = sum(len(e["images"]) for e in payload["exercises"])
    scope = f"(globals + user={args.user})" if args.user else "(globals only)"
    print(f"Wrote {out_path} — {len(payload['exercises'])} exercises, {n_img} images {scope}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

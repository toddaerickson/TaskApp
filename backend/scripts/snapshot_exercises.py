"""
Capture a snapshot of the current exercise library (globals + one user's
personal exercises) into `backend/seed_data/exercise_snapshot.json`, which
`seed_workouts.py` then uses to re-seed on every deploy.

Usage (local dev):
    venv/bin/python scripts/snapshot_exercises.py \
        --user you@example.com \
        --out seed_data/exercise_snapshot.json

Usage (production, one-time migration):
    fly ssh console -a taskapp-workout
    cd /app && python scripts/snapshot_exercises.py --user you@example.com \
        --out /tmp/snapshot.json
    # then copy /tmp/snapshot.json down to your workstation and commit it.

Read-only against the DB. Safe to run any time.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running as `python scripts/snapshot_exercises.py` from backend/.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import get_db  # noqa: E402


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    """Deterministic slug for user-owned exercises that were created without
    one. Lowercase, non-alphanum → underscore, trimmed."""
    return _SLUG_RE.sub("_", (name or "").lower()).strip("_") or "unnamed"


# The column order mirrors the INSERT in seed_workouts.seed_from_snapshot()
# and the `exercises` table definition. Keep them aligned.
_EXERCISE_FIELDS = [
    "slug", "name", "category", "primary_muscle", "equipment",
    "difficulty", "is_bodyweight", "measurement",
    "instructions", "cue", "contraindications",
    "min_age", "max_age",
]


def _load_exercises(cur, user_id: int | None) -> list[dict]:
    """Pulls exercises + their images. If user_id is None we only load globals;
    if given, we include both globals AND that user's owned rows."""
    rows_by_id: dict[int, dict] = {}
    order: list[int] = []

    def ingest(where: str, params: tuple) -> None:
        cur.execute(f"SELECT id, {', '.join(_EXERCISE_FIELDS)} FROM exercises WHERE {where}", params)
        for r in cur.fetchall():
            if r["id"] in rows_by_id:
                continue
            rows_by_id[r["id"]] = r
            order.append(r["id"])

    ingest("user_id IS NULL", ())
    if user_id is not None:
        ingest("user_id = ?", (user_id,))

    if not order:
        return []

    placeholders = ",".join(["?"] * len(order))
    cur.execute(
        f"SELECT exercise_id, url, sort_order FROM exercise_images "
        f"WHERE exercise_id IN ({placeholders}) ORDER BY exercise_id, sort_order, id",
        tuple(order),
    )
    images: dict[int, list[str]] = {i: [] for i in order}
    for row in cur.fetchall():
        images[row["exercise_id"]].append(row["url"])

    out: list[dict] = []
    used_slugs: set[str] = set()
    for ex_id in order:
        r = rows_by_id[ex_id]
        slug = r["slug"] or _slugify(r["name"])
        # Guard against collisions: if a user-owned exercise auto-slugs into
        # an existing global's slug, disambiguate. Should be rare.
        base = slug
        n = 2
        while slug in used_slugs:
            slug = f"{base}_{n}"
            n += 1
        used_slugs.add(slug)

        out.append({
            "slug": slug,
            "name": r["name"],
            "category": r["category"],
            "primary_muscle": r["primary_muscle"],
            "equipment": r["equipment"],
            "difficulty": r["difficulty"],
            "is_bodyweight": bool(r["is_bodyweight"]),
            "measurement": r["measurement"],
            "instructions": r["instructions"],
            "cue": r["cue"],
            "contraindications": r["contraindications"],
            "min_age": r["min_age"],
            "max_age": r["max_age"],
            "images": images[ex_id],
        })
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--user", help="Email of the user whose personal exercises to promote to globals. "
                                  "Omit to capture only existing globals.")
    p.add_argument("--out", default="seed_data/exercise_snapshot.json",
                   help="Path to write the snapshot JSON (default: seed_data/exercise_snapshot.json).")
    args = p.parse_args()

    with get_db() as conn:
        cur = conn.cursor()
        user_id: int | None = None
        if args.user:
            cur.execute("SELECT id FROM users WHERE email = ?", (args.user,))
            row = cur.fetchone()
            if not row:
                print(f"error: user '{args.user}' not found", file=sys.stderr)
                return 1
            user_id = row["id"]

        exercises = _load_exercises(cur, user_id)

    snapshot = {
        "version": 1,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "exercises": exercises,
    }

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = ROOT / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(snapshot, indent=2, sort_keys=False) + "\n")

    n_img = sum(len(e["images"]) for e in exercises)
    scope = f"(globals + user={args.user})" if args.user else "(globals only)"
    print(f"Wrote {out_path} — {len(exercises)} exercises, {n_img} images {scope}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

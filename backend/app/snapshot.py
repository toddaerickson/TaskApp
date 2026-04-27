"""
Shared logic for producing an exercise-library snapshot JSON payload.
Used by both the `scripts/snapshot_exercises.py` CLI and the
`GET /admin/snapshot` HTTP endpoint so the two always emit identical
shapes.
"""
import re
from datetime import datetime, timezone
from typing import Optional

_SLUG_RE = re.compile(r"[^a-z0-9]+")

# The column order mirrors the INSERT in seed_workouts.seed_from_snapshot()
# and the `exercises` table definition. Keep them aligned.
_EXERCISE_FIELDS = [
    "slug", "name", "category", "primary_muscle", "equipment",
    "difficulty", "is_bodyweight", "measurement",
    "instructions", "cue", "contraindications",
    "min_age", "max_age",
    "evidence_tier",
]


def slugify(name: str) -> str:
    """Deterministic slug for user-owned exercises that were created without
    one. Lowercase, non-alphanum → underscore, trimmed."""
    return _SLUG_RE.sub("_", (name or "").lower()).strip("_") or "unnamed"


def load_exercises(cur, user_id: Optional[int]) -> list[dict]:
    """Pulls exercises + their images. Always includes globals (user_id
    IS NULL). If `user_id` is given, also includes that user's personal
    rows — they're promoted to globals in the exported snapshot (no
    user_id in the output)."""
    rows_by_id: dict[int, dict] = {}
    order: list[int] = []

    def ingest(where: str, params: tuple) -> None:
        cur.execute(
            f"SELECT id, {', '.join(_EXERCISE_FIELDS)} FROM exercises WHERE {where}",
            params,
        )
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
        slug = r["slug"] or slugify(r["name"])
        # Disambiguate if a user-owned auto-slug collides with an existing global's slug.
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
            "evidence_tier": r["evidence_tier"],
            "images": images[ex_id],
        })
    return out


def build_snapshot(cur, user_id: Optional[int]) -> dict:
    """Produce the full snapshot dict (ready to JSON-serialize)."""
    return {
        "version": 1,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "exercises": load_exercises(cur, user_id),
    }

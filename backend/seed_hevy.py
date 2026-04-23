"""
Import exercises and routines from Hevy JSON exports into TaskApp.

Reads:
  - seed_data/hevy_bodyweight_exercises.json  (103 bodyweight exercises)
  - seed_data/hevy_routines.json              (29 curated routines)

Exercises are inserted as globals (user_id = NULL). Duplicates are skipped
by slug match. Routines are created for a specific user and skipped if a
routine with the same name already exists.

Usage:
    python seed_hevy.py                          # exercises only
    python seed_hevy.py <email>                  # exercises + all routines for user
    python seed_hevy.py <email> --dry-run        # preview without writing
    python seed_hevy.py --exercises-only         # just exercises, no routines
"""
import json
import re
import sys
from pathlib import Path

from app.database import get_db, init_db

ROOT = Path(__file__).resolve().parent
EXERCISES_PATH = ROOT / "seed_data" / "hevy_bodyweight_exercises.json"
ROUTINES_PATH = ROOT / "seed_data" / "hevy_routines.json"

# ── Hevy muscle → TaskApp category mapping ──────────────────────────────
# TaskApp schema: category IN ('strength','mobility','stretch','cardio','balance','rehab')
# Hevy uses primary_muscle values that don't map 1:1. This table resolves them.

_MUSCLE_TO_CATEGORY = {
    "abdominals": "strength",
    "biceps": "strength",
    "calves": "strength",
    "chest": "strength",
    "forearms": "strength",
    "glutes": "strength",
    "hamstrings": "strength",
    "lats": "strength",
    "lower_back": "strength",
    "neck": "strength",
    "quadriceps": "strength",
    "shoulders": "strength",
    "traps": "strength",
    "triceps": "strength",
    "upper_back": "strength",
    "abductors": "strength",
    "adductors": "strength",
    # Non-muscle categories
    "cardio": "cardio",
    "full_body": "strength",
    "other": "stretch",
}

# Hevy exercise_type → TaskApp measurement
_TYPE_TO_MEASUREMENT = {
    "reps_only": "reps",
    "weight_reps": "reps_weight",
    "bodyweight_reps": "reps",
    "duration": "duration",
    "distance": "distance",
}


def _slugify(name: str) -> str:
    """Convert exercise name to a slug matching TaskApp convention."""
    s = name.lower().strip()
    s = re.sub(r"[()]+", "", s)
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s


def _is_activity_label(ex: dict) -> bool:
    """Skip generic activity labels with no real exercise content."""
    return (
        not ex.get("image_url")
        and (not ex.get("instructions") or ex["instructions"].strip() == "")
        and ex.get("primary_muscle") in ("cardio", "full_body", "other")
    )


def seed_hevy_exercises(dry_run: bool = False) -> dict[str, int]:
    """Import Hevy bodyweight exercises. Returns {slug: exercise_id} for all
    global exercises (including pre-existing ones) so routines can reference them."""
    if not EXERCISES_PATH.exists():
        print(f"WARN: {EXERCISES_PATH} not found — skipping exercise import.")
        return {}

    payload = json.loads(EXERCISES_PATH.read_text())
    exercises = payload.get("exercises", [])

    inserted = 0
    skipped_dup = 0
    skipped_label = 0
    slug_to_id: dict[str, int] = {}

    with get_db() as conn:
        cur = conn.cursor()

        # Pre-load all existing global exercise slugs
        cur.execute("SELECT id, slug FROM exercises WHERE user_id IS NULL AND slug IS NOT NULL")
        for row in cur.fetchall():
            slug_to_id[row["slug"]] = row["id"]

        for ex in exercises:
            if _is_activity_label(ex):
                skipped_label += 1
                continue

            slug = _slugify(ex["name"])
            if slug in slug_to_id:
                skipped_dup += 1
                continue

            primary = ex.get("primary_muscle", "other")
            category = _MUSCLE_TO_CATEGORY.get(primary, "strength")
            measurement = "reps"  # default for bodyweight
            is_bodyweight = True
            instructions = ex.get("instructions", "").strip() or None

            if dry_run:
                print(f"  [dry-run] INSERT {slug} ({category}/{primary})")
                inserted += 1
                continue

            cur.execute(
                """INSERT INTO exercises
                (user_id, name, slug, category, primary_muscle, equipment,
                 difficulty, is_bodyweight, measurement, instructions)
                VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (ex["name"], slug, category, primary,
                 "bodyweight", 2, is_bodyweight, measurement, instructions),
            )
            ex_id = cur.lastrowid
            slug_to_id[slug] = ex_id

            # Image
            img = ex.get("image_url")
            if img:
                cur.execute(
                    "INSERT INTO exercise_images (exercise_id, url, sort_order) VALUES (?, ?, 0)",
                    (ex_id, img),
                )
            inserted += 1

    print(f"Hevy exercises: {inserted} inserted, {skipped_dup} already exist, "
          f"{skipped_label} activity labels skipped.")
    return slug_to_id


def seed_hevy_routines(email: str, slug_to_id: dict[str, int], dry_run: bool = False) -> int:
    """Import Hevy routines for a user. Exercises are matched by slugified title.
    Returns count of routines created."""
    if not ROUTINES_PATH.exists():
        print(f"WARN: {ROUTINES_PATH} not found — skipping routine import.")
        return 0

    payload = json.loads(ROUTINES_PATH.read_text())
    routines = payload.get("routines", [])

    created = 0
    skipped = 0

    with get_db() as conn:
        cur = conn.cursor()

        cur.execute("SELECT id FROM users WHERE email = ?", (email,))
        user = cur.fetchone()
        if not user:
            print(f"User {email} not found.")
            return 0
        user_id = user["id"]

        for routine in routines:
            title = routine.get("title", "Untitled")
            exercises = routine.get("exercises", [])

            # Skip routines that are just stubs (no exercise details)
            if not exercises:
                skipped += 1
                continue

            # Dedup by name
            cur.execute("SELECT id FROM routines WHERE user_id = ? AND name = ?",
                        (user_id, title))
            if cur.fetchone():
                skipped += 1
                continue

            if dry_run:
                print(f"  [dry-run] CREATE routine '{title}' ({len(exercises)} exercises)")
                created += 1
                continue

            # Determine goal from dominant muscle group
            goal = "general"
            muscles = [e.get("primary_muscle", "") for e in exercises if e.get("primary_muscle")]
            if muscles:
                from collections import Counter
                top = Counter(muscles).most_common(1)[0][0]
                if top == "cardio":
                    goal = "cardio"
                elif top in ("abdominals",):
                    goal = "strength"

            cur.execute(
                "INSERT INTO routines (user_id, name, goal, notes) VALUES (?, ?, ?, ?)",
                (user_id, title, goal, None),
            )
            rid = cur.lastrowid

            ex_added = 0
            ex_missing = 0
            for ex in exercises:
                ex_title = ex.get("title", "")
                slug = _slugify(ex_title)

                # Try exact slug match first, then partial
                ex_id = slug_to_id.get(slug)
                if not ex_id:
                    # Try lookup in DB by slug
                    cur.execute(
                        "SELECT id FROM exercises WHERE slug = ? AND user_id IS NULL",
                        (slug,),
                    )
                    row = cur.fetchone()
                    if row:
                        ex_id = row["id"]
                        slug_to_id[slug] = ex_id

                if not ex_id:
                    # Try fuzzy: name LIKE
                    cur.execute(
                        "SELECT id, slug FROM exercises WHERE name = ? AND user_id IS NULL",
                        (ex_title,),
                    )
                    row = cur.fetchone()
                    if row:
                        ex_id = row["id"]
                        slug_to_id[row["slug"]] = ex_id

                if not ex_id:
                    ex_missing += 1
                    continue

                sets = ex.get("sets", [])
                target_sets = len(sets) or 3
                rest_sec = ex.get("rest_seconds", 60)
                notes = ex.get("hint_notes")
                exercise_type = ex.get("exercise_type", "reps_only")

                # Duration exercises: extract target from first set
                target_duration = None
                target_reps = None
                if exercise_type == "duration" and sets:
                    target_duration = sets[0].get("duration_seconds")
                else:
                    target_reps = None  # Hevy doesn't pre-fill reps

                # Extract target_rpe from hint_notes if present
                target_rpe = None
                if notes:
                    import re as _re
                    rpe_match = _re.search(r"RPE\s+(\d+)", notes)
                    if rpe_match:
                        target_rpe = min(int(rpe_match.group(1)), 10)

                cur.execute(
                    """INSERT INTO routine_exercises
                    (routine_id, exercise_id, sort_order, target_sets, target_reps,
                     target_duration_sec, rest_sec, keystone, notes, target_rpe)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (rid, ex_id, ex.get("order", ex_added), target_sets,
                     target_reps, target_duration, rest_sec,
                     False, notes, target_rpe),
                )
                ex_added += 1

            if ex_missing > 0:
                print(f"  '{title}': {ex_added} exercises added, {ex_missing} not found in DB")
            created += 1

    print(f"Hevy routines: {created} created, {skipped} skipped (already exist or empty).")
    return created


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    exercises_only = "--exercises-only" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("-")]

    if "-h" in sys.argv or "--help" in sys.argv:
        print(__doc__)
        sys.exit(0)

    init_db()

    # Always seed exercises first
    slug_map = seed_hevy_exercises(dry_run=dry_run)

    # Seed routines if email provided
    if args and not exercises_only:
        email = args[0]
        seed_hevy_routines(email, slug_map, dry_run=dry_run)
    elif not exercises_only and not args:
        print("No email provided — exercises imported, routines skipped.")
        print("Usage: python seed_hevy.py <email> to also create routines.")

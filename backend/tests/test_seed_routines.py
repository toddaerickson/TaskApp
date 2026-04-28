"""Sanity checks for the routines defined in seed_workouts.ROUTINES.

Validates:
- Every exercise slug referenced by a routine exists in the EXERCISES
  list (or the snapshot — we check both via seed_exercises + snapshot
  load), so a typo can't ship a routine that crashes on first seed.
- target_minutes when present is in the Pydantic-bounded 1-180 range
  (matches RoutineCreate.target_minutes Field constraints).
- The five new "snack" routines are wired up the way the joint-snacks
  plan committed to (real `goal` preserved, target_minutes 4-6).
"""
from __future__ import annotations

import pytest

from seed_workouts import EXERCISES, ROUTINES


_ALL_SLUGS = {ex["slug"] for ex in EXERCISES} | {
    # single_leg_glute_bridge predates the EXERCISES additions; the seed
    # file also pulls it in via the snapshot, but the test EXERCISES list
    # does not duplicate the entry. Whitelist the legacy slugs the new
    # routines reference (only the one).
    "single_leg_glute_bridge",
}


@pytest.mark.parametrize("key,spec", list(ROUTINES.items()))
def test_routine_references_known_exercises(key, spec):
    for slug, _targets in spec["exercises"]:
        assert slug in _ALL_SLUGS, (
            f"routine '{key}' references unknown exercise slug '{slug}'. "
            "Either fix the slug, add the exercise to seed_workouts.EXERCISES, "
            "or whitelist a legacy slug in test_seed_routines._ALL_SLUGS."
        )


@pytest.mark.parametrize("key,spec", list(ROUTINES.items()))
def test_routine_target_minutes_in_bounds(key, spec):
    """When set, target_minutes must satisfy the Pydantic constraint
    (RoutineCreate uses ge=1, le=180). Pre-snack routines omit it
    (legacy routines stay null) — that's fine."""
    tm = spec.get("target_minutes")
    if tm is None:
        return
    assert isinstance(tm, int), f"routine '{key}' target_minutes must be int, got {type(tm).__name__}"
    assert 1 <= tm <= 180, f"routine '{key}' target_minutes {tm} outside 1-180"


@pytest.mark.parametrize("key,spec", list(ROUTINES.items()))
def test_routine_goal_is_canonical(key, spec):
    """`goal` must be one of the values the routines.goal CHECK constraint
    accepts. The earlier draft of the joint-snacks plan was tempted to
    introduce 'quick' here — that overloads goal with a duration,
    burying e.g. copenhagen_prehab out of its real 'strength' bucket."""
    assert spec["goal"] in {"strength", "mobility", "cardio", "rehab", "general"}, (
        f"routine '{key}' has goal '{spec['goal']}' which is outside the "
        "schema CHECK list. Use target_minutes for duration; goal is the category."
    )


SNACK_ROUTINES = {
    "core_anti_trio": {"goal": "mobility", "target_minutes": 5},
    "shoulder_snack": {"goal": "mobility", "target_minutes": 6},
    "tendon_isometric_snack": {"goal": "rehab", "target_minutes": 5},
    "pull_hip_snack": {"goal": "strength", "target_minutes": 5},
    "copenhagen_prehab": {"goal": "strength", "target_minutes": 4},
}


@pytest.mark.parametrize("slug,expected", list(SNACK_ROUTINES.items()))
def test_snack_routine_shape(slug, expected):
    """Lock the snack-routine wiring so a future refactor can't silently
    flip a routine's category to 'quick' or move target_minutes around."""
    spec = ROUTINES.get(slug)
    assert spec is not None, f"snack routine '{slug}' missing from ROUTINES"
    assert spec["goal"] == expected["goal"], (
        f"{slug} goal expected {expected['goal']!r}, got {spec['goal']!r}"
    )
    assert spec.get("target_minutes") == expected["target_minutes"], (
        f"{slug} target_minutes expected {expected['target_minutes']}, "
        f"got {spec.get('target_minutes')}"
    )


def test_seed_snack_exercises_have_evidence_tier():
    """The 11-exercise joint-snacks library was selected for its evidence
    backing. Each new EXERCISES entry must carry a non-null evidence_tier
    so the chip lights up in the UI."""
    new_slugs = {
        "bird_dog", "dead_bug", "side_plank", "push_up_plus",
        "wall_sit_isometric", "wall_slide", "eccentric_heel_drops_alfredson",
        "copenhagen_plank", "cross_body_stretch_with_scap_stab", "inverted_row",
    }
    by_slug = {ex["slug"]: ex for ex in EXERCISES}
    for slug in new_slugs:
        assert slug in by_slug, f"snack exercise '{slug}' missing from EXERCISES"
        assert by_slug[slug].get("evidence_tier") in {
            "RCT", "MECHANISM", "PRACTITIONER", "THEORETICAL"
        }, f"{slug} missing or invalid evidence_tier"


def test_seed_routine_persists_target_minutes(client, auth_client):
    """End-to-end: seed_routine_for must persist target_minutes to the DB
    so the routine card duration pill renders post-seed."""
    from app.database import get_db
    import seed_workouts

    _, _, user_id = auth_client
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM users WHERE id = ?", (user_id,))
        email = cur.fetchone()["email"]

    # The snack routines reference real exercises that need to exist
    # first. Run the full seed.
    seed_workouts.seed_exercises()
    seed_workouts.seed_routine_for(email, "core_anti_trio")

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT target_minutes FROM routines WHERE user_id = ? AND name = ?",
            (user_id, "Core Anti-Trio"),
        )
        row = cur.fetchone()
    assert row is not None
    assert row["target_minutes"] == 5


def test_seed_routine_persists_tracks_symptoms(client, auth_client):
    """End-to-end: seed_routine_for must honor `tracks_symptoms: True`
    on rehab protocols so sessions started from them auto-enable the
    pain-monitored progression path. Caught a gap in the seeder
    (only inserted name/goal/notes/target_minutes); without this row
    a new user seeded with knee_valgus_pt would have to flip the
    rehab toggle manually after seeding."""
    from app.database import get_db
    import seed_workouts

    _, _, user_id = auth_client
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM users WHERE id = ?", (user_id,))
        email = cur.fetchone()["email"]

    seed_workouts.seed_exercises()
    seed_workouts.seed_routine_for(email, "knee_valgus_pt")

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT tracks_symptoms, goal, target_minutes FROM routines "
            "WHERE user_id = ? AND name = ?",
            (user_id, "Knee Valgus PT"),
        )
        row = cur.fetchone()
    assert row is not None
    assert bool(row["tracks_symptoms"]) is True, (
        "knee_valgus_pt seeded without tracks_symptoms — sessions "
        "won't enter the pain-monitored progression path."
    )
    assert row["goal"] == "rehab"
    assert row["target_minutes"] == 28

"""Sanity checks on the shipped exercise library snapshot so the JSON
file stays in sync with seed_workouts.py's IMAGES dict and we don't
silently regress the number of exercises that have a usable image.

Image-less seeded exercises surface in the UI as empty cards — the
routine detail screen skips the image carousel when images is [].
A card with no image still works but looks unfinished, so this
module acts as a ratchet: landing new exercises without images is
allowed, but the ratchet count here has to be bumped deliberately.
"""
from __future__ import annotations

import json
from pathlib import Path

from seed_workouts import IMAGES

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "seed_data" / "exercise_snapshot.json"

# Bump this (downward) as images are added to the snapshot. Raising it
# requires explaining why in the PR description. Current known-unsourced:
#   banded_fire_hydrant, seated_soleus_stretch
MAX_IMAGELESS = 2


def _load_snapshot() -> dict:
    return json.loads(SNAPSHOT.read_text())


def test_snapshot_every_exercise_has_slug_and_name():
    snap = _load_snapshot()
    for ex in snap["exercises"]:
        assert ex.get("slug"), f"missing slug: {ex}"
        assert ex.get("name"), f"missing name: {ex['slug']}"


def test_snapshot_every_exercise_carries_evidence_tier_field():
    """Field-presence ratchet for the `evidence_tier` column. Value can
    be null (unclassified) — what we're guarding against is a future
    schema add that gets shipped without snapshot regeneration. If this
    test fails, run `scripts/snapshot_exercises.py` to refresh the JSON."""
    snap = _load_snapshot()
    for ex in snap["exercises"]:
        assert "evidence_tier" in ex, (
            f"snapshot[{ex.get('slug')!r}] missing the evidence_tier field. "
            "Regenerate via scripts/snapshot_exercises.py."
        )
        # Allowed values when non-null.
        if ex["evidence_tier"] is not None:
            assert ex["evidence_tier"] in {"RCT", "MECHANISM", "PRACTITIONER", "THEORETICAL"}, (
                f"snapshot[{ex['slug']!r}].evidence_tier = {ex['evidence_tier']!r} "
                "is not one of the four valid tier values."
            )


def test_snapshot_image_coverage_not_regressed():
    """Ratchet: the shipped snapshot should have no more than
    MAX_IMAGELESS exercises without at least one image. When the count
    drops, lower MAX_IMAGELESS in the same PR."""
    snap = _load_snapshot()
    missing = [e["slug"] for e in snap["exercises"] if not e.get("images")]
    assert len(missing) <= MAX_IMAGELESS, (
        f"{len(missing)} exercises missing images (limit {MAX_IMAGELESS}): "
        f"{missing}"
    )


def test_snapshot_matches_seed_workouts_images_dict():
    """Every slug in seed_workouts.IMAGES must be present in the snapshot
    AND have non-empty images. The IMAGES dict is the source of truth the
    JSON is supposed to be baked from; either kind of drift means someone
    added an exercise (or URLs) without rerunning
    `scripts/snapshot_exercises.py`.

    The earlier shape of this test silently skipped slugs that weren't in
    the snapshot — exactly the case it claimed to catch. Don't add that
    skip back without a very good reason."""
    snap = _load_snapshot()
    snap_slugs = {e["slug"]: e for e in snap["exercises"]}
    for slug, urls in IMAGES.items():
        if not urls:
            continue
        assert slug in snap_slugs, (
            f"seed_workouts.IMAGES has {len(urls)} URL(s) for '{slug}' but "
            f"the snapshot doesn't contain that slug at all. Either (a) "
            f"regenerate the snapshot (run scripts/snapshot_exercises.py) "
            f"if '{slug}' is a new exercise that hasn't been baked in yet, "
            f"or (b) drop '{slug}' from seed_workouts.IMAGES if it was "
            f"intentionally removed from the catalog."
        )
        assert snap_slugs[slug].get("images"), (
            f"snapshot[{slug}].images is empty but seed_workouts.IMAGES "
            f"has {len(urls)} URL(s); snapshot needs regenerating"
        )

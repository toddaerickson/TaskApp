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

import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "seed_data" / "exercise_snapshot.json"
SEED_WORKOUTS = ROOT / "seed_workouts.py"

# Bump this (downward) as images are added to the snapshot. Raising it
# requires explaining why in the PR description. Current known-unsourced:
#   banded_fire_hydrant, seated_soleus_stretch
MAX_IMAGELESS = 2


def _load_snapshot() -> dict:
    return json.loads(SNAPSHOT.read_text())


def _load_images_dict() -> dict[str, list[str]]:
    """Return seed_workouts.IMAGES without importing the module (the
    module side-effects the DB on import)."""
    tree = ast.parse(SEED_WORKOUTS.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "IMAGES" for t in node.targets
        ):
            base = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises"
            return eval(ast.unparse(node.value), {"_BASE": base})  # noqa: S307
    raise AssertionError("IMAGES dict not found in seed_workouts.py")


def test_snapshot_every_exercise_has_slug_and_name():
    snap = _load_snapshot()
    for ex in snap["exercises"]:
        assert ex.get("slug"), f"missing slug: {ex}"
        assert ex.get("name"), f"missing name: {ex['slug']}"


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
    """Every slug in seed_workouts.IMAGES that also exists in the
    snapshot should have non-empty images — the IMAGES dict is the
    hardcoded source of truth the JSON is supposed to be baked from.
    Drift between them means someone added a URL and forgot to
    regenerate the snapshot."""
    snap = _load_snapshot()
    images_dict = _load_images_dict()
    snap_slugs = {e["slug"]: e for e in snap["exercises"]}
    for slug, urls in images_dict.items():
        if slug not in snap_slugs or not urls:
            continue
        ex = snap_slugs[slug]
        assert ex.get("images"), (
            f"snapshot[{slug}].images is empty but seed_workouts.IMAGES has {len(urls)} URL(s); "
            f"snapshot needs regenerating"
        )

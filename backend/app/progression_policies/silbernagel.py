"""
Pain-monitored progression policy (Silbernagel-style).

The Silbernagel protocol for Achilles tendinopathy — and the same
logic applied by most modern rehab guidelines for patellar, rotator-
cuff, and glute-med progressions — says: pain during/after a loaded
exercise is acceptable up to a threshold; stays steady session-over-
session at moderate pain; triggers a deload when pain is high.

This module implements a reps-and-duration-agnostic decision tree over
the last session's max pain × whether the user hit their prescribed
target, and returns the usual `Suggestion` so the routes surface it
like any other progression output.

Called only when the session has `tracks_symptoms=True`. When no
pain scores are present on the last-session sets we return `None` so
the caller falls through to the RPE path (progression.suggest). That
way a user who forgets to rate pain doesn't get frozen in place —
the RPE fallback keeps them moving.
"""
from typing import Optional

from app.progression import Suggestion, _avg, _round_half


# Pain band thresholds. Kept as named constants so a future operator
# (or an A/B experiment) can tune them without hunting through
# conditionals. Silbernagel's original protocol used 5/10 as the
# advance/hold boundary; we use 3 to give the user a wider safety
# margin early in rehab.
_ADVANCE_MAX = 3  # pain <= this + hit target → advance
_DELOAD_MIN = 7   # pain >= this → back off regardless of target


def _max_pain(last_sets: list[dict]) -> Optional[int]:
    """Max of last-session `pain_score` values, ignoring None. Returns
    None when every set is None (or list is empty) so the caller can
    fall through to the RPE path."""
    scores = [s.get("pain_score") for s in last_sets
              if s.get("pain_score") is not None]
    if not scores:
        return None
    return max(scores)


def _hit_target_reps(last_sets: list[dict], target_reps: Optional[int]) -> bool:
    """User 'hit target' for a reps-measured exercise when the average
    reps across last-session sets met or exceeded the prescribed reps.
    No target → always counts as hit (nothing to fall short of)."""
    if not target_reps:
        return True
    reps = [s.get("reps") for s in last_sets if s.get("reps") is not None]
    if not reps:
        return False
    return _avg(reps) >= target_reps


def _hit_target_duration(
    last_sets: list[dict], target_duration_sec: Optional[int],
) -> bool:
    if not target_duration_sec:
        return True
    durs = [s.get("duration_sec") for s in last_sets
            if s.get("duration_sec") is not None]
    if not durs:
        return False
    return _avg(durs) >= target_duration_sec


def suggest(
    measurement: str,
    target_reps: Optional[int],
    target_weight: Optional[float],
    target_duration_sec: Optional[int],
    is_bodyweight: bool,
    last_sets: list[dict],
) -> Optional[Suggestion]:
    """Run the pain decision tree. Returns None if no pain data is
    available on the last session, signaling the caller to fall through
    to the RPE path.
    """
    if not last_sets:
        return None  # no history; caller's no-history branch handles this

    pain = _max_pain(last_sets)
    if pain is None:
        return None  # no pain scores — fall back to RPE

    # Compute baselines first so every branch has them ready.
    reps_vals = [s.get("reps") for s in last_sets if s.get("reps") is not None]
    weight_vals = [s.get("weight") for s in last_sets if s.get("weight") is not None]
    dur_vals = [s.get("duration_sec") for s in last_sets if s.get("duration_sec") is not None]
    baseline_reps = int(_avg(reps_vals)) if reps_vals else (target_reps or 10)
    baseline_weight = _avg(weight_vals) if weight_vals else (target_weight or 0)
    baseline_dur = int(_avg(dur_vals)) if dur_vals else (target_duration_sec or 30)

    # High pain → back off regardless of performance. Priority over the
    # "hit target" check — we never advance into pain, even if the numbers
    # looked good.
    if pain >= _DELOAD_MIN:
        if measurement in ("reps", "reps_weight"):
            if not is_bodyweight and baseline_weight > 0:
                return Suggestion(
                    reps=baseline_reps,
                    weight=_round_half(baseline_weight * 0.9),
                    reason=f"Pain {pain}/10 last session — backing off 10% weight.",
                    policy="silbernagel",
                    pain_last=pain,
                )
            return Suggestion(
                reps=max(1, baseline_reps - 2),
                weight=target_weight,
                reason=f"Pain {pain}/10 last session — backing off 2 reps.",
                policy="silbernagel",
                pain_last=pain,
            )
        if measurement == "duration":
            return Suggestion(
                duration_sec=max(10, baseline_dur - 15),
                reason=f"Pain {pain}/10 last session — backing off 15s.",
                policy="silbernagel",
                pain_last=pain,
            )
        # Distance or unknown: advise a deload in words since we can't
        # compute a smarter number.
        return Suggestion(
            reason=f"Pain {pain}/10 — consider lighter work this session.",
            policy="silbernagel",
            pain_last=pain,
        )

    # Moderate pain (4-6) → hold at what they actually did.
    if pain > _ADVANCE_MAX:
        if measurement in ("reps", "reps_weight"):
            return Suggestion(
                reps=baseline_reps,
                weight=_round_half(baseline_weight) if baseline_weight else target_weight,
                reason=f"Pain {pain}/10 — holding at last session.",
                policy="silbernagel",
                pain_last=pain,
            )
        if measurement == "duration":
            return Suggestion(
                duration_sec=baseline_dur,
                reason=f"Pain {pain}/10 — holding at last session.",
                policy="silbernagel",
                pain_last=pain,
            )
        return Suggestion(
            reason=f"Pain {pain}/10 — hold steady.",
            policy="silbernagel",
            pain_last=pain,
        )

    # Low pain (0-3). Advance only if the user also hit their prescribed
    # target; otherwise hold at what they did. Advancing through a missed
    # target is how rehab patients stall with cumulative half-reps.
    if measurement in ("reps", "reps_weight"):
        if not _hit_target_reps(last_sets, target_reps):
            return Suggestion(
                reps=baseline_reps,
                weight=_round_half(baseline_weight) if baseline_weight else target_weight,
                reason=f"Pain {pain}/10 but under target — holding.",
                policy="silbernagel",
                pain_last=pain,
            )
        if not is_bodyweight and baseline_weight > 0:
            return Suggestion(
                reps=baseline_reps,
                weight=_round_half(baseline_weight * 1.1),
                reason=f"Pain {pain}/10 — advancing 10% weight.",
                policy="silbernagel",
                pain_last=pain,
            )
        return Suggestion(
            reps=baseline_reps + 2,
            weight=target_weight,
            reason=f"Pain {pain}/10 — advancing 2 reps.",
            policy="silbernagel",
            pain_last=pain,
        )

    if measurement == "duration":
        if not _hit_target_duration(last_sets, target_duration_sec):
            return Suggestion(
                duration_sec=baseline_dur,
                reason=f"Pain {pain}/10 but under target — holding.",
                policy="silbernagel",
                pain_last=pain,
            )
        return Suggestion(
            duration_sec=baseline_dur + 15,
            reason=f"Pain {pain}/10 — advancing 15s.",
            policy="silbernagel",
            pain_last=pain,
        )

    # Distance / unknown: we don't auto-advance; hold.
    return Suggestion(
        reason=f"Pain {pain}/10 — hold steady.",
        policy="silbernagel",
        pain_last=pain,
    )

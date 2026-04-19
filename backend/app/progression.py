"""
Progression auto-suggest.

Given a user's recent history for an exercise and the routine's target,
propose next-session numbers. Conservative by design: one small nudge at
a time, never more than a ~10% change.
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class Suggestion:
    reps: Optional[int] = None
    weight: Optional[float] = None
    duration_sec: Optional[int] = None
    reason: str = ""  # short human-readable explanation
    # Which policy produced this Suggestion. None for the default RPE
    # branch, "silbernagel" when pain-monitored progression fired. Routes
    # surface this on SuggestionResponse.policy so clients can render
    # a small badge and show why the number was chosen.
    policy: Optional[str] = None
    # Max pain score across the last-session sets that fed the decision.
    # Populated only when the Silbernagel branch fires. None otherwise.
    pain_last: Optional[int] = None


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _round_half(x: float) -> float:
    """Round a weight to the nearest 0.5 so gym-plate math works."""
    return round(x * 2) / 2


def suggest(
    measurement: str,
    target_reps: Optional[int],
    target_weight: Optional[float],
    target_duration_sec: Optional[int],
    is_bodyweight: bool,
    last_sets: list[dict],   # most-recent-first, each: {reps, weight, duration_sec, rpe, pain_score}
    tracks_symptoms: bool = False,
) -> Suggestion:
    """Return a target suggestion. Falls back to the routine target when
    there's no history, so the caller can always show *something*.

    When `tracks_symptoms=True` we first try the pain-monitored
    Silbernagel policy; it returns None when the last session has no
    pain_score data (e.g., the user forgot to rate), and we then fall
    through to the RPE branch below. That fallback is deliberate — we
    don't want to freeze a user who skipped a rating.
    """
    # No history → echo the routine's target.
    if not last_sets:
        return Suggestion(
            reps=target_reps,
            weight=target_weight,
            duration_sec=target_duration_sec,
            reason="No prior sessions — starting at target.",
        )

    # Look at the most recent session only (sets with a shared session id).
    # Callers pass already-filtered most-recent-first; take sets until session
    # id changes to keep the analysis to one workout.
    first_sid = last_sets[0].get("session_id")
    recent = [s for s in last_sets if s.get("session_id") == first_sid]

    # Pain-monitored branch — imported here to avoid a module-top cycle
    # (silbernagel re-exports Suggestion + helpers from this file).
    if tracks_symptoms:
        from app.progression_policies import silbernagel
        pain_based = silbernagel.suggest(
            measurement, target_reps, target_weight, target_duration_sec,
            is_bodyweight, recent,
        )
        if pain_based is not None:
            return pain_based
        # else: no pain data on the last session — fall through to RPE.

    rpes = [s["rpe"] for s in recent if s.get("rpe") is not None]
    avg_rpe = _avg(rpes) if rpes else None

    # Reps-first measurement (reps or reps_weight).
    if measurement in ("reps", "reps_weight"):
        last_reps = [s.get("reps") for s in recent if s.get("reps") is not None]
        last_weights = [s.get("weight") for s in recent if s.get("weight") is not None]
        baseline_reps = int(_avg(last_reps)) if last_reps else (target_reps or 10)
        baseline_weight = _avg(last_weights) if last_weights else (target_weight or 0)

        if avg_rpe is None:
            # Logged, but no RPE — hold steady on what they actually did.
            return Suggestion(
                reps=baseline_reps,
                weight=_round_half(baseline_weight) if baseline_weight else target_weight,
                reason="Hold: last session had no effort rating.",
            )

        if avg_rpe <= 6:
            # Felt easy — add load.
            if not is_bodyweight and baseline_weight > 0:
                new_w = _round_half(baseline_weight * 1.05)
                return Suggestion(
                    reps=baseline_reps, weight=new_w,
                    reason=f"Last felt easy (RPE {avg_rpe:.1f}) — +5% weight.",
                )
            return Suggestion(
                reps=baseline_reps + 2,
                weight=target_weight,
                reason=f"Last felt easy (RPE {avg_rpe:.1f}) — +2 reps.",
            )
        if avg_rpe >= 9:
            # Too hard — back off.
            if not is_bodyweight and baseline_weight > 0:
                new_w = _round_half(baseline_weight * 0.9)
                return Suggestion(
                    reps=baseline_reps, weight=new_w,
                    reason=f"Last was hard (RPE {avg_rpe:.1f}) — –10% weight.",
                )
            return Suggestion(
                reps=max(1, baseline_reps - 2),
                weight=target_weight,
                reason=f"Last was hard (RPE {avg_rpe:.1f}) — –2 reps.",
            )
        return Suggestion(
            reps=baseline_reps,
            weight=_round_half(baseline_weight) if baseline_weight else target_weight,
            reason=f"In the zone (RPE {avg_rpe:.1f}) — repeat.",
        )

    # Duration-first (stretches / isometrics).
    if measurement == "duration":
        last_durs = [s.get("duration_sec") for s in recent if s.get("duration_sec") is not None]
        baseline = int(_avg(last_durs)) if last_durs else (target_duration_sec or 30)
        if avg_rpe is None:
            return Suggestion(duration_sec=baseline, reason="Hold: no effort rating.")
        if avg_rpe <= 6:
            return Suggestion(
                duration_sec=baseline + 15,
                reason=f"Last felt easy (RPE {avg_rpe:.1f}) — +15s.",
            )
        if avg_rpe >= 9:
            return Suggestion(
                duration_sec=max(10, baseline - 15),
                reason=f"Last was hard (RPE {avg_rpe:.1f}) — –15s.",
            )
        return Suggestion(
            duration_sec=baseline,
            reason=f"In the zone (RPE {avg_rpe:.1f}) — repeat.",
        )

    # Distance (cardio) — similar pattern, small nudges.
    if measurement == "distance":
        last_dists = [s.get("distance_m") for s in recent if s.get("distance_m") is not None]
        baseline = _avg(last_dists) if last_dists else 0
        # Not enough detail to suggest cleanly — pass through target.
        return Suggestion(reason="Distance: no auto-progression yet; repeat target.")

    return Suggestion(reason="Unknown measurement.")

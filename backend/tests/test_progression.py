"""Tests for app/progression.py — pure-function progression logic.

Run from backend/: `venv/bin/pytest tests/ -v`
"""
from app.progression import suggest, Suggestion


def _set(
    session_id=1, reps=None, weight=None, duration_sec=None,
    distance_m=None, rpe=None, pain_score=None,
):
    return {
        "session_id": session_id,
        "reps": reps, "weight": weight,
        "duration_sec": duration_sec, "distance_m": distance_m,
        "rpe": rpe, "pain_score": pain_score,
    }


# ---------- No history fallback ----------

def test_no_history_echoes_target_for_reps():
    s = suggest("reps", target_reps=12, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=[])
    assert s.reps == 12
    assert s.weight is None
    assert "no prior" in s.reason.lower()


def test_no_history_echoes_target_for_duration():
    s = suggest("duration", target_reps=None, target_weight=None, target_duration_sec=120,
                is_bodyweight=True, last_sets=[])
    assert s.duration_sec == 120
    assert "no prior" in s.reason.lower()


# ---------- Reps (bodyweight) branch ----------

def test_reps_rpe_easy_adds_two_reps():
    sets = [_set(reps=12, rpe=5), _set(reps=12, rpe=5)]
    s = suggest("reps", target_reps=12, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=sets)
    assert s.reps == 14
    assert "+2 reps" in s.reason


def test_reps_rpe_hard_drops_two_reps():
    sets = [_set(reps=15, rpe=9), _set(reps=14, rpe=9)]
    s = suggest("reps", target_reps=12, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=sets)
    # Baseline is avg(15,14) = 14 → 14 - 2 = 12
    assert s.reps == 12
    assert "–2 reps" in s.reason or "-2 reps" in s.reason


def test_reps_rpe_hard_clamps_at_one():
    # Baseline 2, minus 2 should not go to 0 — floor at 1.
    sets = [_set(reps=2, rpe=10)]
    s = suggest("reps", target_reps=12, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=sets)
    assert s.reps == 1


def test_reps_rpe_in_zone_repeats_actual():
    sets = [_set(reps=10, rpe=7), _set(reps=11, rpe=7)]
    s = suggest("reps", target_reps=12, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=sets)
    # avg(10, 11) → 10 (int()).
    assert s.reps == 10
    assert "repeat" in s.reason.lower() or "zone" in s.reason.lower()


def test_reps_missing_rpe_holds_steady():
    sets = [_set(reps=11, rpe=None), _set(reps=13, rpe=None)]
    s = suggest("reps", target_reps=12, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=sets)
    # avg(11,13) = 12
    assert s.reps == 12
    assert "no effort rating" in s.reason.lower()


# ---------- Reps+weight (loaded) branch ----------

def test_loaded_rpe_easy_adds_five_percent_weight():
    sets = [_set(reps=10, weight=100.0, rpe=5), _set(reps=10, weight=100.0, rpe=5)]
    s = suggest("reps_weight", target_reps=10, target_weight=100.0, target_duration_sec=None,
                is_bodyweight=False, last_sets=sets)
    assert s.weight == 105.0
    assert s.reps == 10
    assert "+5%" in s.reason


def test_loaded_rpe_hard_drops_ten_percent_weight():
    sets = [_set(reps=8, weight=100.0, rpe=9)]
    s = suggest("reps_weight", target_reps=10, target_weight=100.0, target_duration_sec=None,
                is_bodyweight=False, last_sets=sets)
    assert s.weight == 90.0
    assert "–10%" in s.reason or "-10%" in s.reason


def test_weights_round_to_half_pound():
    # 22.5 * 1.05 = 23.625 → rounds to 23.5 (nearest .5)
    sets = [_set(reps=10, weight=22.5, rpe=5)]
    s = suggest("reps_weight", target_reps=10, target_weight=22.5, target_duration_sec=None,
                is_bodyweight=False, last_sets=sets)
    assert s.weight == 23.5


def test_bodyweight_flag_ignores_weight_even_with_reps_weight_measurement():
    # If the exercise is flagged bodyweight, don't try to bump weight.
    sets = [_set(reps=10, weight=0, rpe=5)]
    s = suggest("reps_weight", target_reps=10, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=sets)
    assert s.reps == 12
    assert s.weight is None or s.weight == 0


# ---------- Duration branch ----------

def test_duration_rpe_easy_adds_fifteen_seconds():
    sets = [_set(duration_sec=120, rpe=5), _set(duration_sec=120, rpe=5)]
    s = suggest("duration", target_reps=None, target_weight=None, target_duration_sec=120,
                is_bodyweight=True, last_sets=sets)
    assert s.duration_sec == 135


def test_duration_rpe_hard_drops_fifteen_seconds():
    sets = [_set(duration_sec=120, rpe=10)]
    s = suggest("duration", target_reps=None, target_weight=None, target_duration_sec=120,
                is_bodyweight=True, last_sets=sets)
    assert s.duration_sec == 105


def test_duration_rpe_hard_clamps_at_ten():
    sets = [_set(duration_sec=15, rpe=10)]
    s = suggest("duration", target_reps=None, target_weight=None, target_duration_sec=30,
                is_bodyweight=True, last_sets=sets)
    # 15 - 15 = 0 → clamped at 10
    assert s.duration_sec == 10


def test_duration_in_zone_repeats():
    sets = [_set(duration_sec=90, rpe=7)]
    s = suggest("duration", target_reps=None, target_weight=None, target_duration_sec=90,
                is_bodyweight=True, last_sets=sets)
    assert s.duration_sec == 90


# ---------- Multi-session isolation ----------

def test_only_uses_most_recent_session_for_baseline():
    # Recent session (first) had RPE 9 hard; older session had RPE 5 easy.
    # The suggestion must use the recent session (hard), not mix them.
    sets = [
        _set(session_id=2, reps=10, rpe=9),
        _set(session_id=2, reps=10, rpe=9),
        _set(session_id=1, reps=15, rpe=5),  # ignored — older
    ]
    s = suggest("reps", target_reps=12, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=sets)
    # Baseline from session 2: avg(10,10)=10 → 10 - 2 = 8
    assert s.reps == 8
    assert "hard" in s.reason.lower()


def test_partial_rpe_averages_only_rpe_present():
    # If some sets in the most recent session lack RPE, average only the ones that have it.
    sets = [
        _set(session_id=3, reps=10, rpe=5),
        _set(session_id=3, reps=10, rpe=None),  # excluded from avg
        _set(session_id=3, reps=10, rpe=7),
    ]
    s = suggest("reps", target_reps=12, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=sets)
    # avg(5, 7) = 6.0 → "easy" threshold → +2 reps. Baseline reps avg(10,10,10)=10
    assert s.reps == 12


# ---------- Edge: unknown measurement ----------

def test_unknown_measurement_returns_explanatory_suggestion():
    s = suggest("distance", target_reps=None, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=[_set(distance_m=1000, rpe=7)])
    # Distance branch today doesn't auto-progress; just returns reason.
    assert isinstance(s, Suggestion)


def test_truly_unknown_measurement():
    s = suggest("garbage", target_reps=10, target_weight=None, target_duration_sec=None,
                is_bodyweight=True, last_sets=[])
    # No history → echo target path handles this gracefully.
    assert s.reps == 10


# ---------- Silbernagel (pain-monitored) branch ----------
#
# Triggered by tracks_symptoms=True on the dispatcher. Tests exercise the
# pain × hit-target matrix: low pain + hit → advance; low pain + miss →
# hold; moderate → hold; high → back off. Missing pain scores fall
# through to the RPE path (covered by a separate fall-through test).

def test_silbernagel_low_pain_hit_target_advances_bodyweight_reps():
    # Pain 2/10, reps at target → +2 reps for a bodyweight exercise.
    s = suggest(
        "reps", target_reps=15, target_weight=None, target_duration_sec=None,
        is_bodyweight=True,
        last_sets=[_set(reps=15, pain_score=2), _set(reps=15, pain_score=1)],
        tracks_symptoms=True,
    )
    assert s.policy == "silbernagel"
    assert s.pain_last == 2  # max across sets
    assert s.reps == 17
    assert "advancing" in s.reason.lower()


def test_silbernagel_low_pain_hit_target_advances_weighted():
    # Pain 1/10, hit target → +10% weight, reps held.
    s = suggest(
        "reps_weight", target_reps=8, target_weight=100.0, target_duration_sec=None,
        is_bodyweight=False,
        last_sets=[_set(reps=8, weight=100.0, pain_score=1)],
        tracks_symptoms=True,
    )
    assert s.policy == "silbernagel"
    assert s.pain_last == 1
    assert s.weight == 110.0
    assert s.reps == 8


def test_silbernagel_low_pain_missed_target_holds():
    # Pain 2/10 but only 10 reps vs target 15 → hold at what they did.
    s = suggest(
        "reps", target_reps=15, target_weight=None, target_duration_sec=None,
        is_bodyweight=True,
        last_sets=[_set(reps=10, pain_score=2), _set(reps=10, pain_score=2)],
        tracks_symptoms=True,
    )
    assert s.policy == "silbernagel"
    assert s.reps == 10
    assert "under target" in s.reason.lower()


def test_silbernagel_moderate_pain_holds():
    # Pain 5/10 → hold at last session's actuals, regardless of target.
    s = suggest(
        "reps", target_reps=15, target_weight=None, target_duration_sec=None,
        is_bodyweight=True,
        last_sets=[_set(reps=12, pain_score=5)],
        tracks_symptoms=True,
    )
    assert s.policy == "silbernagel"
    assert s.pain_last == 5
    assert s.reps == 12  # baseline, not target
    assert "holding" in s.reason.lower()


def test_silbernagel_high_pain_backs_off_weighted():
    # Pain 8/10 → -10% weight, even if they hit target.
    s = suggest(
        "reps_weight", target_reps=8, target_weight=100.0, target_duration_sec=None,
        is_bodyweight=False,
        last_sets=[_set(reps=8, weight=100.0, pain_score=8)],
        tracks_symptoms=True,
    )
    assert s.policy == "silbernagel"
    assert s.pain_last == 8
    assert s.weight == 90.0
    assert "backing off" in s.reason.lower()


def test_silbernagel_duration_advances_at_low_pain():
    # Duration exercise, pain 2/10, hit target → +15s.
    s = suggest(
        "duration", target_reps=None, target_weight=None, target_duration_sec=30,
        is_bodyweight=True,
        last_sets=[_set(duration_sec=30, pain_score=2)],
        tracks_symptoms=True,
    )
    assert s.policy == "silbernagel"
    assert s.duration_sec == 45


def test_silbernagel_falls_through_when_no_pain_recorded():
    # tracks_symptoms=True but no pain_score on any set → fall through
    # to the RPE path. Caller sees the usual RPE-derived suggestion, no
    # policy badge.
    s = suggest(
        "reps", target_reps=12, target_weight=None, target_duration_sec=None,
        is_bodyweight=True,
        last_sets=[_set(reps=12, rpe=6)],
        tracks_symptoms=True,
    )
    # RPE 6 = easy → advance by +2 reps on bodyweight; policy stays None.
    assert s.policy is None
    assert s.reps == 14


def test_silbernagel_ignored_when_tracks_symptoms_false():
    # Pain scores present but tracks_symptoms=False (strength session) →
    # suggestion uses the RPE path and ignores the pain entirely.
    s = suggest(
        "reps", target_reps=12, target_weight=None, target_duration_sec=None,
        is_bodyweight=True,
        last_sets=[_set(reps=12, rpe=6, pain_score=9)],
        tracks_symptoms=False,
    )
    assert s.policy is None
    assert s.pain_last is None
    assert s.reps == 14  # RPE 6 advance

"""
Shared batch hydrators for the workout module. Single source of truth for
converting SQLite bool ints and nested objects — previously inlined in 3
route files with subtly different sort orders.
"""
from datetime import date, datetime
from typing import Iterable, Optional


def _in_clause(n: int) -> str:
    return "(" + ",".join("?" for _ in range(n)) + ")"


def hydrate_exercise_rows(rows: list[dict]) -> list[dict]:
    """Convert SQLite int flags to bools. Mutates + returns for convenience."""
    for r in rows:
        r["is_bodyweight"] = bool(r["is_bodyweight"])
    return rows


def load_images_for_exercises(cur, exercise_ids: Iterable[int]) -> dict[int, list[dict]]:
    ids = list(exercise_ids)
    if not ids:
        return {}
    cur.execute(
        f"SELECT id, exercise_id, url, caption, sort_order "
        f"FROM exercise_images WHERE exercise_id IN {_in_clause(len(ids))} "
        f"ORDER BY sort_order ASC, id ASC",
        tuple(ids),
    )
    out: dict[int, list[dict]] = {i: [] for i in ids}
    for row in cur.fetchall():
        out[row["exercise_id"]].append(row)
    return out


def hydrate_exercises_with_images(cur, rows: list[dict]) -> list[dict]:
    """Given a list of exercise rows, attach their images in one query."""
    hydrate_exercise_rows(rows)
    imgs = load_images_for_exercises(cur, (r["id"] for r in rows))
    for r in rows:
        r["images"] = imgs.get(r["id"], [])
    return rows


def load_exercises_by_ids(cur, exercise_ids: Iterable[int]) -> dict[int, dict]:
    """Fetch exercises by id, fully hydrated with images. Returns {id: exercise}."""
    ids = list(set(exercise_ids))
    if not ids:
        return {}
    cur.execute(
        f"SELECT * FROM exercises WHERE id IN {_in_clause(len(ids))}",
        tuple(ids),
    )
    rows = cur.fetchall()
    hydrate_exercises_with_images(cur, rows)
    return {r["id"]: r for r in rows}


def hydrate_routines_full(cur, routine_rows: list[dict]) -> list[dict]:
    """
    Attach exercises (with their own exercise + images) to each routine in
    a bounded number of queries regardless of list size. Also attaches
    `phases` and the server-resolved `current_phase_id` so the client
    doesn't re-implement the time-math.
    """
    if not routine_rows:
        return routine_rows
    routine_ids = [r["id"] for r in routine_rows]
    cur.execute(
        f"SELECT * FROM routine_exercises "
        f"WHERE routine_id IN {_in_clause(len(routine_ids))} "
        f"ORDER BY sort_order ASC, id ASC",
        tuple(routine_ids),
    )
    re_rows = cur.fetchall()
    exercises_by_id = load_exercises_by_ids(cur, (r["exercise_id"] for r in re_rows))
    grouped: dict[int, list[dict]] = {rid: [] for rid in routine_ids}
    for re in re_rows:
        re["keystone"] = bool(re["keystone"])
        re["exercise"] = exercises_by_id.get(re["exercise_id"])
        grouped[re["routine_id"]].append(re)

    # Phases in one query, keyed by routine_id. Ordered by order_idx so
    # the client can render them as-is without re-sorting. A routine with
    # no phases gets an empty list and a null current_phase_id — that's
    # the "flat" (legacy) path.
    cur.execute(
        f"SELECT * FROM routine_phases "
        f"WHERE routine_id IN {_in_clause(len(routine_ids))} "
        f"ORDER BY order_idx ASC, id ASC",
        tuple(routine_ids),
    )
    phases_by_routine: dict[int, list[dict]] = {rid: [] for rid in routine_ids}
    for p in cur.fetchall():
        phases_by_routine[p["routine_id"]].append(p)

    today = date.today()
    for r in routine_rows:
        r["exercises"] = grouped.get(r["id"], [])
        phases = phases_by_routine.get(r["id"], [])
        r["phases"] = phases
        r["current_phase_id"] = resolve_current_phase_id(
            phases, r.get("phase_start_date"), today,
        )
    return routine_rows


def resolve_current_phase_id(
    phases: list[dict],
    phase_start_date: Optional[str],
    today: date,
) -> Optional[int]:
    """Find the phase whose [offset, offset+duration_weeks) contains today,
    counting offset in weeks from `phase_start_date`.

    - No phases OR no start date → None (the routine is flat / unscheduled).
    - Before the first phase (start date in future) → first phase (so the
      user sees "upcoming" rather than a blank banner).
    - After the last phase's end → last phase (the program is complete; we
      keep the user in "maintenance / final phase" rather than falling off
      a cliff).

    Phases are assumed sorted by order_idx; callers should pass the list
    straight from `hydrate_routines_full`.
    """
    if not phases or not phase_start_date:
        return None
    try:
        start = _parse_iso_date(phase_start_date)
    except ValueError:
        return None
    weeks_elapsed = max((today - start).days, 0) // 7
    cumulative = 0
    for p in phases:
        end = cumulative + int(p["duration_weeks"])
        if cumulative <= weeks_elapsed < end:
            return p["id"]
        cumulative = end
    # Past the end of the program — pin to the last phase.
    return phases[-1]["id"]


def _parse_iso_date(value) -> date:
    """Accept either a `date`/`datetime` from PG or an ISO string from
    SQLite's TEXT storage. Raises ValueError on anything else."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        # Strip optional time component — PG might hand back "YYYY-MM-DD"
        # or, for defensive reading, "YYYY-MM-DDTHH:MM:SS".
        return date.fromisoformat(value[:10])
    raise ValueError(f"unrecognized phase_start_date value: {value!r}")


def hydrate_sessions_full(cur, session_rows: list[dict]) -> list[dict]:
    if not session_rows:
        return session_rows
    session_ids = [s["id"] for s in session_rows]
    cur.execute(
        f"SELECT * FROM session_sets "
        f"WHERE session_id IN {_in_clause(len(session_ids))} "
        f"ORDER BY set_number ASC, id ASC",
        tuple(session_ids),
    )
    sets = cur.fetchall()
    grouped: dict[int, list[dict]] = {sid: [] for sid in session_ids}
    for s in sets:
        s["completed"] = bool(s["completed"])
        grouped[s["session_id"]].append(s)
    for sess in session_rows:
        sess["sets"] = grouped.get(sess["id"], [])
    return session_rows

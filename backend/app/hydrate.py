"""
Shared batch hydrators for the workout module. Single source of truth for
converting SQLite bool ints and nested objects — previously inlined in 3
route files with subtly different sort orders.
"""
from typing import Iterable


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
        f"SELECT id, exercise_id, url, caption, sort_order, alt_text "
        f"FROM exercise_images WHERE exercise_id IN {_in_clause(len(ids))} "
        f"ORDER BY sort_order ASC, id ASC",
        tuple(ids),
    )
    out: dict[int, list[dict]] = {i: [] for i in ids}
    for row in cur.fetchall():
        out[row["exercise_id"]].append(row)
    return out


def hydrate_exercises_with_images(cur, rows: list[dict]) -> list[dict]:
    """Given a list of exercise rows, attach their images in one query.
    Substitutes a per-exercise default alt_text ("{name} demonstration")
    for any image whose stored alt_text is NULL — keeps VoiceOver
    meaningful for legacy rows that predate the column."""
    hydrate_exercise_rows(rows)
    imgs = load_images_for_exercises(cur, (r["id"] for r in rows))
    for r in rows:
        attached = imgs.get(r["id"], [])
        default_alt = f"{r['name']} demonstration"
        for img in attached:
            if not img.get("alt_text"):
                img["alt_text"] = default_alt
        r["images"] = attached
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
    a bounded number of queries regardless of list size.
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

    for r in routine_rows:
        r["exercises"] = grouped.get(r["id"], [])
    return routine_rows


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
        # is_warmup comes back as 0/1 from SQLite and True/False from PG;
        # coerce to bool so the Pydantic SessionSetResponse serializes
        # consistently on both.
        s["is_warmup"] = bool(s.get("is_warmup"))
        grouped[s["session_id"]].append(s)
    for sess in session_rows:
        sess["sets"] = grouped.get(sess["id"], [])
    return session_rows

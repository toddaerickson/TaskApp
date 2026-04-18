from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_db
from app.auth import get_current_user_id
from pydantic import BaseModel
from typing import Optional
from app.models import (
    RoutineCreate, RoutineUpdate, RoutineResponse,
    RoutineExerciseCreate, RoutineExerciseResponse,
)
from app.hydrate import hydrate_routines_full, load_exercises_by_ids
from app.progression import suggest as compute_suggest, Suggestion


class RoutineExerciseUpdate(BaseModel):
    sort_order: Optional[int] = None
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_weight: Optional[float] = None
    target_duration_sec: Optional[int] = None
    rest_sec: Optional[int] = None
    tempo: Optional[str] = None
    keystone: Optional[bool] = None
    notes: Optional[str] = None


class RoutineReorderRequest(BaseModel):
    routine_exercise_ids: list[int]

router = APIRouter(prefix="/routines", tags=["routines"])


def _load_exercise(cur, exercise_id: int) -> dict | None:
    return load_exercises_by_ids(cur, [exercise_id]).get(exercise_id)


def _hydrate_routine(cur, row: dict) -> dict:
    hydrate_routines_full(cur, [row])
    return row


@router.get("", response_model=list[RoutineResponse])
def list_routines(
    limit: int = Query(50, ge=1, le=200),
    cursor: int | None = Query(
        None,
        description="Routine id from the previous page's last item. Returns "
                    "routines with id > cursor (sort_order, id ASC).",
    ),
    user_id: int = Depends(get_current_user_id),
):
    """List a user's routines. Paginated: `limit` caps page size (default 50,
    max 200), `cursor` is the id of the last routine on the prior page so
    the client can request id > cursor for the next page. Ordering is
    `(sort_order ASC, id ASC)` so pagination is deterministic."""
    with get_db() as conn:
        cur = conn.cursor()
        sql = "SELECT * FROM routines WHERE user_id = ?"
        params: list = [user_id]
        if cursor is not None:
            sql += " AND id > ?"
            params.append(cursor)
        sql += " ORDER BY sort_order ASC, id ASC LIMIT ?"
        params.append(limit)
        cur.execute(sql, tuple(params))
        return hydrate_routines_full(cur, cur.fetchall())


@router.get("/{routine_id}", response_model=RoutineResponse)
def get_routine(routine_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM routines WHERE id = ? AND user_id = ?",
            (routine_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Routine not found")
        return _hydrate_routine(cur, row)


@router.post("", response_model=RoutineResponse)
def create_routine(req: RoutineCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO routines
               (user_id, name, goal, notes, sort_order, reminder_time, reminder_days)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, req.name, req.goal, req.notes, req.sort_order or 0,
             req.reminder_time, req.reminder_days),
        )
        rid = cur.lastrowid
        for idx, ex in enumerate(req.exercises or []):
            cur.execute(
                """INSERT INTO routine_exercises
                (routine_id, exercise_id, sort_order, target_sets, target_reps, target_weight,
                 target_duration_sec, rest_sec, tempo, keystone, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (rid, ex.exercise_id, ex.sort_order if ex.sort_order is not None else idx,
                 ex.target_sets, ex.target_reps, ex.target_weight, ex.target_duration_sec,
                 ex.rest_sec, ex.tempo, bool(ex.keystone), ex.notes),
            )
        cur.execute("SELECT * FROM routines WHERE id = ?", (rid,))
        return _hydrate_routine(cur, cur.fetchone())


@router.put("/{routine_id}", response_model=RoutineResponse)
def update_routine(routine_id: int, req: RoutineUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM routines WHERE id = ? AND user_id = ?", (routine_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Routine not found")
        fields = {k: v for k, v in req.model_dump(exclude_unset=True).items()}
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            cur.execute(f"UPDATE routines SET {sets} WHERE id = ?",
                        tuple(list(fields.values()) + [routine_id]))
        cur.execute("SELECT * FROM routines WHERE id = ?", (routine_id,))
        return _hydrate_routine(cur, cur.fetchone())


@router.delete("/{routine_id}")
def delete_routine(routine_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        # Atomically filter by both id and user_id so a concurrent delete
        # surfaces as 404 via rowcount=0 rather than a false {"ok": true}.
        cur.execute("DELETE FROM routines WHERE id = ? AND user_id = ?", (routine_id, user_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "Routine not found")
    return {"ok": True}


@router.post("/{routine_id}/exercises", response_model=RoutineExerciseResponse)
def add_exercise(routine_id: int, req: RoutineExerciseCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM routines WHERE id = ? AND user_id = ?", (routine_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Routine not found")
        cur.execute(
            """INSERT INTO routine_exercises
            (routine_id, exercise_id, sort_order, target_sets, target_reps, target_weight,
             target_duration_sec, rest_sec, tempo, keystone, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (routine_id, req.exercise_id, req.sort_order or 0, req.target_sets, req.target_reps,
             req.target_weight, req.target_duration_sec, req.rest_sec, req.tempo,
             bool(req.keystone), req.notes),
        )
        re_id = cur.lastrowid
        cur.execute("SELECT * FROM routine_exercises WHERE id = ?", (re_id,))
        row = cur.fetchone()
        row["keystone"] = bool(row["keystone"])
        row["exercise"] = _load_exercise(cur, row["exercise_id"])
        return row


@router.put("/exercises/{routine_exercise_id}", response_model=RoutineExerciseResponse)
def update_routine_exercise(
    routine_exercise_id: int,
    req: RoutineExerciseUpdate,
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT re.id FROM routine_exercises re
            JOIN routines r ON r.id = re.routine_id
            WHERE re.id = ? AND r.user_id = ?
        """, (routine_exercise_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Not found")
        fields = req.model_dump(exclude_unset=True)
        if "keystone" in fields and fields["keystone"] is not None:
            fields["keystone"] = bool(fields["keystone"])
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            cur.execute(
                f"UPDATE routine_exercises SET {sets} WHERE id = ?",
                tuple(list(fields.values()) + [routine_exercise_id]),
            )
        cur.execute("SELECT * FROM routine_exercises WHERE id = ?", (routine_exercise_id,))
        row = cur.fetchone()
        row["keystone"] = bool(row["keystone"])
        row["exercise"] = _load_exercise(cur, row["exercise_id"])
        return row


@router.post("/{routine_id}/reorder", response_model=RoutineResponse)
def reorder_exercises(
    routine_id: int,
    req: RoutineReorderRequest,
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM routines WHERE id = ? AND user_id = ?", (routine_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Routine not found")
        for i, re_id in enumerate(req.routine_exercise_ids):
            cur.execute(
                "UPDATE routine_exercises SET sort_order = ? WHERE id = ? AND routine_id = ?",
                (i, re_id, routine_id),
            )
        cur.execute("SELECT * FROM routines WHERE id = ?", (routine_id,))
        return _hydrate_routine(cur, cur.fetchone())


class SuggestionResponse(BaseModel):
    routine_exercise_id: int
    exercise_id: int
    reps: Optional[int] = None
    weight: Optional[float] = None
    duration_sec: Optional[int] = None
    reason: str = ""


@router.get("/{routine_id}/suggestions", response_model=list[SuggestionResponse])
def get_suggestions(routine_id: int, user_id: int = Depends(get_current_user_id)):
    """Per-routine-exercise suggested targets derived from the user's most
    recent session for that exercise. Conservative: ≤5% load or ±15s. Used
    to pre-fill the session screen and surface a hint on the routine detail."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM routines WHERE id = ? AND user_id = ?",
                    (routine_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Routine not found")

        cur.execute("""
            SELECT re.*, e.measurement, e.is_bodyweight
            FROM routine_exercises re
            JOIN exercises e ON e.id = re.exercise_id
            WHERE re.routine_id = ?
            ORDER BY re.sort_order ASC, re.id ASC
        """, (routine_id,))
        re_rows = cur.fetchall()
        if not re_rows:
            return []

        ex_ids = [r["exercise_id"] for r in re_rows]
        # Pull all sets by this user for these exercises (newest first).
        # Limit to last 30 sessions to keep the query bounded.
        placeholders = ",".join("?" for _ in ex_ids)
        cur.execute(f"""
            SELECT s.exercise_id, s.session_id, s.reps, s.weight, s.duration_sec,
                   s.distance_m, s.rpe, ws.started_at
            FROM session_sets s
            JOIN workout_sessions ws ON ws.id = s.session_id
            WHERE ws.user_id = ? AND s.exercise_id IN ({placeholders})
            ORDER BY ws.started_at DESC, ws.id DESC, s.set_number ASC
            LIMIT 500
        """, tuple([user_id, *ex_ids]))
        all_sets = cur.fetchall()

    # Bucket sets by exercise_id, preserving newest-first order.
    by_ex: dict[int, list[dict]] = {}
    for s in all_sets:
        by_ex.setdefault(s["exercise_id"], []).append(dict(s))

    out: list[SuggestionResponse] = []
    for re in re_rows:
        s: Suggestion = compute_suggest(
            measurement=re["measurement"],
            target_reps=re["target_reps"],
            target_weight=re["target_weight"],
            target_duration_sec=re["target_duration_sec"],
            is_bodyweight=bool(re["is_bodyweight"]),
            last_sets=by_ex.get(re["exercise_id"], []),
        )
        out.append(SuggestionResponse(
            routine_exercise_id=re["id"],
            exercise_id=re["exercise_id"],
            reps=s.reps, weight=s.weight, duration_sec=s.duration_sec,
            reason=s.reason,
        ))
    return out


@router.delete("/exercises/{routine_exercise_id}")
def remove_exercise(routine_exercise_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT re.id FROM routine_exercises re
            JOIN routines r ON r.id = re.routine_id
            WHERE re.id = ? AND r.user_id = ?
        """, (routine_exercise_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Not found")
        cur.execute("DELETE FROM routine_exercises WHERE id = ?", (routine_exercise_id,))
    return {"ok": True}

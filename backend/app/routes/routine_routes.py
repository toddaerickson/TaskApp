from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user_id
from pydantic import BaseModel
from typing import Optional
from app.models import (
    RoutineCreate, RoutineUpdate, RoutineResponse,
    RoutineExerciseCreate, RoutineExerciseResponse,
)


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
    cur.execute("SELECT * FROM exercises WHERE id = ?", (exercise_id,))
    ex = cur.fetchone()
    if not ex:
        return None
    ex["is_bodyweight"] = bool(ex["is_bodyweight"])
    cur.execute(
        "SELECT id, url, caption, sort_order FROM exercise_images "
        "WHERE exercise_id = ? ORDER BY sort_order ASC",
        (exercise_id,),
    )
    ex["images"] = cur.fetchall()
    return ex


def _load_routine_exercises(cur, routine_id: int) -> list[dict]:
    cur.execute(
        "SELECT * FROM routine_exercises WHERE routine_id = ? ORDER BY sort_order ASC, id ASC",
        (routine_id,),
    )
    rows = cur.fetchall()
    for r in rows:
        r["keystone"] = bool(r["keystone"])
        r["exercise"] = _load_exercise(cur, r["exercise_id"])
    return rows


def _hydrate_routine(cur, row: dict) -> dict:
    row["exercises"] = _load_routine_exercises(cur, row["id"])
    return row


@router.get("", response_model=list[RoutineResponse])
def list_routines(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM routines WHERE user_id = ? ORDER BY sort_order ASC, id ASC",
            (user_id,),
        )
        return [_hydrate_routine(cur, r) for r in cur.fetchall()]


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
            "INSERT INTO routines (user_id, name, goal, notes, sort_order) VALUES (?, ?, ?, ?, ?)",
            (user_id, req.name, req.goal, req.notes, req.sort_order or 0),
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
                 ex.rest_sec, ex.tempo, int(bool(ex.keystone)), ex.notes),
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
        cur.execute("SELECT id FROM routines WHERE id = ? AND user_id = ?", (routine_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Routine not found")
        cur.execute("DELETE FROM routines WHERE id = ?", (routine_id,))
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
             int(bool(req.keystone)), req.notes),
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
            fields["keystone"] = int(bool(fields["keystone"]))
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

import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_db
from app.auth import get_current_user_id
from app.models import (
    SessionCreate, SessionUpdate, SessionResponse,
    SessionSetCreate, SessionSetResponse,
    SymptomLogCreate, SymptomLogResponse,
)
from app.hydrate import hydrate_sessions_full

router = APIRouter(tags=["sessions"])


def _hydrate(cur, row: dict) -> dict:
    hydrate_sessions_full(cur, [row])
    return row


@router.post("/sessions", response_model=SessionResponse)
def start_session(req: SessionCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        if req.routine_id is not None:
            cur.execute("SELECT id FROM routines WHERE id = ? AND user_id = ?",
                        (req.routine_id, user_id))
            if not cur.fetchone():
                raise HTTPException(404, "Routine not found")
        cur.execute(
            "INSERT INTO workout_sessions (user_id, routine_id, notes) VALUES (?, ?, ?)",
            (user_id, req.routine_id, req.notes),
        )
        sid = cur.lastrowid
        cur.execute("SELECT * FROM workout_sessions WHERE id = ?", (sid,))
        return _hydrate(cur, cur.fetchone())


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    limit: int = Query(50, ge=1, le=200),
    routine_id: int | None = None,
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        sql = "SELECT * FROM workout_sessions WHERE user_id = ?"
        params: list = [user_id]
        if routine_id is not None:
            sql += " AND routine_id = ?"
            params.append(routine_id)
        sql += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        cur.execute(sql, tuple(params))
        return hydrate_sessions_full(cur, cur.fetchall())


@router.get("/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?",
                    (session_id, user_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Session not found")
        return _hydrate(cur, row)


@router.put("/sessions/{session_id}", response_model=SessionResponse)
def update_session(session_id: int, req: SessionUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?",
                    (session_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Session not found")
        fields = req.model_dump(exclude_unset=True)
        if "ended_at" in fields and fields["ended_at"] is not None:
            fields["ended_at"] = fields["ended_at"].isoformat()
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            cur.execute(f"UPDATE workout_sessions SET {sets} WHERE id = ?",
                        tuple(list(fields.values()) + [session_id]))
        cur.execute("SELECT * FROM workout_sessions WHERE id = ?", (session_id,))
        return _hydrate(cur, cur.fetchone())


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?",
                    (session_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Session not found")
        cur.execute("DELETE FROM workout_sessions WHERE id = ?", (session_id,))
    return {"ok": True}


@router.post("/sessions/{session_id}/sets", response_model=SessionSetResponse)
def log_set(session_id: int, req: SessionSetCreate, user_id: int = Depends(get_current_user_id)):
    """Log a set. set_number is server-assigned when omitted. Retries on
    concurrent-double-tap races (UNIQUE index collision)."""
    completed = int(bool(req.completed if req.completed is not None else True))
    for attempt in range(10):
        try:
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute("SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?",
                            (session_id, user_id))
                if not cur.fetchone():
                    raise HTTPException(404, "Session not found")
                if req.set_number is None:
                    cur.execute(
                        "SELECT COALESCE(MAX(set_number), 0) + 1 AS n FROM session_sets "
                        "WHERE session_id = ? AND exercise_id = ?",
                        (session_id, req.exercise_id),
                    )
                    set_number = cur.fetchone()["n"]
                else:
                    set_number = req.set_number
                cur.execute(
                    """INSERT INTO session_sets
                    (session_id, exercise_id, set_number, reps, weight, duration_sec,
                     distance_m, rpe, completed, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (session_id, req.exercise_id, set_number, req.reps, req.weight,
                     req.duration_sec, req.distance_m, req.rpe, completed, req.notes),
                )
                set_id = cur.lastrowid
                cur.execute("SELECT * FROM session_sets WHERE id = ?", (set_id,))
                row = cur.fetchone()
                row["completed"] = bool(row["completed"])
                return row
        except sqlite3.IntegrityError:
            # Concurrent insert chose the same set_number — retry with a fresh
            # read of MAX. Only retry when the client didn't pin a number.
            if req.set_number is not None or attempt >= 9:
                raise HTTPException(409, "Conflict logging set; retry")
            continue
    raise HTTPException(500, "Unable to assign set number after retries")


@router.delete("/sessions/sets/{set_id}")
def delete_set(set_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT s.id FROM session_sets s
            JOIN workout_sessions ws ON ws.id = s.session_id
            WHERE s.id = ? AND ws.user_id = ?
        """, (set_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Set not found")
        cur.execute("DELETE FROM session_sets WHERE id = ?", (set_id,))
    return {"ok": True}


# --- Symptom logs ---

@router.post("/symptoms", response_model=SymptomLogResponse)
def log_symptom(req: SymptomLogCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        if req.session_id is not None:
            cur.execute("SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?",
                        (req.session_id, user_id))
            if not cur.fetchone():
                raise HTTPException(404, "Session not found")
        cur.execute(
            "INSERT INTO symptom_logs (user_id, session_id, body_part, severity, notes) "
            "VALUES (?, ?, ?, ?, ?)",
            (user_id, req.session_id, req.body_part, req.severity, req.notes),
        )
        sid = cur.lastrowid
        cur.execute("SELECT * FROM symptom_logs WHERE id = ?", (sid,))
        return cur.fetchone()


@router.get("/symptoms", response_model=list[SymptomLogResponse])
def list_symptoms(
    body_part: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        sql = "SELECT * FROM symptom_logs WHERE user_id = ?"
        params: list = [user_id]
        if body_part:
            sql += " AND body_part = ?"
            params.append(body_part)
        sql += " ORDER BY logged_at DESC LIMIT ?"
        params.append(limit)
        cur.execute(sql, tuple(params))
        return cur.fetchall()

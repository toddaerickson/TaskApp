from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_db, is_unique_violation
from app.auth import get_current_user_id
from app.models import (
    SessionCreate, SessionUpdate, SessionResponse,
    SessionSetCreate, SessionSetResponse, SessionSetUpdate,
    SymptomLogCreate, SymptomLogResponse,
    ExerciseBest,
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
        # Default: no-routine (ad-hoc) sessions don't track symptoms.
        tracks_symptoms = False
        if req.routine_id is not None:
            cur.execute(
                "SELECT id, tracks_symptoms FROM routines WHERE id = ? AND user_id = ?",
                (req.routine_id, user_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Routine not found")
            # Snapshot the flag onto the session. Changing it on the
            # routine later won't mutate this row, so a rehab session
            # started today stays a rehab session even if the user
            # flips the flag off tomorrow.
            tracks_symptoms = bool(row["tracks_symptoms"])
        cur.execute(
            "INSERT INTO workout_sessions (user_id, routine_id, notes, tracks_symptoms) "
            "VALUES (?, ?, ?, ?)",
            (user_id, req.routine_id, req.notes, int(tracks_symptoms)),
        )
        sid = cur.lastrowid
        cur.execute("SELECT * FROM workout_sessions WHERE id = ?", (sid,))
        return _hydrate(cur, cur.fetchone())


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    limit: int = Query(50, ge=1, le=200),
    cursor: int | None = Query(
        None,
        description="Session id from the previous page's last item. Returns "
                    "sessions with id < cursor (newest-first).",
    ),
    routine_id: int | None = None,
    user_id: int = Depends(get_current_user_id),
):
    """List a user's sessions, newest first. Paginated: `limit` caps page
    size (default 50, max 200), `cursor` is the id of the last session on
    the prior page — the server returns id < cursor on the next call.
    Uses id for the cursor (monotonic with `started_at`) so pagination is
    stable even if two sessions start in the same second."""
    with get_db() as conn:
        cur = conn.cursor()
        sql = "SELECT * FROM workout_sessions WHERE user_id = ?"
        params: list = [user_id]
        if routine_id is not None:
            sql += " AND routine_id = ?"
            params.append(routine_id)
        if cursor is not None:
            sql += " AND id < ?"
            params.append(cursor)
        sql += " ORDER BY id DESC LIMIT ?"
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


@router.get("/sessions/{session_id}/prs", response_model=list[ExerciseBest])
def get_session_prs(session_id: int, user_id: int = Depends(get_current_user_id)):
    """Historical per-exercise bests for this user *prior* to this session.
    Excludes sets from this session itself so the client can walk the
    current session's sets forward and decide which ones set new PRs."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT routine_id FROM workout_sessions WHERE id = ? AND user_id = ?",
                    (session_id, user_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Session not found")
        routine_id = row["routine_id"]

        # Exercises of interest: anything already logged in this session,
        # plus anything still queued from the routine plan. The UNION keeps
        # the result set small even when a session has no linked routine.
        if routine_id is not None:
            cur.execute("""
                SELECT DISTINCT exercise_id FROM session_sets WHERE session_id = ?
                UNION
                SELECT exercise_id FROM routine_exercises WHERE routine_id = ?
            """, (session_id, routine_id))
        else:
            cur.execute(
                "SELECT DISTINCT exercise_id FROM session_sets WHERE session_id = ?",
                (session_id,),
            )
        ex_ids = [r["exercise_id"] for r in cur.fetchall()]
        if not ex_ids:
            return []

        placeholders = ",".join("?" for _ in ex_ids)
        # `completed` is BOOLEAN on Postgres and stored 1/0 on SQLite — pass
        # a Python True through the param machinery so psycopg2 adapts it
        # to a real boolean and sqlite writes 1. Avoids the cross-DB pitfall
        # of comparing boolean to an integer literal.
        cur.execute(f"""
            SELECT s.exercise_id,
                   MAX(s.weight) AS max_weight,
                   MAX(s.reps) AS max_reps,
                   MAX(s.duration_sec) AS max_duration_sec
            FROM session_sets s
            JOIN workout_sessions ws ON ws.id = s.session_id
            WHERE ws.user_id = ?
              AND s.exercise_id IN ({placeholders})
              AND s.session_id != ?
              AND s.completed = ?
            GROUP BY s.exercise_id
        """, tuple([user_id, *ex_ids, session_id, True]))
        bests = {r["exercise_id"]: dict(r) for r in cur.fetchall()}

    # Ensure every exercise of interest shows up, even if there's no prior
    # history — null bests make the "first attempt is a PR" case explicit.
    return [
        ExerciseBest(
            exercise_id=eid,
            max_weight=bests.get(eid, {}).get("max_weight"),
            max_reps=bests.get(eid, {}).get("max_reps"),
            max_duration_sec=bests.get(eid, {}).get("max_duration_sec"),
        )
        for eid in ex_ids
    ]


_SESSION_UPDATE_COLUMNS = {"ended_at", "rpe", "mood", "notes"}


@router.put("/sessions/{session_id}", response_model=SessionResponse)
def update_session(session_id: int, req: SessionUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?",
                    (session_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Session not found")
        # Allow-list the columns so the dynamic UPDATE can never
        # interpolate a column name that wasn't hand-approved here.
        fields = {
            k: v for k, v in req.model_dump(exclude_unset=True).items()
            if k in _SESSION_UPDATE_COLUMNS
        }
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
    completed = bool(req.completed) if req.completed is not None else True
    for attempt in range(10):
        try:
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT id, tracks_symptoms FROM workout_sessions "
                    "WHERE id = ? AND user_id = ?",
                    (session_id, user_id),
                )
                session_row = cur.fetchone()
                if not session_row:
                    raise HTTPException(404, "Session not found")
                # Only persist pain_score when the session was started
                # under a pain-monitored routine. Strength sessions that
                # stray a value through the client get silently dropped
                # so later suggestion runs don't see phantom pain data.
                pain_score = req.pain_score if session_row["tracks_symptoms"] else None
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
                     distance_m, rpe, pain_score, completed, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (session_id, req.exercise_id, set_number, req.reps, req.weight,
                     req.duration_sec, req.distance_m, req.rpe, pain_score,
                     completed, req.notes),
                )
                set_id = cur.lastrowid
                cur.execute("SELECT * FROM session_sets WHERE id = ?", (set_id,))
                row = cur.fetchone()
                row["completed"] = bool(row["completed"])
                return row
        except Exception as exc:
            if not is_unique_violation(exc):
                raise
            # Concurrent insert chose the same set_number — retry with a fresh
            # read of MAX. Only retry when the client didn't pin a number.
            if req.set_number is not None or attempt >= 9:
                raise HTTPException(409, "Conflict logging set; retry")
            continue
    raise HTTPException(500, "Unable to assign set number after retries")


_SESSION_SET_UPDATE_COLUMNS = {"pain_score", "notes"}


@router.patch("/sessions/sets/{set_id}", response_model=SessionSetResponse)
def patch_set(
    set_id: int,
    req: SessionSetUpdate,
    user_id: int = Depends(get_current_user_id),
):
    """Backfill-friendly update for a logged set. The primary caller is
    the per-exercise pain chip, which fires *after* the last set of an
    exercise is already persisted. Keeping this on a separate endpoint
    (vs extending POST) means the chip doesn't need to know which set
    was the last one — the client hits the most-recent set id with just
    pain_score in the body.

    pain_score is only persisted when the parent session has
    tracks_symptoms=TRUE; strength sessions silently drop the value
    (mirrors log_set's guard) so stray client values can't pollute
    later suggestions.
    """
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT s.id, ws.tracks_symptoms FROM session_sets s "
            "JOIN workout_sessions ws ON ws.id = s.session_id "
            "WHERE s.id = ? AND ws.user_id = ?",
            (set_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Set not found")
        fields = {
            k: v for k, v in req.model_dump(exclude_unset=True).items()
            if k in _SESSION_SET_UPDATE_COLUMNS
        }
        if "pain_score" in fields and not row["tracks_symptoms"]:
            # Strength session — drop the value rather than writing it.
            fields.pop("pain_score")
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            cur.execute(
                f"UPDATE session_sets SET {sets} WHERE id = ?",
                tuple(list(fields.values()) + [set_id]),
            )
        cur.execute("SELECT * FROM session_sets WHERE id = ?", (set_id,))
        updated = cur.fetchone()
        updated["completed"] = bool(updated["completed"])
        return updated


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

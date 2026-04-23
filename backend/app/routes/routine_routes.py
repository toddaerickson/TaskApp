from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from app.database import get_db
from app.auth import get_current_user_id
from pydantic import BaseModel, Field
from typing import Optional
from app.models import (
    RoutineCreate, RoutineUpdate, RoutineResponse,
    RoutineExerciseCreate, RoutineExerciseResponse,
    RoutineImportRequest,
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
    # Target RPE 1-10, Null clears it. Bounded so stale clients can't
    # punch in a 42 and have it stick.
    target_rpe: Optional[int] = Field(default=None, ge=1, le=10)
    # See RoutineUpdate.expected_updated_at — same story for per-exercise rows.
    expected_updated_at: Optional[datetime] = None


def _parse_ts(v) -> Optional[datetime]:
    """Coerce a DB timestamp (SQLite TEXT or PG datetime) into a timezone-
    aware datetime for comparison. SQLite stores 'YYYY-MM-DD HH:MM:SS' UTC;
    Postgres returns a proper datetime already. NULL (legacy rows without
    updated_at) becomes None and opts the row out of the conflict check."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        s = v.replace("T", " ").rstrip("Z")
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return None


def _conflict(current: Optional[datetime], expected: Optional[datetime]) -> bool:
    """Row has moved past the client's snapshot. NULL current (legacy) opts
    out. NULL expected (client didn't send one) also opts out — this is an
    opt-in check so existing callers aren't broken. Compare at second
    granularity because SQLite's datetime('now') truncates to seconds;
    a round-trip through Pydantic that preserves microseconds would
    otherwise trip a false positive."""
    if expected is None or current is None:
        return False
    return current.replace(microsecond=0) > expected.replace(microsecond=0)


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
               (user_id, name, goal, notes, sort_order, reminder_time, reminder_days,
                tracks_symptoms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, req.name, req.goal, req.notes, req.sort_order or 0,
             req.reminder_time, req.reminder_days,
             # Pass a Python bool — psycopg2 adapts to PG BOOLEAN natively,
             # and SQLite's driver coerces True/False to 1/0 for INTEGER.
             # int() coercion would send 0/1 ints into PG BOOLEAN and fail.
             bool(req.tracks_symptoms)),
        )
        rid = cur.lastrowid
        for idx, ex in enumerate(req.exercises or []):
            cur.execute(
                """INSERT INTO routine_exercises
                (routine_id, exercise_id, sort_order, target_sets, target_reps, target_weight,
                 target_duration_sec, rest_sec, tempo, keystone, notes, target_rpe)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (rid, ex.exercise_id, ex.sort_order if ex.sort_order is not None else idx,
                 ex.target_sets, ex.target_reps, ex.target_weight, ex.target_duration_sec,
                 ex.rest_sec, ex.tempo, bool(ex.keystone), ex.notes, ex.target_rpe),
            )
        cur.execute("SELECT * FROM routines WHERE id = ?", (rid,))
        return _hydrate_routine(cur, cur.fetchone())


@router.post("/{routine_id}/clone", response_model=RoutineResponse)
def clone_routine(routine_id: int, user_id: int = Depends(get_current_user_id)):
    """Deep-copy a routine the user owns: the routines row and all
    routine_exercises. Session history is NOT copied — the clone is a
    fresh template. The new routine's name is "{original} (copy)" so
    the user can recognise it in the list without retyping anything.

    Runs in a single transaction (get_db commits on success, rolls back
    on exception) so a failure mid-copy never leaves a zombie routine
    without its exercises."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM routines WHERE id = ? AND user_id = ?",
            (routine_id, user_id),
        )
        src = cur.fetchone()
        if not src:
            raise HTTPException(404, "Routine not found")

        # Insert the new routines row. Reminders are not copied (a
        # duplicated reminder is almost always noise).
        cur.execute(
            """INSERT INTO routines
               (user_id, name, goal, notes, sort_order, tracks_symptoms)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                f"{src['name']} (copy)",
                src["goal"],
                src["notes"],
                src["sort_order"] or 0,
                bool(src["tracks_symptoms"]),
            ),
        )
        new_id = cur.lastrowid

        # Exercises in source order.
        cur.execute(
            "SELECT * FROM routine_exercises WHERE routine_id = ? "
            "ORDER BY sort_order ASC, id ASC",
            (routine_id,),
        )
        for re in cur.fetchall():
            cur.execute(
                """INSERT INTO routine_exercises
                (routine_id, exercise_id, sort_order, target_sets, target_reps,
                 target_weight, target_duration_sec, rest_sec, tempo, keystone,
                 notes, target_rpe)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    new_id, re["exercise_id"], re["sort_order"],
                    re["target_sets"], re["target_reps"], re["target_weight"],
                    re["target_duration_sec"], re["rest_sec"], re["tempo"],
                    bool(re["keystone"]), re["notes"],
                    re.get("target_rpe"),
                ),
            )

        cur.execute("SELECT * FROM routines WHERE id = ?", (new_id,))
        return _hydrate_routine(cur, cur.fetchone())


@router.post("/import", response_model=RoutineResponse)
def import_routine(req: RoutineImportRequest, user_id: int = Depends(get_current_user_id)):
    """Create a routine from a portable JSON template. Resolves slugs to
    exercise ids (rejecting unknown slugs), then creates routine_exercises.
    All-or-nothing: a single bad slug 400s before any rows are written,
    so the user never lands with a half-imported routine."""
    if not req.exercises:
        raise HTTPException(400, "Routine must include at least one exercise")

    slugs = [ex.slug for ex in req.exercises]
    with get_db() as conn:
        cur = conn.cursor()

        # Resolve slugs in one query. NULL user_id = global library; we
        # also allow the importing user's own custom exercises.
        placeholders = ",".join("?" for _ in slugs)
        cur.execute(
            f"SELECT id, slug, measurement FROM exercises "
            f"WHERE slug IN ({placeholders}) "
            f"AND (user_id IS NULL OR user_id = ?)",
            tuple(slugs) + (user_id,),
        )
        slug_to_row = {r["slug"]: r for r in cur.fetchall()}
        missing = [s for s in slugs if s not in slug_to_row]
        if missing:
            raise HTTPException(
                400, f"Unknown exercise slug(s): {', '.join(sorted(set(missing)))}"
            )

        # Validate measurement compatibility before writing.
        for i, ex in enumerate(req.exercises):
            row = slug_to_row[ex.slug]
            measurement = row["measurement"]
            has_reps = ex.target_reps is not None
            has_dur = ex.target_duration_sec is not None
            if measurement == "duration" and not has_dur:
                raise HTTPException(
                    400, f"'{ex.slug}' is a duration exercise — set target_duration_sec"
                )
            if measurement in ("reps", "reps_weight") and not has_reps:
                raise HTTPException(
                    400, f"'{ex.slug}' is a reps exercise — set target_reps"
                )

        # Insert routine + exercises in one transaction (get_db commits
        # on success, rolls back on exception).
        cur.execute(
            """INSERT INTO routines
               (user_id, name, goal, notes, sort_order)
               VALUES (?, ?, ?, ?, 0)""",
            (user_id, req.name, req.goal or "general", req.notes),
        )
        rid = cur.lastrowid

        for idx, ex in enumerate(req.exercises):
            cur.execute(
                """INSERT INTO routine_exercises
                (routine_id, exercise_id, sort_order, target_sets, target_reps,
                 target_weight, target_duration_sec, rest_sec, tempo, keystone,
                 notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (rid, slug_to_row[ex.slug]["id"], idx,
                 ex.target_sets, ex.target_reps, ex.target_weight,
                 ex.target_duration_sec, ex.rest_sec, ex.tempo,
                 bool(ex.keystone), ex.notes),
            )

        cur.execute("SELECT * FROM routines WHERE id = ?", (rid,))
        return _hydrate_routine(cur, cur.fetchone())


_ROUTINE_UPDATE_COLUMNS = {
    "name", "goal", "notes", "sort_order",
    "reminder_time", "reminder_days",
    "tracks_symptoms", "updated_at",
}


@router.put("/{routine_id}", response_model=RoutineResponse)
def update_routine(routine_id: int, req: RoutineUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT updated_at FROM routines WHERE id = ? AND user_id = ?",
            (routine_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Routine not found")

        # Optimistic concurrency: if the client sent expected_updated_at
        # and the row has moved past it, 409 with the current row embedded
        # so the client can reconcile in one round-trip.
        fields = req.model_dump(exclude_unset=True)
        expected = fields.pop("expected_updated_at", None)
        if _conflict(_parse_ts(row["updated_at"]), _parse_ts(expected)):
            cur.execute("SELECT * FROM routines WHERE id = ?", (routine_id,))
            current = _hydrate_routine(cur, cur.fetchone())
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "conflict",
                    "detail": "Routine changed since you loaded it.",
                    "current": jsonable_encoder(current),
                },
            )

        if fields:
            # Always bump updated_at alongside the caller's fields.
            fields["updated_at"] = datetime.now(timezone.utc).isoformat(sep=" ", timespec="seconds")
            # Allow-list the columns — hardens the dynamic UPDATE against
            # a future Pydantic config that lets extra fields through.
            fields = {k: v for k, v in fields.items() if k in _ROUTINE_UPDATE_COLUMNS}
            if "tracks_symptoms" in fields:
                fields["tracks_symptoms"] = bool(fields["tracks_symptoms"])
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
             target_duration_sec, rest_sec, tempo, keystone, notes, target_rpe)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (routine_id, req.exercise_id, req.sort_order or 0, req.target_sets, req.target_reps,
             req.target_weight, req.target_duration_sec, req.rest_sec, req.tempo,
             bool(req.keystone), req.notes, req.target_rpe),
        )
        re_id = cur.lastrowid
        cur.execute("SELECT * FROM routine_exercises WHERE id = ?", (re_id,))
        row = cur.fetchone()
        row["keystone"] = bool(row["keystone"])
        row["exercise"] = _load_exercise(cur, row["exercise_id"])
        return row


_ROUTINE_EXERCISE_UPDATE_COLUMNS = {
    "sort_order", "target_sets", "target_reps", "target_weight",
    "target_duration_sec", "rest_sec", "tempo", "keystone", "notes",
    "target_rpe", "updated_at",
}


@router.put("/exercises/{routine_exercise_id}", response_model=RoutineExerciseResponse)
def update_routine_exercise(
    routine_exercise_id: int,
    req: RoutineExerciseUpdate,
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT re.id, re.routine_id, re.updated_at FROM routine_exercises re
            JOIN routines r ON r.id = re.routine_id
            WHERE re.id = ? AND r.user_id = ?
        """, (routine_exercise_id, user_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        fields = req.model_dump(exclude_unset=True)
        expected = fields.pop("expected_updated_at", None)
        if _conflict(_parse_ts(row["updated_at"]), _parse_ts(expected)):
            cur.execute("SELECT * FROM routine_exercises WHERE id = ?", (routine_exercise_id,))
            current = cur.fetchone()
            current["keystone"] = bool(current["keystone"])
            current["exercise"] = _load_exercise(cur, current["exercise_id"])
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "conflict",
                    "detail": "Exercise changed since you loaded it.",
                    "current": jsonable_encoder(current),
                },
            )
        if "keystone" in fields and fields["keystone"] is not None:
            fields["keystone"] = bool(fields["keystone"])
        # Allow-list the columns that can be updated — protects the
        # dynamic UPDATE from future Pydantic configs that let extra
        # fields through.
        fields = {k: v for k, v in fields.items() if k in _ROUTINE_EXERCISE_UPDATE_COLUMNS}
        if fields:
            fields["updated_at"] = datetime.now(timezone.utc).isoformat(sep=" ", timespec="seconds")
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
    # Which policy produced this suggestion: "silbernagel" when pain-
    # monitored progression fired, null when the default RPE path ran.
    # Lets clients render a small badge ("Pain-based") next to the row.
    policy: Optional[str] = None
    # The max pain score across the last session's sets, when Silbernagel
    # ran. Null otherwise. Used by the UI to show "Pain 2/10" inline.
    pain_last: Optional[int] = None


@router.get("/{routine_id}/suggestions", response_model=list[SuggestionResponse])
def get_suggestions(routine_id: int, user_id: int = Depends(get_current_user_id)):
    """Per-routine-exercise suggested targets derived from the user's most
    recent session for that exercise. Conservative: ≤5% load or ±15s. Used
    to pre-fill the session screen and surface a hint on the routine detail.

    When the routine has tracks_symptoms=True the suggestion engine runs
    the Silbernagel pain-monitored policy; otherwise it falls through to
    the existing RPE branch. The flag is read from the routine itself
    (not the last session's snapshot) because suggestions are computed
    *before* the next session exists, so the routine's current intent
    is the right signal.
    """
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, tracks_symptoms FROM routines WHERE id = ? AND user_id = ?",
            (routine_id, user_id),
        )
        routine_row = cur.fetchone()
        if not routine_row:
            raise HTTPException(404, "Routine not found")
        tracks_symptoms = bool(routine_row["tracks_symptoms"])

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
                   s.distance_m, s.rpe, s.pain_score, ws.started_at
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
            tracks_symptoms=tracks_symptoms,
        )
        out.append(SuggestionResponse(
            routine_exercise_id=re["id"],
            exercise_id=re["exercise_id"],
            reps=s.reps, weight=s.weight, duration_sec=s.duration_sec,
            reason=s.reason,
            policy=s.policy,
            pain_last=s.pain_last,
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

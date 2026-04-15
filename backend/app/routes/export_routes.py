"""Export / import a user's workout data as JSON.

Design:
- Exercises are referenced by `slug` when they're global (user_id IS NULL),
  so an import to a different instance resolves against that instance's
  global library. User-owned exercises are exported in full.
- Routines / routine_exercises / sessions / session_sets / symptom_logs
  are scoped to the caller. IDs are local to the source instance and are
  reassigned on import — references within the payload are resolved by
  position in the same export.
- Versioned so future format changes fail loud instead of silent.
"""
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db
from app.auth import get_current_user_id

router = APIRouter(tags=["export"])

EXPORT_VERSION = 1


# ---------- Pydantic wire types ----------

class ExerciseExport(BaseModel):
    slug: Optional[str] = None
    is_global: bool
    name: str
    category: str
    primary_muscle: Optional[str] = None
    equipment: Optional[str] = None
    difficulty: int
    is_bodyweight: bool
    measurement: str
    instructions: Optional[str] = None
    cue: Optional[str] = None
    contraindications: Optional[str] = None
    image_urls: list[str] = []


class RoutineExerciseExport(BaseModel):
    # References an exercise by its slug (for globals) or by position in
    # the same export's exercises[] list (for user-owned).
    exercise_slug: Optional[str] = None
    exercise_index: Optional[int] = None
    sort_order: int = 0
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_weight: Optional[float] = None
    target_duration_sec: Optional[int] = None
    rest_sec: Optional[int] = None
    tempo: Optional[str] = None
    keystone: bool = False
    notes: Optional[str] = None


class RoutineExport(BaseModel):
    name: str
    goal: str
    notes: Optional[str] = None
    sort_order: int = 0
    reminder_time: Optional[str] = None
    reminder_days: Optional[str] = None
    exercises: list[RoutineExerciseExport] = []


class SessionSetExport(BaseModel):
    exercise_slug: Optional[str] = None
    exercise_index: Optional[int] = None
    set_number: int
    reps: Optional[int] = None
    weight: Optional[float] = None
    duration_sec: Optional[int] = None
    distance_m: Optional[float] = None
    rpe: Optional[int] = None
    completed: bool = True
    notes: Optional[str] = None


class SessionExport(BaseModel):
    routine_name: Optional[str] = None  # match-by-name on import; None = ad-hoc session
    started_at: str
    ended_at: Optional[str] = None
    rpe: Optional[int] = None
    mood: Optional[int] = None
    notes: Optional[str] = None
    sets: list[SessionSetExport] = []


class SymptomLogExport(BaseModel):
    body_part: str
    severity: int
    notes: Optional[str] = None
    logged_at: str
    session_index: Optional[int] = None  # optional link to a session in this export


class WorkoutExport(BaseModel):
    version: int = EXPORT_VERSION
    exported_at: str
    exercises: list[ExerciseExport] = []
    routines: list[RoutineExport] = []
    sessions: list[SessionExport] = []
    symptoms: list[SymptomLogExport] = []


class ImportRequest(BaseModel):
    payload: WorkoutExport
    mode: Literal["merge", "replace"] = "merge"
    dry_run: bool = False


class ImportResult(BaseModel):
    exercises_added: int = 0
    exercises_skipped: int = 0
    routines_added: int = 0
    routines_skipped: int = 0
    sessions_added: int = 0
    symptoms_added: int = 0
    warnings: list[str] = []
    dry_run: bool = False


# ---------- Export ----------

@router.get("/export/workouts", response_model=WorkoutExport)
def export_workouts(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()

        # User-owned exercises (globals referenced by slug, so we skip them).
        cur.execute("SELECT * FROM exercises WHERE user_id = ? ORDER BY id", (user_id,))
        user_exercises = cur.fetchall()
        # Image URLs for user-owned exercises only (globals are re-fetched on the target).
        ex_id_to_index: dict[int, int] = {}
        ex_exports: list[ExerciseExport] = []
        for i, e in enumerate(user_exercises):
            cur.execute(
                "SELECT url FROM exercise_images WHERE exercise_id = ? ORDER BY sort_order",
                (e["id"],),
            )
            urls = [r["url"] for r in cur.fetchall()]
            ex_id_to_index[e["id"]] = i
            ex_exports.append(ExerciseExport(
                slug=e["slug"], is_global=False, name=e["name"],
                category=e["category"], primary_muscle=e["primary_muscle"],
                equipment=e["equipment"], difficulty=e["difficulty"],
                is_bodyweight=bool(e["is_bodyweight"]), measurement=e["measurement"],
                instructions=e["instructions"], cue=e["cue"],
                contraindications=e["contraindications"], image_urls=urls,
            ))

        # Map every exercise id (user + global) to a reference for routines/sessions.
        cur.execute("SELECT id, slug, user_id FROM exercises WHERE user_id IS NULL OR user_id = ?",
                    (user_id,))
        ref_by_id: dict[int, dict] = {}
        for r in cur.fetchall():
            if r["user_id"] is None:
                ref_by_id[r["id"]] = {"slug": r["slug"]}
            else:
                ref_by_id[r["id"]] = {"index": ex_id_to_index.get(r["id"])}

        # Routines + their routine_exercises.
        cur.execute("SELECT * FROM routines WHERE user_id = ? ORDER BY sort_order, id",
                    (user_id,))
        routine_rows = cur.fetchall()
        routine_id_to_name: dict[int, str] = {r["id"]: r["name"] for r in routine_rows}
        routine_exports: list[RoutineExport] = []
        for r in routine_rows:
            cur.execute(
                "SELECT * FROM routine_exercises WHERE routine_id = ? ORDER BY sort_order, id",
                (r["id"],),
            )
            re_rows = cur.fetchall()
            re_out = []
            for re in re_rows:
                ref = ref_by_id.get(re["exercise_id"], {})
                re_out.append(RoutineExerciseExport(
                    exercise_slug=ref.get("slug"),
                    exercise_index=ref.get("index"),
                    sort_order=re["sort_order"],
                    target_sets=re["target_sets"], target_reps=re["target_reps"],
                    target_weight=re["target_weight"],
                    target_duration_sec=re["target_duration_sec"],
                    rest_sec=re["rest_sec"], tempo=re["tempo"],
                    keystone=bool(re["keystone"]), notes=re["notes"],
                ))
            routine_exports.append(RoutineExport(
                name=r["name"], goal=r["goal"], notes=r["notes"],
                sort_order=r["sort_order"],
                reminder_time=r["reminder_time"] if "reminder_time" in r.keys() else None,
                reminder_days=r["reminder_days"] if "reminder_days" in r.keys() else None,
                exercises=re_out,
            ))

        # Sessions + sets.
        cur.execute("SELECT * FROM workout_sessions WHERE user_id = ? ORDER BY started_at, id",
                    (user_id,))
        session_rows = cur.fetchall()
        session_id_to_index: dict[int, int] = {}
        session_exports: list[SessionExport] = []
        for i, s in enumerate(session_rows):
            cur.execute("SELECT * FROM session_sets WHERE session_id = ? ORDER BY set_number, id",
                        (s["id"],))
            sets = cur.fetchall()
            set_out = []
            for st in sets:
                ref = ref_by_id.get(st["exercise_id"], {})
                set_out.append(SessionSetExport(
                    exercise_slug=ref.get("slug"),
                    exercise_index=ref.get("index"),
                    set_number=st["set_number"],
                    reps=st["reps"], weight=st["weight"],
                    duration_sec=st["duration_sec"], distance_m=st["distance_m"],
                    rpe=st["rpe"], completed=bool(st["completed"]),
                    notes=st["notes"],
                ))
            session_id_to_index[s["id"]] = i
            session_exports.append(SessionExport(
                routine_name=routine_id_to_name.get(s["routine_id"]) if s["routine_id"] else None,
                started_at=s["started_at"], ended_at=s["ended_at"],
                rpe=s["rpe"], mood=s["mood"], notes=s["notes"],
                sets=set_out,
            ))

        # Symptoms.
        cur.execute("SELECT * FROM symptom_logs WHERE user_id = ? ORDER BY logged_at, id",
                    (user_id,))
        sym_rows = cur.fetchall()
        sym_exports = [
            SymptomLogExport(
                body_part=s["body_part"], severity=s["severity"], notes=s["notes"],
                logged_at=s["logged_at"],
                session_index=session_id_to_index.get(s["session_id"]) if s["session_id"] else None,
            )
            for s in sym_rows
        ]

    return WorkoutExport(
        version=EXPORT_VERSION,
        exported_at=datetime.now(timezone.utc).isoformat(),
        exercises=ex_exports,
        routines=routine_exports,
        sessions=session_exports,
        symptoms=sym_exports,
    )


# ---------- Import ----------

def _resolve_exercise(cur, ref_slug: Optional[str], ref_index: Optional[int],
                     created_user_ids: list[int], user_id: int) -> Optional[int]:
    """Resolve an exercise reference to an id on the target instance."""
    if ref_slug:
        cur.execute(
            "SELECT id FROM exercises WHERE slug = ? AND (user_id IS NULL OR user_id = ?)",
            (ref_slug, user_id),
        )
        row = cur.fetchone()
        if row:
            return row["id"]
        return None
    if ref_index is not None and 0 <= ref_index < len(created_user_ids):
        return created_user_ids[ref_index]
    return None


@router.post("/import/workouts", response_model=ImportResult)
def import_workouts(req: ImportRequest, user_id: int = Depends(get_current_user_id)):
    if req.payload.version != EXPORT_VERSION:
        raise HTTPException(400, f"Unsupported export version {req.payload.version}; expected {EXPORT_VERSION}")

    result = ImportResult(dry_run=req.dry_run)

    with get_db() as conn:
        cur = conn.cursor()

        if req.mode == "replace" and not req.dry_run:
            cur.execute("DELETE FROM symptom_logs WHERE user_id = ?", (user_id,))
            cur.execute(
                "DELETE FROM session_sets WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id = ?)",
                (user_id,),
            )
            cur.execute("DELETE FROM workout_sessions WHERE user_id = ?", (user_id,))
            cur.execute(
                "DELETE FROM routine_exercises WHERE routine_id IN (SELECT id FROM routines WHERE user_id = ?)",
                (user_id,),
            )
            cur.execute("DELETE FROM routines WHERE user_id = ?", (user_id,))
            cur.execute("DELETE FROM exercises WHERE user_id = ?", (user_id,))

        # User-owned exercises. Track the new id in the payload's index order.
        created_user_ex_ids: list[int] = []
        for ex in req.payload.exercises:
            if ex.is_global:
                result.warnings.append(f"Skipping is_global=true entry '{ex.name}' — globals are not imported.")
                created_user_ex_ids.append(-1)
                continue
            # Merge mode: if slug already exists for this user, skip.
            existing_id = None
            if ex.slug:
                cur.execute(
                    "SELECT id FROM exercises WHERE slug = ? AND user_id = ?",
                    (ex.slug, user_id),
                )
                row = cur.fetchone()
                if row:
                    existing_id = row["id"]
            if existing_id is not None:
                result.exercises_skipped += 1
                created_user_ex_ids.append(existing_id)
                continue
            if req.dry_run:
                created_user_ex_ids.append(-1)
                result.exercises_added += 1
                continue
            cur.execute(
                """INSERT INTO exercises (user_id, name, slug, category, primary_muscle,
                    equipment, difficulty, is_bodyweight, measurement, instructions, cue, contraindications)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user_id, ex.name, ex.slug, ex.category, ex.primary_muscle,
                 ex.equipment, ex.difficulty, int(ex.is_bodyweight),
                 ex.measurement, ex.instructions, ex.cue, ex.contraindications),
            )
            new_id = cur.lastrowid
            for i, url in enumerate(ex.image_urls):
                cur.execute(
                    "INSERT INTO exercise_images (exercise_id, url, sort_order) VALUES (?, ?, ?)",
                    (new_id, url, i),
                )
            created_user_ex_ids.append(new_id)
            result.exercises_added += 1

        # Routines. Merge mode: skip by (user_id, name) if it already exists.
        routine_name_to_id: dict[str, int] = {}
        for r in req.payload.routines:
            if req.mode == "merge":
                cur.execute(
                    "SELECT id FROM routines WHERE user_id = ? AND name = ?",
                    (user_id, r.name),
                )
                existing = cur.fetchone()
                if existing:
                    routine_name_to_id[r.name] = existing["id"]
                    result.routines_skipped += 1
                    continue
            if req.dry_run:
                result.routines_added += 1
                continue
            cur.execute(
                """INSERT INTO routines
                   (user_id, name, goal, notes, sort_order, reminder_time, reminder_days)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user_id, r.name, r.goal, r.notes, r.sort_order,
                 r.reminder_time, r.reminder_days),
            )
            rid = cur.lastrowid
            routine_name_to_id[r.name] = rid
            for re in r.exercises:
                ex_id = _resolve_exercise(cur, re.exercise_slug, re.exercise_index,
                                           created_user_ex_ids, user_id)
                if ex_id is None:
                    result.warnings.append(
                        f"Routine '{r.name}': skipped exercise reference "
                        f"slug={re.exercise_slug} index={re.exercise_index} (not found)."
                    )
                    continue
                cur.execute(
                    """INSERT INTO routine_exercises
                        (routine_id, exercise_id, sort_order, target_sets, target_reps,
                         target_weight, target_duration_sec, rest_sec, tempo, keystone, notes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (rid, ex_id, re.sort_order, re.target_sets, re.target_reps,
                     re.target_weight, re.target_duration_sec, re.rest_sec, re.tempo,
                     int(re.keystone), re.notes),
                )
            result.routines_added += 1

        # Sessions + sets. Always appended (no dedupe — timestamps differ).
        session_index_to_id: dict[int, int] = {}
        for i, s in enumerate(req.payload.sessions):
            routine_id = routine_name_to_id.get(s.routine_name) if s.routine_name else None
            if req.dry_run:
                result.sessions_added += 1
                continue
            cur.execute(
                """INSERT INTO workout_sessions (user_id, routine_id, started_at, ended_at, rpe, mood, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user_id, routine_id, s.started_at, s.ended_at, s.rpe, s.mood, s.notes),
            )
            sid = cur.lastrowid
            session_index_to_id[i] = sid
            for st in s.sets:
                ex_id = _resolve_exercise(cur, st.exercise_slug, st.exercise_index,
                                           created_user_ex_ids, user_id)
                if ex_id is None:
                    result.warnings.append(
                        f"Session {i}: skipped set referencing unknown exercise "
                        f"slug={st.exercise_slug} index={st.exercise_index}."
                    )
                    continue
                cur.execute(
                    """INSERT INTO session_sets (session_id, exercise_id, set_number, reps, weight,
                        duration_sec, distance_m, rpe, completed, notes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (sid, ex_id, st.set_number, st.reps, st.weight,
                     st.duration_sec, st.distance_m, st.rpe, int(st.completed), st.notes),
                )
            result.sessions_added += 1

        # Symptoms.
        for sym in req.payload.symptoms:
            session_ref = session_index_to_id.get(sym.session_index) if sym.session_index is not None else None
            if req.dry_run:
                result.symptoms_added += 1
                continue
            cur.execute(
                "INSERT INTO symptom_logs (user_id, session_id, body_part, severity, notes, logged_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, session_ref, sym.body_part, sym.severity, sym.notes, sym.logged_at),
            )
            result.symptoms_added += 1

    return result

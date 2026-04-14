from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_db
from app.auth import get_current_user_id
from app.models import (
    ExerciseCreate, ExerciseUpdate, ExerciseResponse,
    ExerciseImageCreate, ExerciseImageResponse,
    BulkImageRequest, BulkImageResult,
)
from app.hydrate import hydrate_exercises_with_images

router = APIRouter(prefix="/exercises", tags=["exercises"])


def _hydrate_one(cur, row: dict) -> dict:
    hydrate_exercises_with_images(cur, [row])
    return row


@router.get("", response_model=list[ExerciseResponse])
def list_exercises(
    category: str | None = None,
    search: str | None = Query(None, min_length=1),
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        sql = "SELECT * FROM exercises WHERE (user_id IS NULL OR user_id = ?)"
        params: list = [user_id]
        if category:
            sql += " AND category = ?"
            params.append(category)
        if search:
            sql += " AND LOWER(name) LIKE ?"
            params.append(f"%{search.lower()}%")
        sql += " ORDER BY name ASC"
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        return hydrate_exercises_with_images(cur, rows)


@router.get("/{exercise_id}", response_model=ExerciseResponse)
def get_exercise(exercise_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM exercises WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
            (exercise_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        return _hydrate_one(cur, row)


@router.post("", response_model=ExerciseResponse)
def create_exercise(req: ExerciseCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO exercises
            (user_id, name, slug, category, primary_muscle, equipment, difficulty,
             is_bodyweight, measurement, instructions, cue, contraindications, min_age, max_age)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, req.name, req.slug, req.category, req.primary_muscle, req.equipment,
             req.difficulty, int(bool(req.is_bodyweight)), req.measurement, req.instructions,
             req.cue, req.contraindications, req.min_age, req.max_age),
        )
        ex_id = cur.lastrowid
        cur.execute("SELECT * FROM exercises WHERE id = ?", (ex_id,))
        return _hydrate_one(cur, cur.fetchone())


@router.put("/{exercise_id}", response_model=ExerciseResponse)
def update_exercise(exercise_id: int, req: ExerciseUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        # Allow edits on global exercises (user_id IS NULL) OR user's own exercises.
        # Single-user self-hosted: any authenticated user can tune the shared library.
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot edit another user's exercise")
        fields = {k: v for k, v in req.model_dump(exclude_unset=True).items()}
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            params = list(fields.values()) + [exercise_id]
            cur.execute(f"UPDATE exercises SET {sets} WHERE id = ?", tuple(params))
        cur.execute("SELECT * FROM exercises WHERE id = ?", (exercise_id,))
        return _hydrate_one(cur, cur.fetchone())


@router.delete("/{exercise_id}")
def delete_exercise(exercise_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if row["user_id"] != user_id:
            raise HTTPException(403, "Cannot delete a global exercise")
        cur.execute("DELETE FROM exercises WHERE id = ?", (exercise_id,))
    return {"ok": True}


@router.post("/{exercise_id}/images", response_model=ExerciseImageResponse)
def add_image(exercise_id: int, req: ExerciseImageCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM exercises WHERE id = ?", (exercise_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Cannot add image to another user's exercise")
        cur.execute(
            "INSERT INTO exercise_images (exercise_id, url, caption, sort_order) VALUES (?, ?, ?, ?)",
            (exercise_id, req.url, req.caption, req.sort_order or 0),
        )
        img_id = cur.lastrowid
        cur.execute("SELECT id, url, caption, sort_order FROM exercise_images WHERE id = ?", (img_id,))
        return cur.fetchone()


@router.post("/images/bulk", response_model=list[BulkImageResult])
def bulk_images(req: BulkImageRequest, user_id: int = Depends(get_current_user_id)):
    """Admin: paste rows mapping slug -> [urls]. Appends by default; replace=true clears existing first."""
    results: list[BulkImageResult] = []
    with get_db() as conn:
        cur = conn.cursor()
        for entry in req.entries:
            cur.execute(
                "SELECT id, user_id FROM exercises WHERE slug = ? AND (user_id IS NULL OR user_id = ?)",
                (entry.slug, user_id),
            )
            row = cur.fetchone()
            if not row:
                results.append(BulkImageResult(slug=entry.slug, status="not_found"))
                continue
            ex_id = row["id"]
            replaced = 0
            if entry.replace:
                cur.execute("SELECT COUNT(*) AS c FROM exercise_images WHERE exercise_id = ?", (ex_id,))
                replaced = cur.fetchone()["c"]
                cur.execute("DELETE FROM exercise_images WHERE exercise_id = ?", (ex_id,))
            cur.execute(
                "SELECT COALESCE(MAX(sort_order), -1) AS m FROM exercise_images WHERE exercise_id = ?",
                (ex_id,),
            )
            start = cur.fetchone()["m"] + 1
            added = 0
            for i, url in enumerate(entry.urls):
                url = url.strip()
                if not url:
                    continue
                cur.execute(
                    "INSERT INTO exercise_images (exercise_id, url, sort_order) VALUES (?, ?, ?)",
                    (ex_id, url, start + i),
                )
                added += 1
            results.append(BulkImageResult(slug=entry.slug, status="ok",
                                            added=added, replaced=replaced))
    return results


@router.delete("/images/{image_id}")
def delete_image(image_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT i.id, e.user_id FROM exercise_images i
            JOIN exercises e ON e.id = i.exercise_id WHERE i.id = ?
        """, (image_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Image not found")
        if row["user_id"] is not None and row["user_id"] != user_id:
            raise HTTPException(403, "Forbidden")
        cur.execute("DELETE FROM exercise_images WHERE id = ?", (image_id,))
    return {"ok": True}

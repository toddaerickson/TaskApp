from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_db
from app.auth import get_current_user_id
from app.models import ReminderCreate, ReminderResponse

router = APIRouter(tags=["reminders"])


@router.post("/tasks/{task_id}/reminders", response_model=ReminderResponse)
def add_reminder(task_id: int, req: ReminderCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Task not found")
        cur.execute(
            "INSERT INTO reminders (task_id, remind_at) VALUES (?, ?)",
            (task_id, req.remind_at.isoformat()),
        )
        rem_id = cur.lastrowid
        cur.execute("SELECT * FROM reminders WHERE id = ?", (rem_id,))
        row = cur.fetchone()
        row["reminded"] = bool(row["reminded"])
        return row


@router.get("/tasks/{task_id}/reminders", response_model=list[ReminderResponse])
def get_task_reminders(task_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Task not found")
        cur.execute(
            "SELECT * FROM reminders WHERE task_id = ? ORDER BY remind_at ASC",
            (task_id,),
        )
        rows = cur.fetchall()
        for r in rows:
            r["reminded"] = bool(r["reminded"])
        return rows


@router.delete("/reminders/{reminder_id}")
def delete_reminder(reminder_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT r.id FROM reminders r
            JOIN tasks t ON t.id = r.task_id
            WHERE r.id = ? AND t.user_id = ?
        """, (reminder_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Reminder not found")
        cur.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
    return {"ok": True}


@router.get("/reminders/upcoming", response_model=list[ReminderResponse])
def upcoming_reminders(
    limit: int = Query(20, ge=1, le=100),
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT r.* FROM reminders r
            JOIN tasks t ON t.id = r.task_id
            WHERE t.user_id = ? AND r.reminded = ?
            ORDER BY r.remind_at ASC
            LIMIT ?
        """, (user_id, False, limit))
        rows = cur.fetchall()
        for r in rows:
            r["reminded"] = bool(r["reminded"])
        return rows

from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from app.database import get_db
from app.auth import get_current_user_id
from app.models import TaskCreate, TaskUpdate, TaskResponse, TaskListResponse, BatchUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])

SORT_COLUMNS = {
    "title": "t.title",
    "priority": "t.priority",
    "due_date": "t.due_date",
    "status": "t.status",
    "folder": "f.sort_order",
    "starred": "t.starred",
    "created_at": "t.created_at",
    "updated_at": "t.updated_at",
}


def _fetch_tags(cur, task_ids: list[int]) -> dict[int, list]:
    if not task_ids:
        return {}
    placeholders = ",".join(["?"] * len(task_ids))
    cur.execute(f"""
        SELECT tt.task_id, tg.id, tg.name
        FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.task_id IN ({placeholders})
    """, task_ids)
    tags_map: dict[int, list] = {}
    for row in cur.fetchall():
        tags_map.setdefault(row["task_id"], []).append({"id": row["id"], "name": row["name"]})
    return tags_map


def _set_tags(cur, task_id: int, user_id: int, tag_ids: list[int]):
    cur.execute("DELETE FROM task_tags WHERE task_id = ?", (task_id,))
    for tid in tag_ids:
        cur.execute(
            "INSERT INTO task_tags (task_id, tag_id) SELECT ?, id FROM tags WHERE id = ? AND user_id = ?",
            (task_id, tid, user_id),
        )


def _get_task_by_id(cur, task_id: int) -> dict:
    cur.execute("""
        SELECT t.*, f.name AS folder_name
        FROM tasks t LEFT JOIN folders f ON f.id = t.folder_id
        WHERE t.id = ?
    """, (task_id,))
    task = cur.fetchone()
    if task:
        tags_map = _fetch_tags(cur, [task_id])
        task["tags"] = tags_map.get(task_id, [])
        # Normalize booleans for SQLite (stores as 0/1)
        task["starred"] = bool(task["starred"])
        task["completed"] = bool(task["completed"])
    return task


@router.get("", response_model=TaskListResponse)
def list_tasks(
    folder_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[int] = None,
    tag: Optional[str] = None,
    starred: Optional[bool] = None,
    completed: Optional[bool] = False,
    search: Optional[str] = None,
    sort: str = "folder",
    order: str = "asc",
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user_id: int = Depends(get_current_user_id),
):
    sort_col = SORT_COLUMNS.get(sort, "f.sort_order")
    order_dir = "DESC" if order.lower() == "desc" else "ASC"

    where = ["t.user_id = ?"]
    params: list = [user_id]

    if completed is not None:
        where.append("t.completed = ?")
        params.append(1 if completed else 0)
    if folder_id is not None:
        where.append("t.folder_id = ?")
        params.append(folder_id)
    if status is not None:
        where.append("t.status = ?")
        params.append(status)
    if priority is not None:
        where.append("t.priority = ?")
        params.append(priority)
    if starred is not None:
        where.append("t.starred = ?")
        params.append(1 if starred else 0)
    if search:
        where.append("(t.title LIKE ? OR t.note LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    if tag:
        where.append("EXISTS (SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = t.id AND tg.name = ?)")
        params.append(tag)

    where_sql = " AND ".join(where)

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN folders f ON f.id = t.folder_id WHERE {where_sql}", params)
        total = cur.fetchone()["cnt"]

        offset = (page - 1) * per_page
        cur.execute(f"""
            SELECT t.*, f.name AS folder_name
            FROM tasks t
            LEFT JOIN folders f ON f.id = t.folder_id
            WHERE {where_sql}
            ORDER BY {sort_col} {order_dir}, t.title ASC
            LIMIT ? OFFSET ?
        """, params + [per_page, offset])
        tasks = cur.fetchall()

        tags_map = _fetch_tags(cur, [t["id"] for t in tasks])
        for t in tasks:
            t["tags"] = tags_map.get(t["id"], [])
            t["starred"] = bool(t["starred"])
            t["completed"] = bool(t["completed"])

    return TaskListResponse(tasks=tasks, total=total, page=page, per_page=per_page)


@router.post("", response_model=TaskResponse)
def create_task(req: TaskCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO tasks (user_id, title, folder_id, note, priority, status, starred,
                               due_date, due_time, repeat_type, repeat_from)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id, req.title, req.folder_id, req.note, req.priority, req.status,
            1 if req.starred else 0,
            str(req.due_date) if req.due_date else None,
            str(req.due_time) if req.due_time else None,
            req.repeat_type, req.repeat_from,
        ))
        task_id = cur.lastrowid

        if req.tag_ids:
            _set_tags(cur, task_id, user_id, req.tag_ids)

        task = _get_task_by_id(cur, task_id)
    return task


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(task_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Task not found")
        task = _get_task_by_id(cur, task_id)
    return task


@router.put("/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, req: TaskUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Task not found")

        updates, params = ["updated_at = datetime('now')"], []
        for field in ["title", "folder_id", "note", "priority", "status",
                      "due_time", "repeat_type", "repeat_from"]:
            val = getattr(req, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)

        if req.starred is not None:
            updates.append("starred = ?")
            params.append(1 if req.starred else 0)
        if req.due_date is not None:
            updates.append("due_date = ?")
            params.append(str(req.due_date))

        params.extend([task_id, user_id])
        cur.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params)

        if req.tag_ids is not None:
            _set_tags(cur, task_id, user_id, req.tag_ids)

        task = _get_task_by_id(cur, task_id)
    return task


@router.delete("/{task_id}")
def delete_task(task_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Task not found")
        cur.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
    return {"ok": True}


REPEAT_DELTAS = {
    "daily": relativedelta(days=1),
    "weekly": relativedelta(weeks=1),
    "biweekly": relativedelta(weeks=2),
    "monthly": relativedelta(months=1),
    "quarterly": relativedelta(months=3),
    "semiannual": relativedelta(months=6),
    "yearly": relativedelta(years=1),
}


@router.post("/{task_id}/complete", response_model=TaskResponse)
def complete_task(task_id: int, user_id: int = Depends(get_current_user_id)):
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        task = cur.fetchone()
        if not task:
            raise HTTPException(404, "Task not found")

        if task["repeat_type"] != "none" and task["due_date"]:
            delta = REPEAT_DELTAS.get(task["repeat_type"])
            if delta:
                from datetime import date as date_type
                base_date = task["due_date"]
                if task["repeat_from"] == "completion_date":
                    base_date = now.date()
                elif isinstance(base_date, str):
                    base_date = date_type.fromisoformat(base_date)
                new_due = base_date + delta
                cur.execute(
                    "UPDATE tasks SET due_date = ?, updated_at = datetime('now') WHERE id = ?",
                    (str(new_due), task_id),
                )
        else:
            cur.execute(
                "UPDATE tasks SET completed = 1, completed_at = ?, updated_at = datetime('now') WHERE id = ?",
                (now.isoformat(), task_id),
            )

        task = _get_task_by_id(cur, task_id)
    return task


@router.post("/batch")
def batch_update(req: BatchUpdate, user_id: int = Depends(get_current_user_id)):
    updates, params = ["updated_at = datetime('now')"], []
    if req.folder_id is not None:
        updates.append("folder_id = ?")
        params.append(req.folder_id)
    if req.priority is not None:
        updates.append("priority = ?")
        params.append(req.priority)
    if req.status is not None:
        updates.append("status = ?")
        params.append(req.status)
    if req.starred is not None:
        updates.append("starred = ?")
        params.append(1 if req.starred else 0)
    if req.completed is not None:
        updates.append("completed = ?")
        params.append(1 if req.completed else 0)

    if len(updates) <= 1:
        raise HTTPException(400, "No fields to update")

    placeholders = ",".join(["?"] * len(req.task_ids))
    params.extend(req.task_ids)
    params.append(user_id)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE tasks SET {', '.join(updates)} WHERE id IN ({placeholders}) AND user_id = ?",
            params,
        )
        count = cur.rowcount if hasattr(cur, 'rowcount') else 0
    return {"updated": count}

from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from app.database import get_db
from app.auth import get_current_user_id
from app.models import (
    TaskCreate, TaskUpdate, TaskResponse, TaskListResponse,
    BatchUpdate, ReorderRequest,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])

SORT_COLUMNS = {
    "title": "t.title",
    "priority": "t.priority",
    "due_date": "t.due_date",
    "start_date": "t.start_date",
    "status": "t.status",
    "folder": "f.sort_order",
    "starred": "t.starred",
    "sort_order": "t.sort_order",
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


def _fetch_reminders(cur, task_ids: list[int]) -> dict[int, list]:
    if not task_ids:
        return {}
    placeholders = ",".join(["?"] * len(task_ids))
    cur.execute(f"""
        SELECT id, task_id, remind_at, reminded, created_at
        FROM reminders WHERE task_id IN ({placeholders})
        ORDER BY remind_at ASC
    """, task_ids)
    rem_map: dict[int, list] = {}
    for row in cur.fetchall():
        rem_map.setdefault(row["task_id"], []).append(dict(row))
    return rem_map


def _fetch_subtasks(cur, parent_ids: list[int]) -> dict[int, list]:
    if not parent_ids:
        return {}
    placeholders = ",".join(["?"] * len(parent_ids))
    cur.execute(f"""
        SELECT t.*, f.name AS folder_name, sf.name AS subfolder_name
        FROM tasks t
        LEFT JOIN folders f ON f.id = t.folder_id
        LEFT JOIN subfolders sf ON sf.id = t.subfolder_id
        WHERE t.parent_id IN ({placeholders})
        ORDER BY t.sort_order ASC, t.title ASC
    """, parent_ids)
    rows = cur.fetchall()
    sub_ids = [r["id"] for r in rows]
    tags_map = _fetch_tags(cur, sub_ids)
    rem_map = _fetch_reminders(cur, sub_ids)
    sub_map: dict[int, list] = {}
    for r in rows:
        r["starred"] = bool(r["starred"])
        r["completed"] = bool(r["completed"])
        r["tags"] = tags_map.get(r["id"], [])
        r["reminders"] = rem_map.get(r["id"], [])
        r["subtasks"] = []
        sub_map.setdefault(r["parent_id"], []).append(r)
    return sub_map


def _set_tags(cur, task_id: int, user_id: int, tag_ids: list[int]):
    cur.execute("DELETE FROM task_tags WHERE task_id = ?", (task_id,))
    for tid in tag_ids:
        cur.execute(
            "INSERT INTO task_tags (task_id, tag_id) SELECT ?, id FROM tags WHERE id = ? AND user_id = ?",
            (task_id, tid, user_id),
        )


def _get_task_by_id(cur, task_id: int) -> dict:
    cur.execute("""
        SELECT t.*, f.name AS folder_name, sf.name AS subfolder_name
        FROM tasks t
        LEFT JOIN folders f ON f.id = t.folder_id
        LEFT JOIN subfolders sf ON sf.id = t.subfolder_id
        WHERE t.id = ?
    """, (task_id,))
    task = cur.fetchone()
    if task:
        tags_map = _fetch_tags(cur, [task_id])
        task["tags"] = tags_map.get(task_id, [])
        rem_map = _fetch_reminders(cur, [task_id])
        task["reminders"] = rem_map.get(task_id, [])
        sub_map = _fetch_subtasks(cur, [task_id])
        task["subtasks"] = sub_map.get(task_id, [])
        task["starred"] = bool(task["starred"])
        task["completed"] = bool(task["completed"])
    return task


@router.get("", response_model=TaskListResponse)
def list_tasks(
    folder_id: Optional[int] = None,
    subfolder_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[int] = None,
    tag: Optional[str] = None,
    starred: Optional[bool] = None,
    completed: Optional[bool] = False,
    search: Optional[str] = None,
    hide_future_start: Optional[bool] = None,
    parent_id: Optional[int] = None,
    top_level_only: Optional[bool] = True,
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

    if parent_id is not None:
        where.append("t.parent_id = ?")
        params.append(parent_id)
    elif top_level_only:
        where.append("t.parent_id IS NULL")

    if completed is not None:
        where.append("t.completed = ?")
        params.append(bool(completed))
    if folder_id is not None:
        where.append("t.folder_id = ?")
        params.append(folder_id)
    if subfolder_id is not None:
        where.append("t.subfolder_id = ?")
        params.append(subfolder_id)
    if status is not None:
        where.append("t.status = ?")
        params.append(status)
    if priority is not None:
        where.append("t.priority = ?")
        params.append(priority)
    if starred is not None:
        where.append("t.starred = ?")
        params.append(bool(starred))
    if search:
        where.append("(t.title LIKE ? OR t.note LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    if tag:
        where.append("EXISTS (SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = t.id AND tg.name = ?)")
        params.append(tag)
    if hide_future_start:
        where.append("(t.start_date IS NULL OR t.start_date <= date('now'))")

    where_sql = " AND ".join(where)

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT COUNT(*) AS cnt FROM tasks t
            LEFT JOIN folders f ON f.id = t.folder_id
            WHERE {where_sql}
        """, params)
        total = cur.fetchone()["cnt"]

        offset = (page - 1) * per_page
        cur.execute(f"""
            SELECT t.*, f.name AS folder_name, sf.name AS subfolder_name
            FROM tasks t
            LEFT JOIN folders f ON f.id = t.folder_id
            LEFT JOIN subfolders sf ON sf.id = t.subfolder_id
            WHERE {where_sql}
            ORDER BY {sort_col} {order_dir}, t.sort_order ASC, t.title ASC
            LIMIT ? OFFSET ?
        """, params + [per_page, offset])
        tasks = cur.fetchall()

        task_ids = [t["id"] for t in tasks]
        tags_map = _fetch_tags(cur, task_ids)
        rem_map = _fetch_reminders(cur, task_ids)
        sub_map = _fetch_subtasks(cur, task_ids)
        for t in tasks:
            t["tags"] = tags_map.get(t["id"], [])
            t["reminders"] = rem_map.get(t["id"], [])
            t["subtasks"] = sub_map.get(t["id"], [])
            t["starred"] = bool(t["starred"])
            t["completed"] = bool(t["completed"])

    return TaskListResponse(tasks=tasks, total=total, page=page, per_page=per_page)


@router.post("", response_model=TaskResponse)
def create_task(req: TaskCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()

        folder_id = req.folder_id
        subfolder_id = req.subfolder_id

        # If subtask, inherit folder/list from parent
        if req.parent_id is not None:
            cur.execute("SELECT id, folder_id, subfolder_id FROM tasks WHERE id = ? AND user_id = ?",
                        (req.parent_id, user_id))
            parent = cur.fetchone()
            if not parent:
                raise HTTPException(404, "Parent task not found")
            folder_id = parent["folder_id"]
            subfolder_id = parent["subfolder_id"]

        # Auto-assign sort_order if not provided. Build the folder/parent
        # filter dynamically — SQLite's `IS ?` accepts NULL values but
        # Postgres only allows IS with literal NULL/NOT NULL, and uses `=`
        # for values (where `= NULL` always yields UNKNOWN). So emit
        # `IS NULL` or `= ?` per-field based on whether the value is None.
        sort_order = req.sort_order
        if sort_order is None:
            clauses = ["user_id = ?"]
            params: list = [user_id]
            if folder_id is None:
                clauses.append("folder_id IS NULL")
            else:
                clauses.append("folder_id = ?")
                params.append(folder_id)
            if req.parent_id is None:
                clauses.append("parent_id IS NULL")
            else:
                clauses.append("parent_id = ?")
                params.append(req.parent_id)
            cur.execute(
                f"SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tasks WHERE {' AND '.join(clauses)}",
                tuple(params),
            )
            sort_order = cur.fetchone()["next_order"]

        cur.execute("""
            INSERT INTO tasks (user_id, title, folder_id, subfolder_id, parent_id, note, priority, status, starred,
                               start_date, due_date, due_time, repeat_type, repeat_from, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id, req.title, folder_id, subfolder_id, req.parent_id,
            req.note, req.priority, req.status,
            bool(req.starred),
            str(req.start_date) if req.start_date else None,
            str(req.due_date) if req.due_date else None,
            str(req.due_time) if req.due_time else None,
            req.repeat_type, req.repeat_from, sort_order,
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

        _now = datetime.now(timezone.utc).isoformat(sep=" ", timespec="seconds")
        updates, params = ["updated_at = ?"], [_now]
        for field in ["title", "folder_id", "subfolder_id", "parent_id", "note", "priority", "status",
                      "due_time", "repeat_type", "repeat_from", "sort_order"]:
            val = getattr(req, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)

        if req.starred is not None:
            updates.append("starred = ?")
            params.append(bool(req.starred))
        if req.due_date is not None:
            updates.append("due_date = ?")
            params.append(str(req.due_date))
        if req.start_date is not None:
            updates.append("start_date = ?")
            params.append(str(req.start_date))

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
                    "UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?",
                    (str(new_due), datetime.now(timezone.utc).isoformat(sep=" ", timespec="seconds"), task_id),
                )
        else:
            cur.execute(
                "UPDATE tasks SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                (True, now.isoformat(), now.isoformat(sep=" ", timespec="seconds"), task_id),
            )

        task = _get_task_by_id(cur, task_id)
    return task


@router.post("/reorder")
def reorder_tasks(req: ReorderRequest, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        for idx, tid in enumerate(req.task_ids):
            cur.execute("UPDATE tasks SET sort_order = ? WHERE id = ? AND user_id = ?",
                        (idx, tid, user_id))
    return {"ok": True}


@router.post("/batch")
def batch_update(req: BatchUpdate, user_id: int = Depends(get_current_user_id)):
    _now = datetime.now(timezone.utc).isoformat(sep=" ", timespec="seconds")
    updates, params = ["updated_at = ?"], [_now]
    if req.folder_id is not None:
        updates.append("folder_id = ?")
        params.append(req.folder_id)
    if req.subfolder_id is not None:
        updates.append("subfolder_id = ?")
        params.append(req.subfolder_id)
    if req.priority is not None:
        updates.append("priority = ?")
        params.append(req.priority)
    if req.status is not None:
        updates.append("status = ?")
        params.append(req.status)
    if req.starred is not None:
        updates.append("starred = ?")
        params.append(bool(req.starred))
    if req.completed is not None:
        updates.append("completed = ?")
        params.append(bool(req.completed))

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

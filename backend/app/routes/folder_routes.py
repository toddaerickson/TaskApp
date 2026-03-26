from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user_id
from app.models import FolderCreate, FolderUpdate, FolderResponse

router = APIRouter(prefix="/folders", tags=["folders"])


@router.get("", response_model=list[FolderResponse])
def list_folders(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT f.id, f.name, f.sort_order,
                       COUNT(t.id) FILTER (WHERE t.completed = FALSE) AS task_count
                FROM folders f
                LEFT JOIN tasks t ON t.folder_id = f.id
                WHERE f.user_id = %s
                GROUP BY f.id
                ORDER BY f.sort_order, f.name
            """, (user_id,))
            return cur.fetchall()


@router.post("", response_model=FolderResponse)
def create_folder(req: FolderCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO folders (user_id, name, sort_order) VALUES (%s, %s, %s) RETURNING id, name, sort_order",
                (user_id, req.name, req.sort_order),
            )
            folder = cur.fetchone()
            folder["task_count"] = 0
            return folder


@router.put("/{folder_id}", response_model=FolderResponse)
def update_folder(folder_id: int, req: FolderUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM folders WHERE id = %s AND user_id = %s", (folder_id, user_id))
            if not cur.fetchone():
                raise HTTPException(404, "Folder not found")

            updates, params = [], []
            if req.name is not None:
                updates.append("name = %s")
                params.append(req.name)
            if req.sort_order is not None:
                updates.append("sort_order = %s")
                params.append(req.sort_order)
            if not updates:
                raise HTTPException(400, "No fields to update")

            params.extend([folder_id, user_id])
            cur.execute(
                f"UPDATE folders SET {', '.join(updates)} WHERE id = %s AND user_id = %s RETURNING id, name, sort_order",
                params,
            )
            folder = cur.fetchone()
            folder["task_count"] = 0
            return folder


@router.delete("/{folder_id}")
def delete_folder(folder_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM folders WHERE id = %s AND user_id = %s RETURNING id", (folder_id, user_id))
            if not cur.fetchone():
                raise HTTPException(404, "Folder not found")
    return {"ok": True}

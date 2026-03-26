from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user_id
from app.models import FolderCreate, FolderUpdate, FolderResponse

router = APIRouter(prefix="/folders", tags=["folders"])


@router.get("", response_model=list[FolderResponse])
def list_folders(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT f.id, f.name, f.sort_order,
                   (SELECT COUNT(*) FROM tasks t WHERE t.folder_id = f.id AND t.completed = 0) AS task_count
            FROM folders f
            WHERE f.user_id = ?
            ORDER BY f.sort_order, f.name
        """, (user_id,))
        return cur.fetchall()


@router.post("", response_model=FolderResponse)
def create_folder(req: FolderCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO folders (user_id, name, sort_order) VALUES (?, ?, ?)",
            (user_id, req.name, req.sort_order),
        )
        folder_id = cur.lastrowid
        return {"id": folder_id, "name": req.name, "sort_order": req.sort_order, "task_count": 0}


@router.put("/{folder_id}", response_model=FolderResponse)
def update_folder(folder_id: int, req: FolderUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Folder not found")

        updates, params = [], []
        if req.name is not None:
            updates.append("name = ?")
            params.append(req.name)
        if req.sort_order is not None:
            updates.append("sort_order = ?")
            params.append(req.sort_order)
        if not updates:
            raise HTTPException(400, "No fields to update")

        params.extend([folder_id, user_id])
        cur.execute(f"UPDATE folders SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params)
        cur.execute("SELECT id, name, sort_order FROM folders WHERE id = ?", (folder_id,))
        folder = cur.fetchone()
        folder["task_count"] = 0
        return folder


@router.delete("/{folder_id}")
def delete_folder(folder_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Folder not found")
        cur.execute("DELETE FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
    return {"ok": True}

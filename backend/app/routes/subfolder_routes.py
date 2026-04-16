from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user_id
from app.models import SubfolderCreate, SubfolderUpdate, SubfolderResponse

router = APIRouter(tags=["subfolders"])


@router.get("/folders/{folder_id}/subfolders", response_model=list[SubfolderResponse])
def get_subfolders(folder_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Folder not found")
        cur.execute("""
            SELECT sf.id, sf.folder_id, sf.name, sf.sort_order,
                   (SELECT COUNT(*) FROM tasks t WHERE t.subfolder_id = sf.id AND NOT t.completed) AS task_count
            FROM subfolders sf
            WHERE sf.folder_id = ? AND sf.user_id = ?
            ORDER BY sf.sort_order, sf.name
        """, (folder_id, user_id))
        return cur.fetchall()


@router.post("/folders/{folder_id}/subfolders", response_model=SubfolderResponse)
def create_subfolder(folder_id: int, req: SubfolderCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Folder not found")
        cur.execute(
            "INSERT INTO subfolders (user_id, folder_id, name, sort_order) VALUES (?, ?, ?, ?)",
            (user_id, folder_id, req.name, req.sort_order),
        )
        subfolder_id = cur.lastrowid
        return {"id": subfolder_id, "folder_id": folder_id, "name": req.name,
                "sort_order": req.sort_order, "task_count": 0}


@router.put("/subfolders/{subfolder_id}", response_model=SubfolderResponse)
def update_subfolder(subfolder_id: int, req: SubfolderUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, folder_id FROM subfolders WHERE id = ? AND user_id = ?", (subfolder_id, user_id))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(404, "Subfolder not found")

        updates, params = [], []
        if req.name is not None:
            updates.append("name = ?")
            params.append(req.name)
        if req.sort_order is not None:
            updates.append("sort_order = ?")
            params.append(req.sort_order)
        if not updates:
            raise HTTPException(400, "No fields to update")

        params.extend([subfolder_id, user_id])
        cur.execute(f"UPDATE subfolders SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params)
        cur.execute("""
            SELECT sf.id, sf.folder_id, sf.name, sf.sort_order,
                   (SELECT COUNT(*) FROM tasks t WHERE t.subfolder_id = sf.id AND NOT t.completed) AS task_count
            FROM subfolders sf WHERE sf.id = ?
        """, (subfolder_id,))
        return cur.fetchone()


@router.delete("/subfolders/{subfolder_id}")
def delete_subfolder(subfolder_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM subfolders WHERE id = ? AND user_id = ?", (subfolder_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Subfolder not found")
        cur.execute("DELETE FROM subfolders WHERE id = ? AND user_id = ?", (subfolder_id, user_id))
    return {"ok": True}

from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user_id
from app.models import TagCreate, TagResponse

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
def list_tags(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name FROM tags WHERE user_id = ? ORDER BY name", (user_id,))
        return cur.fetchall()


@router.post("", response_model=TagResponse)
def create_tag(req: TagCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name FROM tags WHERE user_id = ? AND name = ?", (user_id, req.name))
        existing = cur.fetchone()
        if existing:
            return existing
        cur.execute("INSERT INTO tags (user_id, name) VALUES (?, ?)", (user_id, req.name))
        return {"id": cur.lastrowid, "name": req.name}


@router.delete("/{tag_id}")
def delete_tag(tag_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM tags WHERE id = ? AND user_id = ?", (tag_id, user_id))
        if not cur.fetchone():
            raise HTTPException(404, "Tag not found")
        cur.execute("DELETE FROM tags WHERE id = ? AND user_id = ?", (tag_id, user_id))
    return {"ok": True}

from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user_id
from app.models import TagCreate, TagResponse

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
def list_tags(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM tags WHERE user_id = %s ORDER BY name", (user_id,))
            return cur.fetchall()


@router.post("", response_model=TagResponse)
def create_tag(req: TagCreate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO tags (user_id, name) VALUES (%s, %s) ON CONFLICT (user_id, name) DO NOTHING RETURNING id, name",
                (user_id, req.name),
            )
            tag = cur.fetchone()
            if not tag:
                cur.execute("SELECT id, name FROM tags WHERE user_id = %s AND name = %s", (user_id, req.name))
                tag = cur.fetchone()
            return tag


@router.delete("/{tag_id}")
def delete_tag(tag_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tags WHERE id = %s AND user_id = %s RETURNING id", (tag_id, user_id))
            if not cur.fetchone():
                raise HTTPException(404, "Tag not found")
    return {"ok": True}

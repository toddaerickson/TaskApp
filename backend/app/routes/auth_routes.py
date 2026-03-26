from fastapi import APIRouter, HTTPException, Depends
from app.database import get_db
from app.auth import hash_password, verify_password, create_token, get_current_user_id
from app.models import RegisterRequest, LoginRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email = ?", (req.email,))
        if cur.fetchone():
            raise HTTPException(400, "Email already registered")
        cur.execute(
            "INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)",
            (req.email, hash_password(req.password), req.display_name),
        )
        user_id = cur.lastrowid

        # Create default GTD folders
        defaults = [
            ("Critical", 0), ("1. Capture", 1), ("2. Do Now", 2),
            ("3. Delegate (Waiting)", 3), ("4. Defer (Follow-up)", 4),
            ("5. Social", 5), ("6. Someday/Maybe", 6), ("7. Reference", 7),
        ]
        for name, order in defaults:
            cur.execute(
                "INSERT INTO folders (user_id, name, sort_order) VALUES (?, ?, ?)",
                (user_id, name, order),
            )
    return TokenResponse(access_token=create_token(user_id))


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, password_hash FROM users WHERE email = ?", (req.email,))
        user = cur.fetchone()
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return TokenResponse(access_token=create_token(user["id"]))


@router.get("/me", response_model=UserResponse)
def me(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, email, display_name FROM users WHERE id = ?", (user_id,))
        user = cur.fetchone()
    if not user:
        raise HTTPException(404, "User not found")
    return user

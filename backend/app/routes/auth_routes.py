from fastapi import APIRouter, HTTPException, Depends, Request
from app.database import get_db, is_unique_violation
from app.auth import (
    hash_password, verify_password, create_token, get_current_user_id,
    needs_rehash,
)
from app.models import (
    RegisterRequest, LoginRequest, TokenResponse, UserResponse,
    ChangePasswordRequest, ProfileUpdate,
)
from app.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
def register(request: Request, req: RegisterRequest):
    try:
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
    except HTTPException:
        raise
    except Exception as exc:
        # Race: two concurrent registers slip past the SELECT and one loses
        # on the UNIQUE email index. Convert the raw DB error to a clean 400.
        if is_unique_violation(exc):
            raise HTTPException(400, "Email already registered")
        raise
    # token_version defaults to 0 for new users; pass explicitly so the
    # `ver` claim is set even on the first issuance.
    return TokenResponse(access_token=create_token(user_id, token_version=0))


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, req: LoginRequest):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, password_hash, token_version FROM users WHERE email = ?",
            (req.email,),
        )
        user = cur.fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(401, "Invalid email or password")
        # Opportunistic hash upgrade: legacy SHA-256 -> bcrypt on the next
        # successful login. We already have the plaintext here, so rehash
        # and UPDATE before the transaction closes.
        if needs_rehash(user["password_hash"]):
            cur.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(req.password), user["id"]),
            )
    return TokenResponse(
        access_token=create_token(user["id"], token_version=user["token_version"])
    )


@router.get("/me", response_model=UserResponse)
def me(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, email, display_name FROM users WHERE id = ?", (user_id,))
        user = cur.fetchone()
    if not user:
        raise HTTPException(404, "User not found")
    return user


@router.put("/me", response_model=UserResponse)
def update_me(req: ProfileUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET display_name = ? WHERE id = ?",
            (req.display_name, user_id),
        )
        cur.execute("SELECT id, email, display_name FROM users WHERE id = ?", (user_id,))
        user = cur.fetchone()
    if not user:
        raise HTTPException(404, "User not found")
    return user


@router.post("/change-password", response_model=TokenResponse)
@limiter.limit("5/minute")
def change_password(request: Request, req: ChangePasswordRequest, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT password_hash, token_version FROM users WHERE id = ?",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        if not verify_password(req.current_password, row["password_hash"]):
            # Same wording as login so a wrong current-password can't be
            # distinguished from an expired session by an attacker with
            # only an old JWT.
            raise HTTPException(401, "Current password is incorrect")
        new_version = row["token_version"] + 1
        cur.execute(
            "UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?",
            (hash_password(req.new_password), new_version, user_id),
        )
    # Issue a fresh token so the current session stays signed in; other
    # devices holding the old token will 401 on their next request.
    return TokenResponse(access_token=create_token(user_id, token_version=new_version))


@router.post("/sign-out-everywhere", status_code=204)
def sign_out_everywhere(user_id: int = Depends(get_current_user_id)):
    """Bump token_version so every JWT issued before this call (including
    the one used to authenticate THIS request) starts returning 401. The
    caller is expected to clear its local token and route to login."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET token_version = token_version + 1 WHERE id = ?",
            (user_id,),
        )
    return



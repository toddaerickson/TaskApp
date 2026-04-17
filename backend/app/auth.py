import hashlib
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import bcrypt
from app.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRE_HOURS

security = HTTPBearer()

# bcrypt is the primary scheme for new hashes. The `salt$sha256hex` strings
# from the pre-bcrypt era still verify correctly (see `_verify_sha256`) and
# the login route opportunistically upgrades them on the next successful
# sign-in. Bcrypt truncates to 72 bytes; we match that explicitly both on
# hash and verify so a caller with a >72-byte password gets a stable
# equality check.
_BCRYPT_MAX = 72


def _prep(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prep(password), bcrypt.gensalt()).decode("ascii")


def _is_legacy_sha256(stored: str) -> bool:
    # Legacy format: `<32-hex-salt>$<64-hex-sha256>`. Bcrypt hashes always
    # begin with `$2`, so the first character is never hex.
    return len(stored) > 0 and stored[0] != "$"


def _verify_sha256(plain: str, stored: str) -> bool:
    try:
        salt, hashed = stored.split("$", 1)
    except ValueError:
        return False
    return hashlib.sha256((salt + plain).encode()).hexdigest() == hashed


def verify_password(plain: str, stored: str) -> bool:
    if _is_legacy_sha256(stored):
        return _verify_sha256(plain, stored)
    try:
        return bcrypt.checkpw(_prep(plain), stored.encode("ascii"))
    except (ValueError, TypeError):
        # Malformed bcrypt hash — treat as a bad password rather than 500.
        return False


def needs_rehash(stored: str) -> bool:
    """True if the stored hash should be upgraded on next successful login."""
    return _is_legacy_sha256(stored)


def create_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> int:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return user_id

from datetime import datetime, timedelta, timezone
import hashlib
import hmac

import jwt
from pwdlib import PasswordHash


password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def password_fingerprint(hashed: str) -> str:
    return hashlib.sha256(hashed.encode()).hexdigest()


def create_access_token(user_id: int, secret: str, expires_minutes: int, hashed_password: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    return jwt.encode(
        {"sub": str(user_id), "exp": expires, "pwd": password_fingerprint(hashed_password)},
        secret,
        algorithm="HS256",
    )


def decode_access_token(token: str, secret: str, hashed_password: str | None = None) -> int | None:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        if hashed_password is not None and not hmac.compare_digest(
            str(payload.get("pwd", "")), password_fingerprint(hashed_password)
        ):
            return None
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None


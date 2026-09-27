from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash


password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: int, secret: str, expires_minutes: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expires}, secret, algorithm="HS256")


def decode_access_token(token: str, secret: str) -> int | None:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None


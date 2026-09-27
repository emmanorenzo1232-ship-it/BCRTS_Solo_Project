from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User, UserRole
from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise error
    user_id = decode_access_token(credentials.credentials, request.app.state.settings.jwt_secret)
    if user_id is None:
        raise error
    user = await db.get(User, user_id)
    if user is None:
        raise error
    return user


async def require_resident(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.RESIDENT.value:
        raise HTTPException(status_code=403, detail="Resident access required")
    return user


async def require_staff(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.STAFF.value:
        raise HTTPException(status_code=403, detail="Staff access required")
    return user


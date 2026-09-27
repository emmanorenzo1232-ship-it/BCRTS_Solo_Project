from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import secrets

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from .config import Settings
from .dependencies import get_current_user, get_db, require_resident, require_staff
from .models import Base, CaseRecord, CaseStatus, User, UserRole
from .schemas import (
    CaseCreate,
    CaseResponse,
    CaseStatusUpdate,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from .security import create_access_token, hash_password, verify_password

logger = logging.getLogger(__name__)

CATEGORIES = [
    "Streetlights",
    "Drainage",
    "Noise complaint",
    "Sanitation",
    "Roads and infrastructure",
    "Barangay clearance",
    "Certificate of residency",
    "Other",
]
STATUS_ORDER = [status.value for status in CaseStatus]


async def seed_staff(app: FastAPI) -> None:
    settings: Settings = app.state.settings
    values = (settings.staff_name, settings.staff_email, settings.staff_password)
    if not all(values):
        logger.warning("Staff account not seeded: STAFF_NAME, STAFF_EMAIL, and STAFF_PASSWORD are required")
        return
    async with app.state.sessionmaker() as db:
        existing = await db.scalar(select(User).where(User.email == settings.staff_email.lower()))
        if existing is None:
            db.add(
                User(
                    name=settings.staff_name.strip(),
                    email=settings.staff_email.lower(),
                    password_hash=hash_password(settings.staff_password),
                    role=UserRole.STAFF.value,
                )
            )
            await db.commit()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = create_async_engine(settings.database_url)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        await seed_staff(app)
        yield
        await engine.dispose()

    app = FastAPI(title="BCRTS API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.sessionmaker = sessionmaker
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": f"http_{exc.status_code}", "message": exc.detail}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Please correct the highlighted fields.",
                    "details": exc.errors(),
                }
            },
        )

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/auth/register", response_model=TokenResponse, status_code=201)
    async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
        email = payload.email.lower()
        if await db.scalar(select(User).where(User.email == email)):
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        user = User(
            name=payload.name.strip(),
            email=email,
            password_hash=hash_password(payload.password),
            role=UserRole.RESIDENT.value,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        token = create_access_token(user.id, settings.jwt_secret, settings.jwt_expire_minutes)
        return TokenResponse(access_token=token, user=user)

    @app.post("/api/auth/login", response_model=TokenResponse)
    async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
        user = await db.scalar(select(User).where(User.email == payload.email.lower()))
        if user is None or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect email or password")
        token = create_access_token(user.id, settings.jwt_secret, settings.jwt_expire_minutes)
        return TokenResponse(access_token=token, user=user)

    @app.get("/api/auth/me", response_model=UserResponse)
    async def me(user: User = Depends(get_current_user)):
        return user

    @app.get("/api/categories", response_model=list[str])
    async def categories():
        return CATEGORIES

    @app.post("/api/cases", response_model=CaseResponse, status_code=201)
    async def create_case(
        payload: CaseCreate,
        resident: User = Depends(require_resident),
        db: AsyncSession = Depends(get_db),
    ):
        if payload.category not in CATEGORIES:
            raise HTTPException(status_code=422, detail="Unknown category")
        reference = f"BCRTS-{datetime.now(timezone.utc):%Y}-{secrets.token_hex(3).upper()}"
        case = CaseRecord(
            reference_number=reference,
            resident_id=resident.id,
            type=payload.type.value,
            category=payload.category,
            subject=payload.subject.strip(),
            description=payload.description.strip(),
            status=CaseStatus.RECEIVED.value,
        )
        case.resident = resident
        db.add(case)
        await db.commit()
        await db.refresh(case)
        return case

    @app.get("/api/cases", response_model=list[CaseResponse])
    async def list_cases(
        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
    ):
        query = select(CaseRecord).options(selectinload(CaseRecord.resident))
        if user.role == UserRole.RESIDENT.value:
            query = query.where(CaseRecord.resident_id == user.id)
        query = query.order_by(CaseRecord.created_at.desc())
        return list((await db.scalars(query)).all())

    @app.get("/api/cases/{case_id}", response_model=CaseResponse)
    async def get_case(
        case_id: int,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        case = await db.scalar(
            select(CaseRecord)
            .where(CaseRecord.id == case_id)
            .options(selectinload(CaseRecord.resident))
        )
        if case is None:
            raise HTTPException(status_code=404, detail="Case not found")
        if user.role == UserRole.RESIDENT.value and case.resident_id != user.id:
            raise HTTPException(status_code=404, detail="Case not found")
        return case

    @app.patch("/api/cases/{case_id}/status", response_model=CaseResponse)
    async def update_status(
        case_id: int,
        payload: CaseStatusUpdate,
        _: User = Depends(require_staff),
        db: AsyncSession = Depends(get_db),
    ):
        case = await db.scalar(
            select(CaseRecord)
            .where(CaseRecord.id == case_id)
            .options(selectinload(CaseRecord.resident))
        )
        if case is None:
            raise HTTPException(status_code=404, detail="Case not found")
        if STATUS_ORDER.index(payload.status.value) <= STATUS_ORDER.index(case.status):
            raise HTTPException(status_code=409, detail="Case status can only move forward")
        case.status = payload.status.value
        await db.commit()
        await db.refresh(case)
        return case

    return app


app = create_app()


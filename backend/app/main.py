from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
import logging
import secrets

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload
from starlette.concurrency import run_in_threadpool

from .appointments import availability, initialize_schedule, lock_schedule, reserve_appointment, schedule_response, validate_range
from .config import Settings
from .dependencies import get_current_user, get_db, require_resident, require_staff
from .migrations import add_appointment_date, add_appointment_time
from .models import AppointmentSettings, Base, CaseNote, CaseRecord, CaseStatus, CaseStatusHistory, CaseType, PasswordResetToken, User, UserRole
from .password_reset import ResetRateLimiter, hash_reset_token, send_password_reset
from .schemas import (
    AppointmentDayResponse,
    AppointmentSchedule,
    CaseCreate,
    CaseHistoryResponse,
    CaseNoteCreate,
    CaseNoteResponse,
    CaseResponse,
    CaseStatusUpdate,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
)
from .security import create_access_token, hash_password, password_fingerprint, verify_password

logger = logging.getLogger(__name__)

CATEGORIES_BY_TYPE = {
    CaseType.COMPLAINT: [
        "Streetlights",
        "Drainage",
        "Noise complaint",
        "Sanitation",
        "Roads and infrastructure",
        "Other",
    ],
    CaseType.REQUEST: [
        "Barangay clearance",
        "Certificate of residency",
        "Certificate of indigency",
        "Barangay business clearance",
        "Other",
    ],
}
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
            await connection.run_sync(add_appointment_date)
            await connection.run_sync(add_appointment_time)
        async with sessionmaker() as db:
            await initialize_schedule(db)
        await seed_staff(app)
        yield
        await engine.dispose()

    app = FastAPI(title="BCRTS API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.sessionmaker = sessionmaker
    app.state.reset_rate_limiter = ResetRateLimiter()
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
                    "details": jsonable_encoder(exc.errors(), custom_encoder={ValueError: str}),
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
        token = create_access_token(user.id, settings.jwt_secret, settings.jwt_expire_minutes, user.password_hash)
        return TokenResponse(access_token=token, user=user)

    @app.post("/api/auth/login", response_model=TokenResponse)
    async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
        user = await db.scalar(select(User).where(User.email == payload.email.lower()))
        if user is None or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect email or password")
        token = create_access_token(user.id, settings.jwt_secret, settings.jwt_expire_minutes, user.password_hash)
        return TokenResponse(access_token=token, user=user)

    async def deliver_reset(email: str, token: str) -> None:
        try:
            await run_in_threadpool(send_password_reset, settings, email, token)
        except Exception:
            # Allow an immediate retry after a delivery failure; never log the token.
            async with sessionmaker() as db:
                await db.execute(delete(PasswordResetToken).where(
                    PasswordResetToken.token_hash == hash_reset_token(token)
                ))
                await db.commit()
            logger.error("Password reset delivery failed. Check the mail configuration.")

    @app.post("/api/auth/forgot-password", response_model=MessageResponse, status_code=202)
    async def forgot_password(
        payload: ForgotPasswordRequest,
        request: Request,
        background: BackgroundTasks,
        db: AsyncSession = Depends(get_db),
    ):
        client = request.client.host if request.client else "unknown"
        if not app.state.reset_rate_limiter.allow(f"forgot:{client}"):
            raise HTTPException(status_code=429, detail="Too many reset requests. Try again in 15 minutes.")
        response = MessageResponse(message="If an account exists for that email, a password reset link has been sent.")
        user = await db.scalar(select(User).where(User.email == payload.email.lower()))
        if user is None:
            return response
        now = datetime.now(timezone.utc)
        recent = await db.scalar(select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.created_at > now - timedelta(seconds=60),
        ))
        if recent:
            return response
        await db.execute(delete(PasswordResetToken).where(PasswordResetToken.expires_at <= now))
        token = secrets.token_urlsafe(32)
        db.add(PasswordResetToken(
            token_hash=hash_reset_token(token),
            user_id=user.id,
            password_fingerprint=password_fingerprint(user.password_hash),
            expires_at=now + timedelta(minutes=settings.password_reset_expire_minutes),
        ))
        await db.commit()
        background.add_task(deliver_reset, user.email, token)
        return response

    @app.post("/api/auth/reset-password", response_model=MessageResponse)
    async def reset_password(
        payload: ResetPasswordRequest, request: Request, db: AsyncSession = Depends(get_db),
    ):
        client = request.client.host if request.client else "unknown"
        if not app.state.reset_rate_limiter.allow(f"reset:{client}", limit=20):
            raise HTTPException(status_code=429, detail="Too many reset attempts. Try again in 15 minutes.")
        invalid = HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new link.")
        token_hash = hash_reset_token(payload.token)
        reset = await db.scalar(select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.expires_at > datetime.now(timezone.utc),
        ))
        if reset is None:
            raise invalid
        user = await db.get(User, reset.user_id)
        if user is None or reset.password_fingerprint != password_fingerprint(user.password_hash):
            raise invalid
        new_hash = hash_password(payload.password)
        # Claim the token in the same transaction as the password update. A second
        # request cannot reuse it, even if both requests initially read the row.
        claimed = await db.execute(delete(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.expires_at > datetime.now(timezone.utc),
        ).execution_options(synchronize_session=False))
        if claimed.rowcount != 1:
            await db.rollback()
            raise invalid
        changed = await db.execute(update(User).where(
            User.id == user.id, User.password_hash == user.password_hash,
        ).values(password_hash=new_hash).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            await db.rollback()
            raise invalid
        await db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
        await db.commit()
        return MessageResponse(message="Your password has been reset. Sign in with your new password.")

    @app.get("/api/auth/me", response_model=UserResponse)
    async def me(user: User = Depends(get_current_user)):
        return user

    @app.get("/api/categories", response_model=list[str])
    async def categories(type: CaseType | None = None):
        if type is not None:
            return CATEGORIES_BY_TYPE[type]
        return list(dict.fromkeys(item for items in CATEGORIES_BY_TYPE.values() for item in items))

    @app.get("/api/appointments/settings", response_model=AppointmentSchedule)
    async def appointment_settings(
        _: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
    ):
        return schedule_response(await db.get(AppointmentSettings, 1))

    @app.put("/api/appointments/settings", response_model=AppointmentSchedule)
    async def save_appointment_settings(
        payload: AppointmentSchedule, _: User = Depends(require_staff), db: AsyncSession = Depends(get_db),
    ):
        schedule = await lock_schedule(db)
        for key, value in payload.model_dump().items():
            setattr(schedule, key, ",".join(str(day) for day in sorted(value)) if key == "weekdays" else value)
        await db.commit()
        return schedule_response(schedule)

    @app.get("/api/appointments/availability", response_model=list[AppointmentDayResponse])
    async def appointment_availability(
        start_date: date, end_date: date,
        _: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
    ):
        return await availability(db, await db.get(AppointmentSettings, 1), start_date, end_date)

    @app.get("/api/appointments", response_model=list[CaseResponse])
    async def list_appointments(
        start_date: date, end_date: date,
        _: User = Depends(require_staff), db: AsyncSession = Depends(get_db),
    ):
        validate_range(start_date, end_date)
        query = select(CaseRecord).where(
            CaseRecord.type == CaseType.REQUEST.value,
            CaseRecord.appointment_date.between(start_date, end_date),
        ).options(selectinload(CaseRecord.resident)).order_by(
            CaseRecord.appointment_date, CaseRecord.appointment_time, CaseRecord.created_at,
        )
        return list((await db.scalars(query)).all())

    @app.post("/api/cases", response_model=CaseResponse, status_code=201)
    async def create_case(
        payload: CaseCreate,
        resident: User = Depends(require_resident),
        db: AsyncSession = Depends(get_db),
    ):
        if payload.category not in CATEGORIES_BY_TYPE[payload.type]:
            raise HTTPException(status_code=422, detail="Please select a valid category for this submission type.")
        if payload.type == CaseType.REQUEST:
            if payload.appointment_date is None:
                raise HTTPException(status_code=422, detail="Please select an appointment date.")
            appointment_time, appointment_duration = await reserve_appointment(db, payload.appointment_date, payload.appointment_time)
        else:
            appointment_time = None
            appointment_duration = None
            if payload.appointment_date is not None or payload.appointment_time is not None:
                raise HTTPException(status_code=422, detail="Appointment dates are only available for service requests.")
            if len(payload.description.strip()) < 10:
                raise HTTPException(status_code=422, detail="Please describe your concern in at least 10 characters.")
        reference = f"BCRTS-{datetime.now(timezone.utc):%Y}-{secrets.token_hex(3).upper()}"
        case = CaseRecord(
            reference_number=reference,
            resident_id=resident.id,
            type=payload.type.value,
            category=payload.category,
            subject=payload.subject.strip(),
            description=payload.description.strip(),
            appointment_date=payload.appointment_date,
            appointment_time=appointment_time,
            appointment_duration_minutes=appointment_duration,
            status=CaseStatus.RECEIVED.value,
        )
        case.resident = resident
        db.add(case)
        await db.flush()
        db.add(
            CaseStatusHistory(
                case_id=case.id,
                actor_id=resident.id,
                from_status=None,
                to_status=CaseStatus.RECEIVED.value,
            )
        )
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

    @app.get("/api/cases/{case_id}/history", response_model=list[CaseHistoryResponse])
    async def case_history(
        case_id: int,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        case = await db.get(CaseRecord, case_id)
        if case is None or (user.role == UserRole.RESIDENT.value and case.resident_id != user.id):
            raise HTTPException(status_code=404, detail="Case not found")
        query = (
            select(CaseStatusHistory)
            .where(CaseStatusHistory.case_id == case_id)
            .options(selectinload(CaseStatusHistory.actor))
            .order_by(CaseStatusHistory.created_at.asc())
        )
        return list((await db.scalars(query)).all())

    @app.get("/api/cases/{case_id}/notes", response_model=list[CaseNoteResponse])
    async def case_notes(
        case_id: int,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        case = await db.get(CaseRecord, case_id)
        if case is None or (user.role == UserRole.RESIDENT.value and case.resident_id != user.id):
            raise HTTPException(status_code=404, detail="Case not found")
        query = (
            select(CaseNote)
            .where(CaseNote.case_id == case_id)
            .options(selectinload(CaseNote.author))
            .order_by(CaseNote.created_at.asc())
        )
        return list((await db.scalars(query)).all())

    @app.post("/api/cases/{case_id}/notes", response_model=CaseNoteResponse, status_code=201)
    async def add_case_note(
        case_id: int,
        payload: CaseNoteCreate,
        staff: User = Depends(require_staff),
        db: AsyncSession = Depends(get_db),
    ):
        case = await db.get(CaseRecord, case_id)
        if case is None:
            raise HTTPException(status_code=404, detail="Case not found")
        body = payload.body.strip()
        if len(body) < 2:
            raise HTTPException(status_code=422, detail="Note cannot be blank")
        note = CaseNote(case_id=case_id, author_id=staff.id, body=body, author=staff)
        db.add(note)
        await db.commit()
        await db.refresh(note)
        return note

    @app.patch("/api/cases/{case_id}/status", response_model=CaseResponse)
    async def update_status(
        case_id: int,
        payload: CaseStatusUpdate,
        staff: User = Depends(require_staff),
        db: AsyncSession = Depends(get_db),
    ):
        case = await db.scalar(
            select(CaseRecord)
            .where(CaseRecord.id == case_id)
            .options(selectinload(CaseRecord.resident))
        )
        if case is None:
            raise HTTPException(status_code=404, detail="Case not found")
        if case.type == CaseType.REQUEST.value and case.appointment_date is not None:
            raise HTTPException(status_code=409, detail="Appointment scheduling is automatic. View this booking in Service Appointments.")
        if STATUS_ORDER.index(payload.status.value) <= STATUS_ORDER.index(case.status):
            raise HTTPException(status_code=409, detail="Case status can only move forward")
        previous_status = case.status
        case.status = payload.status.value
        db.add(
            CaseStatusHistory(
                case_id=case.id,
                actor_id=staff.id,
                from_status=previous_status,
                to_status=case.status,
            )
        )
        await db.commit()
        await db.refresh(case)
        return case

    return app


app = create_app()


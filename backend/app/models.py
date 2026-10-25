from datetime import date, datetime, time, timedelta, timezone
from enum import StrEnum

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, Time
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(StrEnum):
    RESIDENT = "resident"
    STAFF = "staff"


class CaseType(StrEnum):
    COMPLAINT = "complaint"
    REQUEST = "request"


class CaseStatus(StrEnum):
    RECEIVED = "Received"
    IN_PROGRESS = "In Progress"
    RESOLVED = "Resolved"
    CLOSED = "Closed"


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default=UserRole.RESIDENT.value)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    cases: Mapped[list["CaseRecord"]] = relationship(back_populates="resident")
    notes: Mapped[list["CaseNote"]] = relationship(back_populates="author")
    status_updates: Mapped[list["CaseStatusHistory"]] = relationship(back_populates="actor")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    password_fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class CaseRecord(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    resident_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(80))
    subject: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text)
    appointment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    appointment_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    appointment_duration_minutes: Mapped[int | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(30), default=CaseStatus.RECEIVED.value)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    resident: Mapped[User] = relationship(back_populates="cases")
    notes: Mapped[list["CaseNote"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    status_history: Mapped[list["CaseStatusHistory"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )

    @property
    def appointment_status(self) -> str | None:
        if self.type != CaseType.REQUEST.value or self.appointment_date is None:
            return None
        today = datetime.now(timezone(timedelta(hours=8))).date()
        if self.appointment_date < today:
            return "Past"
        return "Today" if self.appointment_date == today else "Upcoming"


class AppointmentSettings(Base):
    __tablename__ = "appointment_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    start_date: Mapped[date] = mapped_column(Date)
    interval_days: Mapped[int] = mapped_column(default=1)
    weekdays: Mapped[str] = mapped_column(String(20), default="0,1,2,3,4,5,6")
    opening_time: Mapped[time] = mapped_column(Time, default=time(9))
    closing_time: Mapped[time] = mapped_column(Time, default=time(17))
    slot_minutes: Mapped[int] = mapped_column(default=30)
    slot_capacity: Mapped[int] = mapped_column(default=2)
    daily_limit: Mapped[int] = mapped_column(default=30)
    # Updating this row serializes bookings and schedule edits across API workers.
    revision: Mapped[int] = mapped_column(default=0)


class CaseNote(Base):
    __tablename__ = "case_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    case: Mapped[CaseRecord] = relationship(back_populates="notes")
    author: Mapped[User] = relationship(back_populates="notes")


class CaseStatusHistory(Base):
    __tablename__ = "case_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    to_status: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    case: Mapped[CaseRecord] = relationship(back_populates="status_history")
    actor: Mapped[User] = relationship(back_populates="status_updates")


from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, Text
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


class CaseRecord(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    resident_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(80))
    subject: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default=CaseStatus.RECEIVED.value)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    resident: Mapped[User] = relationship(back_populates="cases")


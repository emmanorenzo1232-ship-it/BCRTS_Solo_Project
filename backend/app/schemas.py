from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .models import CaseStatus, CaseType, UserRole


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=8, max_length=128)


class MessageResponse(BaseModel):
    message: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: EmailStr
    role: UserRole
    created_at: datetime


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    role: UserRole


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserResponse


class CaseCreate(BaseModel):
    type: CaseType
    category: str = Field(min_length=2, max_length=80)
    subject: str = Field(min_length=3, max_length=150)
    description: str = Field(default="", max_length=5000)
    appointment_date: date | None = None
    appointment_time: time | None = None


class CaseStatusUpdate(BaseModel):
    status: CaseStatus


class CaseNoteCreate(BaseModel):
    body: str = Field(min_length=2, max_length=2000)


class ResidentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: EmailStr


class CaseNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    body: str
    created_at: datetime
    author: UserSummary


class CaseHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    from_status: CaseStatus | None
    to_status: CaseStatus
    created_at: datetime
    actor: UserSummary


class CaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference_number: str
    resident_id: int
    type: CaseType
    category: str
    subject: str
    description: str
    appointment_date: date | None
    appointment_time: time | None
    appointment_status: Literal["Upcoming", "Today", "Past"] | None
    status: CaseStatus
    created_at: datetime
    updated_at: datetime
    resident: ResidentSummary


class AppointmentSchedule(BaseModel):
    start_date: date
    interval_days: int = Field(ge=1, le=30)
    weekdays: list[int] = Field(min_length=1, max_length=7)
    opening_time: time
    closing_time: time
    slot_minutes: Literal[15, 30, 60]
    slot_capacity: int = Field(ge=1, le=100)
    daily_limit: int = Field(ge=1, le=1000)

    @model_validator(mode="after")
    def validate_schedule(self):
        if any(day < 0 or day > 6 for day in self.weekdays) or len(set(self.weekdays)) != len(self.weekdays):
            raise ValueError("Choose distinct weekdays from Monday (0) to Sunday (6).")
        for value in (self.opening_time, self.closing_time):
            if value.tzinfo is not None or value.second or value.microsecond:
                raise ValueError("Office hours must use local hours and minutes.")
        duration = (self.closing_time.hour * 60 + self.closing_time.minute) - (self.opening_time.hour * 60 + self.opening_time.minute)
        if duration < self.slot_minutes:
            raise ValueError("Closing time must allow at least one full appointment slot after opening.")
        return self


class AppointmentSlotResponse(BaseModel):
    time: time
    remaining: int


class AppointmentDayResponse(BaseModel):
    date: date
    scheduled: bool
    booked: int
    remaining: int
    slots: list[AppointmentSlotResponse]


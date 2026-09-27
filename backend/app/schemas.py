from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import CaseStatus, CaseType, UserRole


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: EmailStr
    role: UserRole
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserResponse


class CaseCreate(BaseModel):
    type: CaseType
    category: str = Field(min_length=2, max_length=80)
    subject: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=10, max_length=5000)


class CaseStatusUpdate(BaseModel):
    status: CaseStatus


class ResidentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: EmailStr


class CaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference_number: str
    resident_id: int
    type: CaseType
    category: str
    subject: str
    description: str
    status: CaseStatus
    created_at: datetime
    updated_at: datetime
    resident: ResidentSummary


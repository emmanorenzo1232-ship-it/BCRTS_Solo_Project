from dataclasses import dataclass
import os

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bcrts.db")
    jwt_secret: str = os.getenv("JWT_SECRET", "development-only-change-me")
    jwt_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
    staff_name: str | None = os.getenv("STAFF_NAME")
    staff_email: str | None = os.getenv("STAFF_EMAIL")
    staff_password: str | None = os.getenv("STAFF_PASSWORD")
    frontend_origin: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")


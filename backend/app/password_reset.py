from collections import deque
from email.message import EmailMessage
import hashlib
import logging
import smtplib
import ssl
import time
from urllib.parse import urlencode

from .config import Settings

logger = logging.getLogger(__name__)


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ResetRateLimiter:
    """Bound reset requests per client in this API process."""

    def __init__(self) -> None:
        self.attempts: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int = 5, window: int = 900) -> bool:
        now = time.monotonic()
        self.attempts = {
            client: times for client, times in self.attempts.items()
            if times and times[-1] > now - window
        }
        if key not in self.attempts and len(self.attempts) >= 10000:
            return False
        times = self.attempts.setdefault(key, deque())
        while times and times[0] <= now - window:
            times.popleft()
        if len(times) >= limit:
            return False
        times.append(now)
        return True


def send_password_reset(settings: Settings, email: str, token: str) -> None:
    # The URL comes from trusted configuration, never the request's Host header.
    # A fragment keeps the token out of web server access logs and Referer headers.
    link = f"{settings.frontend_origin.rstrip('/')}/reset-password#{urlencode({'token': token})}"
    if settings.password_reset_delivery == "console":
        logger.warning("Development password reset link for %s: %s", email, link)
        return
    if settings.password_reset_delivery != "smtp" or not settings.smtp_host or not settings.smtp_from:
        raise ValueError("Configure PASSWORD_RESET_DELIVERY, SMTP_HOST, and SMTP_FROM")

    message = EmailMessage()
    message["Subject"] = "Reset your BCRTS password"
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content(
        f"Use this link to choose a new BCRTS password:\n\n{link}\n\n"
        f"This link expires in {settings.password_reset_expire_minutes} minutes and works once.\n"
        "If you did not request a password reset, you can ignore this email."
    )
    connection = smtplib.SMTP_SSL if settings.smtp_ssl else smtplib.SMTP
    options = {"context": ssl.create_default_context()} if settings.smtp_ssl else {}
    with connection(settings.smtp_host, settings.smtp_port, timeout=15, **options) as smtp:
        if settings.smtp_starttls and not settings.smtp_ssl:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)

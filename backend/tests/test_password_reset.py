from dataclasses import replace
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from app.main import create_app
from app.models import PasswordResetToken
from app.password_reset import hash_reset_token, send_password_reset


@pytest.fixture
def deliveries(monkeypatch):
    messages = []
    monkeypatch.setattr("app.main.send_password_reset", lambda settings, email, token: messages.append((email, token)))
    return messages


async def request_link(client, email="juan@example.com"):
    return await client.post("/api/auth/forgot-password", json={"email": email})


@pytest.mark.parametrize("account", ["resident", "staff"])
async def test_password_reset_and_session_invalidation(client, account, resident, staff, deliveries):
    session = resident if account == "resident" else staff
    email = session["user"]["email"]
    response = await request_link(client, email.upper())
    assert response.status_code == 202
    assert len(deliveries) == 1
    assert deliveries[0][0] == email
    token = deliveries[0][1]
    assert token not in response.text
    async with client._transport.app.state.sessionmaker() as db:
        stored = await db.scalar(select(PasswordResetToken))
        assert stored.token_hash == hash_reset_token(token)
        assert stored.token_hash != token

    reset = await client.post("/api/auth/reset-password", json={"token": token, "password": "new-secure-pass"})
    assert reset.status_code == 200
    old_password = "resident-pass" if account == "resident" else "staff-password"
    assert (await client.post("/api/auth/login", json={"email": email, "password": old_password})).status_code == 401
    assert (await client.get("/api/auth/me", headers={"Authorization": f"Bearer {session['access_token']}"})).status_code == 401
    login = await client.post("/api/auth/login", json={"email": email, "password": "new-secure-pass"})
    assert login.status_code == 200
    assert (await client.get("/api/auth/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"})).status_code == 200
    assert (await client.post("/api/auth/reset-password", json={"token": token, "password": "another-pass"})).status_code == 400
    async with client._transport.app.state.sessionmaker() as db:
        assert await db.scalar(select(PasswordResetToken)) is None


async def test_unknown_account_and_resend_cooldown(client, resident, deliveries):
    unknown = await request_link(client, "unknown@example.com")
    assert deliveries == []
    known = await request_link(client)
    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    assert (await request_link(client)).json() == known.json()
    assert len(deliveries) == 1


async def test_expired_invalid_and_weak_passwords(client, resident, deliveries):
    await request_link(client)
    token = deliveries[0][1]
    assert (await client.post("/api/auth/reset-password", json={"token": token, "password": "short"})).status_code == 422
    invalid = await client.post("/api/auth/reset-password", json={"token": "wrong-token", "password": "valid-password"})
    assert invalid.status_code == 400
    async with client._transport.app.state.sessionmaker() as db:
        await db.execute(update(PasswordResetToken).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await db.commit()
    expired = await client.post("/api/auth/reset-password", json={"token": token, "password": "valid-password"})
    assert expired.status_code == 400
    assert expired.json() == invalid.json()
    assert (await client.post("/api/auth/login", json={"email": "juan@example.com", "password": "resident-pass"})).status_code == 200


async def test_reset_invalidates_all_outstanding_links(client, resident, deliveries):
    await request_link(client)
    async with client._transport.app.state.sessionmaker() as db:
        await db.execute(update(PasswordResetToken).values(created_at=datetime.now(timezone.utc) - timedelta(minutes=2)))
        await db.commit()
    await request_link(client)
    assert len(deliveries) == 2
    assert (await client.post("/api/auth/reset-password", json={"token": deliveries[1][1], "password": "new-password"})).status_code == 200
    assert (await client.post("/api/auth/reset-password", json={"token": deliveries[0][1], "password": "other-password"})).status_code == 400


async def test_reset_request_throttle(client, deliveries):
    for _ in range(5):
        assert (await request_link(client, "unknown@example.com")).status_code == 202
    assert (await request_link(client, "unknown@example.com")).status_code == 429


async def test_reset_link_survives_backend_restart(client, resident, deliveries):
    await request_link(client)
    restarted_app = create_app(client._transport.app.state.settings)
    async with restarted_app.router.lifespan_context(restarted_app):
        async with AsyncClient(transport=ASGITransport(app=restarted_app), base_url="http://restarted") as restarted:
            reset = await restarted.post("/api/auth/reset-password", json={"token": deliveries[0][1], "password": "new-password"})
    assert reset.status_code == 200


async def test_failed_delivery_allows_retry(client, resident, monkeypatch):
    failed = MagicMock(side_effect=OSError("Mail server unavailable"))
    monkeypatch.setattr("app.main.send_password_reset", failed)
    assert (await request_link(client)).status_code == 202
    assert (await request_link(client)).status_code == 202
    assert failed.call_count == 2
    async with client._transport.app.state.sessionmaker() as db:
        assert await db.scalar(select(PasswordResetToken)) is None


async def test_console_and_smtp_delivery(client, caplog):
    settings = replace(client._transport.app.state.settings, password_reset_delivery="console")
    send_password_reset(settings, "juan@example.com", "test-token")
    link = caplog.records[-1].getMessage().split()[-1]
    assert urlparse(link).path == "/reset-password"
    assert parse_qs(urlparse(link).fragment) == {"token": ["test-token"]}

    settings = replace(settings, password_reset_delivery="smtp", smtp_host="mail.example.com", smtp_from="noreply@example.com", smtp_username="mailer", smtp_password="secret")
    with patch("app.password_reset.smtplib.SMTP") as server:
        send_password_reset(settings, "juan@example.com", "test-token")
    smtp = server.return_value.__enter__.return_value
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("mailer", "secret")
    message = smtp.send_message.call_args.args[0]
    assert message["To"] == "juan@example.com"
    assert link in message.get_content()

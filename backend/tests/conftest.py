from dataclasses import replace
import asyncio
from contextlib import suppress

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
async def client(tmp_path):
    # Python 3.14's test event loop can miss worker-thread wakeups while idle;
    # this timer keeps a scheduled wakeup available for aiosqlite callbacks.
    async def event_loop_heartbeat():
        while True:
            await asyncio.sleep(0.01)

    heartbeat = asyncio.create_task(event_loop_heartbeat())
    settings = replace(
        Settings(),
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        jwt_secret="test-secret",
        staff_name="Test Staff",
        staff_email="staff@example.com",
        staff_password="staff-password",
    )
    app = create_app(settings)
    try:
        async with app.router.lifespan_context(app):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
                yield http
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat


@pytest.fixture
async def resident(client):
    response = await client.post(
        "/api/auth/register",
        json={"name": "Juan Resident", "email": "juan@example.com", "password": "resident-pass"},
    )
    return response.json()


@pytest.fixture
async def staff(client):
    response = await client.post(
        "/api/auth/login",
        json={"email": "staff@example.com", "password": "staff-password"},
    )
    return response.json()

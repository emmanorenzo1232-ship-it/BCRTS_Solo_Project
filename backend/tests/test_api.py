from sqlalchemy import select
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.models import User


def auth(session):
    return {"Authorization": f"Bearer {session['access_token']}"}


async def create_case(client, resident):
    return await client.post(
        "/api/cases",
        headers=auth(resident),
        json={
            "type": "complaint",
            "category": "Drainage",
            "subject": "Blocked canal",
            "description": "The canal has been blocked for several days.",
        },
    )


async def test_registration_login_and_password_hash(client):
    registration = await client.post(
        "/api/auth/register",
        json={"name": "Maria", "email": "MARIA@example.com", "password": "secure-pass"},
    )
    assert registration.status_code == 201
    assert registration.json()["user"]["role"] == "resident"
    duplicate = await client.post(
        "/api/auth/register",
        json={"name": "Maria", "email": "maria@example.com", "password": "secure-pass"},
    )
    assert duplicate.status_code == 409
    async with client._transport.app.state.sessionmaker() as db:
        user = await db.scalar(select(User).where(User.email == "maria@example.com"))
        assert user.password_hash != "secure-pass"
    login = await client.post(
        "/api/auth/login", json={"email": "maria@example.com", "password": "secure-pass"}
    )
    assert login.status_code == 200


async def test_auth_validation_and_case_creation(client, resident):
    assert (await client.get("/api/auth/me")).status_code == 401
    invalid = await client.post(
        "/api/cases", headers=auth(resident), json={"type": "complaint", "category": "Unknown"}
    )
    assert invalid.status_code == 422
    created = await create_case(client, resident)
    assert created.status_code == 201
    assert created.json()["status"] == "Received"
    assert created.json()["reference_number"].startswith("BCRTS-")


async def test_resident_ownership_staff_queue_and_status_flow(client, resident, staff):
    created = await create_case(client, resident)
    case_id = created.json()["id"]
    other = await client.post(
        "/api/auth/register",
        json={"name": "Other User", "email": "other@example.com", "password": "other-pass"},
    )
    assert (await client.get(f"/api/cases/{case_id}", headers=auth(other.json()))).status_code == 404
    assert (await client.get("/api/cases", headers=auth(other.json()))).json() == []
    staff_cases = await client.get("/api/cases", headers=auth(staff))
    assert len(staff_cases.json()) == 1
    forbidden = await client.patch(
        f"/api/cases/{case_id}/status", headers=auth(resident), json={"status": "In Progress"}
    )
    assert forbidden.status_code == 403
    updated = await client.patch(
        f"/api/cases/{case_id}/status", headers=auth(staff), json={"status": "Resolved"}
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "Resolved"
    backwards = await client.patch(
        f"/api/cases/{case_id}/status", headers=auth(staff), json={"status": "Received"}
    )
    assert backwards.status_code == 409
    resident_view = await client.get(f"/api/cases/{case_id}", headers=auth(resident))
    assert resident_view.json()["status"] == "Resolved"


async def test_data_persists_for_a_new_app_instance(client, resident):
    created = await create_case(client, resident)
    assert created.status_code == 201

    original_app = client._transport.app
    restarted_app = create_app(original_app.state.settings)
    async with restarted_app.router.lifespan_context(restarted_app):
        transport = ASGITransport(app=restarted_app)
        async with AsyncClient(transport=transport, base_url="http://restarted") as restarted:
            login = await restarted.post(
                "/api/auth/login",
                json={"email": "juan@example.com", "password": "resident-pass"},
            )
            persisted = await restarted.get("/api/cases", headers=auth(login.json()))

    assert persisted.status_code == 200
    assert persisted.json()[0]["reference_number"] == created.json()["reference_number"]


async def test_case_history_and_staff_notes(client, resident, staff):
    created = await create_case(client, resident)
    case_id = created.json()["id"]

    initial_history = await client.get(f"/api/cases/{case_id}/history", headers=auth(resident))
    assert initial_history.status_code == 200
    assert [(event["from_status"], event["to_status"]) for event in initial_history.json()] == [
        (None, "Received")
    ]

    posted = await client.post(
        f"/api/cases/{case_id}/notes",
        headers=auth(staff),
        json={"body": "The drainage team has been notified."},
    )
    assert posted.status_code == 201
    assert posted.json()["author"]["role"] == "staff"

    resident_notes = await client.get(f"/api/cases/{case_id}/notes", headers=auth(resident))
    assert resident_notes.json()[0]["body"] == "The drainage team has been notified."

    await client.patch(
        f"/api/cases/{case_id}/status",
        headers=auth(staff),
        json={"status": "In Progress"},
    )
    updated_history = await client.get(f"/api/cases/{case_id}/history", headers=auth(resident))
    assert [(event["from_status"], event["to_status"]) for event in updated_history.json()] == [
        (None, "Received"),
        ("Received", "In Progress"),
    ]

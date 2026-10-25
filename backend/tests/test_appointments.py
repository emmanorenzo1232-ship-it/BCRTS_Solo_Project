from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, inspect

from app.main import create_app
from app.migrations import add_appointment_date


def barangay_today():
    return datetime.now(timezone(timedelta(hours=8))).date()


def service_payload(**changes):
    return {
        "type": "request",
        "category": "Barangay clearance",
        "subject": "Clearance for employment",
        "appointment_date": (barangay_today() + timedelta(days=1)).isoformat(),
        **changes,
    }


async def test_appointment_without_description_persists_and_is_visible_to_staff(client, resident, staff):
    headers = {"Authorization": f"Bearer {resident['access_token']}"}
    payload = service_payload()
    created = await client.post("/api/cases", headers=headers, json=payload)
    assert created.status_code == 201
    assert created.json()["appointment_date"] == payload["appointment_date"]
    assert created.json()["description"] == ""
    case_id = created.json()["id"]
    staff_headers = {"Authorization": f"Bearer {staff['access_token']}"}
    assert (await client.get("/api/cases", headers=staff_headers)).json()[0]["appointment_date"] == payload["appointment_date"]
    assert (await client.get(f"/api/cases/{case_id}", headers=staff_headers)).json()["appointment_date"] == payload["appointment_date"]

    restarted_app = create_app(client._transport.app.state.settings)
    async with restarted_app.router.lifespan_context(restarted_app):
        async with AsyncClient(transport=ASGITransport(app=restarted_app), base_url="http://test") as restarted:
            persisted = await restarted.get(f"/api/cases/{case_id}", headers=headers)
    assert persisted.status_code == 200
    assert persisted.json()["appointment_date"] == payload["appointment_date"]


@pytest.mark.parametrize("appointment_date", [None, "yesterday", "not-a-date"])
async def test_service_requires_a_valid_current_or_future_date(client, resident, appointment_date):
    if appointment_date == "yesterday":
        appointment_date = (barangay_today() - timedelta(days=1)).isoformat()
    response = await client.post(
        "/api/cases",
        headers={"Authorization": f"Bearer {resident['access_token']}"},
        json=service_payload(appointment_date=appointment_date),
    )
    assert response.status_code == 422


async def test_service_requires_an_appointment_date_when_omitted(client, resident):
    payload = service_payload()
    del payload["appointment_date"]
    response = await client.post(
        "/api/cases", headers={"Authorization": f"Bearer {resident['access_token']}"}, json=payload,
    )
    assert response.status_code == 422
    assert "appointment date" in response.json()["error"]["message"]


@pytest.mark.parametrize("description", ["", "Too short", "          "])
async def test_concerns_still_require_a_description(client, resident, description):
    response = await client.post(
        "/api/cases",
        headers={"Authorization": f"Bearer {resident['access_token']}"},
        json={"type": "complaint", "category": "Drainage", "subject": "Blocked canal", "description": description},
    )
    assert response.status_code == 422


async def test_concerns_cannot_book_appointments(client, resident):
    response = await client.post(
        "/api/cases",
        headers={"Authorization": f"Bearer {resident['access_token']}"},
        json=service_payload(type="complaint", category="Drainage", description="The canal is blocked near my house."),
    )
    assert response.status_code == 422
    assert "only available for service requests" in response.json()["error"]["message"]


def test_existing_database_upgrade_preserves_cases_and_can_run_twice(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE cases (id INTEGER PRIMARY KEY, subject VARCHAR(150))")
            connection.exec_driver_sql("INSERT INTO cases VALUES (1, 'Existing clearance request')")
            add_appointment_date(connection)
            add_appointment_date(connection)
            row = connection.exec_driver_sql("SELECT subject, appointment_date FROM cases WHERE id = 1").one()
            assert row == ("Existing clearance request", None)
            column = next(column for column in inspect(connection).get_columns("cases") if column["name"] == "appointment_date")
            assert column["nullable"]
    finally:
        engine.dispose()

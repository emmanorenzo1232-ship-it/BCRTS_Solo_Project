import asyncio
from datetime import datetime, time, timedelta, timezone

import pytest
from sqlalchemy import update

from app import appointments
from app.main import create_app
from app.migrations import add_appointment_time
from app.models import CaseRecord
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine


def auth(session):
    return {"Authorization": f"Bearer {session['access_token']}"}


def tomorrow():
    return appointments.local_now().date() + timedelta(days=1)


def booking(day=None, **changes):
    return {
        "type": "request", "category": "Barangay clearance", "subject": "Employment clearance",
        "appointment_date": (day or tomorrow()).isoformat(), **changes,
    }


async def set_schedule(client, staff, **changes):
    current = (await client.get("/api/appointments/settings", headers=auth(staff))).json()
    response = await client.put("/api/appointments/settings", headers=auth(staff), json={**current, **changes})
    assert response.status_code == 200, response.text
    return response.json()


async def test_booking_is_immediately_confirmed_and_omitted_time_uses_first_slot(client, resident, staff):
    created = await client.post("/api/cases", headers=auth(resident), json=booking())
    assert created.status_code == 201
    assert created.json()["appointment_time"] == "09:00:00"
    assert created.json()["appointment_status"] == "Upcoming"
    day = tomorrow().isoformat()
    availability = await client.get(f"/api/appointments/availability?start_date={day}&end_date={day}", headers=auth(resident))
    assert availability.json()[0]["booked"] == 1
    assert availability.json()[0]["remaining"] == 29
    assert availability.json()[0]["slots"][0]["remaining"] == 1
    rows = await client.get(f"/api/appointments?start_date={day}&end_date={day}", headers=auth(staff))
    assert rows.json()[0]["id"] == created.json()["id"]
    assert (await client.patch(f"/api/cases/{created.json()['id']}/status", headers=auth(staff), json={"status": "In Progress"})).status_code == 409


async def test_every_other_day_weekdays_and_booking_horizon(client, resident, staff):
    start = tomorrow()
    await set_schedule(client, staff, start_date=start.isoformat(), interval_days=2)
    allowed = await client.post("/api/cases", headers=auth(resident), json=booking(start))
    closed = await client.post("/api/cases", headers=auth(resident), json=booking(start + timedelta(days=1)))
    next_allowed = await client.post("/api/cases", headers=auth(resident), json=booking(start + timedelta(days=2)))
    assert allowed.status_code == next_allowed.status_code == 201
    assert closed.status_code == 409
    # A weekday exclusion closes a date even when it falls on the interval.
    await set_schedule(client, staff, weekdays=[(start.weekday() + 1) % 7])
    assert (await client.post("/api/cases", headers=auth(resident), json=booking(start))).status_code == 409
    far_future = appointments.local_now().date() + timedelta(days=91)
    assert (await client.post("/api/cases", headers=auth(resident), json=booking(far_future))).status_code == 422


async def test_per_slot_and_daily_limits_are_enforced_and_failed_bookings_leave_no_record(client, resident, staff):
    await set_schedule(client, staff, slot_capacity=1, daily_limit=2)
    first = await client.post("/api/cases", headers=auth(resident), json=booking(appointment_time="09:00"))
    taken = await client.post("/api/cases", headers=auth(resident), json=booking(appointment_time="09:00"))
    second = await client.post("/api/cases", headers=auth(resident), json=booking())
    full = await client.post("/api/cases", headers=auth(resident), json=booking(appointment_time="10:00"))
    assert first.status_code == second.status_code == 201
    assert second.json()["appointment_time"] == "09:30:00"
    assert taken.status_code == full.status_code == 409
    assert len((await client.get("/api/cases", headers=auth(resident))).json()) == 2


async def test_simultaneous_requests_cannot_overbook_the_last_place(client, resident, staff):
    await set_schedule(client, staff, daily_limit=1, slot_capacity=1)
    results = await asyncio.gather(*[
        client.post("/api/cases", headers=auth(resident), json=booking(appointment_time="09:00"))
        for _ in range(3)
    ])
    assert sorted(response.status_code for response in results) == [201, 409, 409]


async def test_same_day_past_slots_and_after_hours_are_unavailable(client, resident, monkeypatch):
    today = appointments.local_now().date()
    monkeypatch.setattr(appointments, "local_now", lambda: datetime.combine(today, time(9, 20), tzinfo=timezone(timedelta(hours=8))))
    past_slot = await client.post("/api/cases", headers=auth(resident), json=booking(today, appointment_time="09:00"))
    assert past_slot.status_code == 409
    created = await client.post("/api/cases", headers=auth(resident), json=booking(today))
    assert created.status_code == 201
    assert created.json()["appointment_time"] == "09:30:00"
    monkeypatch.setattr(appointments, "local_now", lambda: datetime.combine(today, time(17), tzinfo=timezone(timedelta(hours=8))))
    assert (await client.post("/api/cases", headers=auth(resident), json=booking(today))).status_code == 409


async def test_access_boundaries_and_date_range_validation(client, resident, staff):
    day = tomorrow().isoformat()
    assert (await client.get("/api/appointments/settings")).status_code == 401
    assert (await client.get(f"/api/appointments?start_date={day}&end_date={day}", headers=auth(resident))).status_code == 403
    schedule = (await client.get("/api/appointments/settings", headers=auth(resident))).json()
    assert (await client.put("/api/appointments/settings", headers=auth(resident), json=schedule)).status_code == 403
    assert (await client.get(f"/api/appointments/availability?start_date={day}&end_date=2000-01-01", headers=auth(staff))).status_code == 422
    assert (await client.get("/api/appointments/availability?start_date=2026-01-01&end_date=2028-01-01", headers=auth(resident))).status_code == 422


@pytest.mark.parametrize("changes", [
    {"daily_limit": 0}, {"slot_capacity": 0}, {"weekdays": []}, {"weekdays": [0, 0]},
    {"weekdays": [7]}, {"interval_days": 0}, {"closing_time": "08:00"},
    {"slot_minutes": 20}, {"opening_time": "09:00:05"}, {"opening_time": "09:00+08:00"},
])
async def test_invalid_schedules_are_rejected(client, staff, changes):
    schedule = (await client.get("/api/appointments/settings", headers=auth(staff))).json()
    response = await client.put("/api/appointments/settings", headers=auth(staff), json={**schedule, **changes})
    assert response.status_code == 422


async def test_schedule_edits_and_restart_preserve_confirmed_bookings(client, resident, staff):
    created = (await client.post("/api/cases", headers=auth(resident), json=booking(appointment_time="10:00"))).json()
    await set_schedule(client, staff, start_date=(tomorrow() + timedelta(days=1)).isoformat(), interval_days=2, daily_limit=1)
    restarted_app = create_app(client._transport.app.state.settings)
    async with restarted_app.router.lifespan_context(restarted_app):
        async with AsyncClient(transport=ASGITransport(app=restarted_app), base_url="http://test") as restarted:
            stored = (await restarted.get(f"/api/cases/{created['id']}", headers=auth(resident))).json()
            assert stored["appointment_date"] == created["appointment_date"]
            assert stored["appointment_time"] == "10:00:00"
            assert (await restarted.get("/api/appointments/settings", headers=auth(staff))).json()["interval_days"] == 2


@pytest.mark.parametrize(("old_minutes", "old_time", "new_minutes"), [(30, "09:30", 60), (60, "09:00", 15)])
async def test_changing_slot_duration_does_not_overbook_existing_appointments(client, resident, staff, old_minutes, old_time, new_minutes):
    await set_schedule(client, staff, slot_capacity=1, slot_minutes=old_minutes)
    assert (await client.post("/api/cases", headers=auth(resident), json=booking(appointment_time=old_time))).status_code == 201
    await set_schedule(client, staff, slot_minutes=new_minutes)
    overlap = await client.post("/api/cases", headers=auth(resident), json=booking(appointment_time="09:45" if new_minutes == 15 else "09:00"))
    assert overlap.status_code == 409
    next_booking = await client.post("/api/cases", headers=auth(resident), json=booking())
    assert next_booking.status_code == 201
    assert next_booking.json()["appointment_time"] == "10:00:00"


async def test_date_groups_are_derived_without_marking_services_complete(client, resident, staff):
    created = (await client.post("/api/cases", headers=auth(resident), json=booking())).json()
    today = appointments.local_now().date()
    async with client._transport.app.state.sessionmaker() as db:
        await db.execute(update(CaseRecord).where(CaseRecord.id == created["id"]).values(appointment_date=today))
        await db.commit()
    assert (await client.get(f"/api/cases/{created['id']}", headers=auth(resident))).json()["appointment_status"] == "Today"
    async with client._transport.app.state.sessionmaker() as db:
        await db.execute(update(CaseRecord).where(CaseRecord.id == created["id"]).values(appointment_date=today - timedelta(days=1)))
        await db.commit()
    past = (await client.get(f"/api/cases/{created['id']}", headers=auth(resident))).json()
    assert past["appointment_status"] == "Past"
    assert past["status"] == "Received"
    assert len((await client.get(f"/api/cases/{created['id']}/history", headers=auth(staff))).json()) == 1


def test_legacy_time_migration_preserves_existing_data_and_is_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy_time.db'}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE cases (id INTEGER PRIMARY KEY, appointment_date DATE)")
            connection.exec_driver_sql("INSERT INTO cases VALUES (1, '2026-10-30')")
            add_appointment_time(connection)
            add_appointment_time(connection)
            assert connection.exec_driver_sql("SELECT appointment_date, appointment_time FROM cases").one() == ("2026-10-30", None)
    finally:
        engine.dispose()

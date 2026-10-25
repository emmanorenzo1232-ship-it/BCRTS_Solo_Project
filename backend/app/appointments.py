"""Appointment availability and atomic booking in Philippine local time."""

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AppointmentSettings, CaseRecord, CaseType
from .schemas import AppointmentDayResponse, AppointmentSchedule, AppointmentSlotResponse

BARANGAY_TIMEZONE = timezone(timedelta(hours=8))
BOOKING_HORIZON_DAYS = 90


def local_now() -> datetime:
    return datetime.now(BARANGAY_TIMEZONE)


async def initialize_schedule(db: AsyncSession) -> None:
    if await db.get(AppointmentSettings, 1) is None:
        db.add(AppointmentSettings(id=1, start_date=local_now().date()))
        await db.commit()


async def lock_schedule(db: AsyncSession) -> AppointmentSettings:
    # Take a database write lock before counting bookings. This prevents two
    # workers from both confirming the last place in a slot or day.
    await db.execute(update(AppointmentSettings).where(AppointmentSettings.id == 1).values(
        revision=AppointmentSettings.revision + 1
    ))
    return await db.get(AppointmentSettings, 1, populate_existing=True)


def schedule_response(settings: AppointmentSettings) -> AppointmentSchedule:
    return AppointmentSchedule(
        start_date=settings.start_date, interval_days=settings.interval_days,
        weekdays=[int(day) for day in settings.weekdays.split(",")],
        opening_time=settings.opening_time, closing_time=settings.closing_time,
        slot_minutes=settings.slot_minutes, slot_capacity=settings.slot_capacity,
        daily_limit=settings.daily_limit,
    )


def validate_range(start: date, end: date) -> None:
    if end < start or (end - start).days > 366:
        raise HTTPException(status_code=422, detail="Choose a date range of up to one year.")


async def availability(db: AsyncSession, settings: AppointmentSettings, start: date, end: date) -> list[AppointmentDayResponse]:
    validate_range(start, end)
    rows = (await db.execute(select(
        CaseRecord.appointment_date, CaseRecord.appointment_time, CaseRecord.appointment_duration_minutes,
    ).where(
        CaseRecord.type == CaseType.REQUEST.value,
        CaseRecord.appointment_date.between(start, end),
    ))).all()
    daily_counts = Counter(row.appointment_date for row in rows)
    booked_intervals = defaultdict(list)
    for row in rows:
        if row.appointment_time is not None:
            starts_at = datetime.combine(row.appointment_date, row.appointment_time)
            ends_at = starts_at + timedelta(minutes=row.appointment_duration_minutes or settings.slot_minutes)
            booked_intervals[row.appointment_date].append((starts_at, ends_at))
    now = local_now()
    weekdays = {int(day) for day in settings.weekdays.split(",")}
    result = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        elapsed = (day - settings.start_date).days
        scheduled = elapsed >= 0 and elapsed % settings.interval_days == 0 and day.weekday() in weekdays
        bookable = scheduled and now.date() <= day <= now.date() + timedelta(days=BOOKING_HORIZON_DAYS)
        daily_remaining = max(0, settings.daily_limit - daily_counts[day])
        slots = []
        cursor = datetime.combine(day, settings.opening_time)
        end_time = datetime.combine(day, settings.closing_time)
        while cursor + timedelta(minutes=settings.slot_minutes) <= end_time:
            slot_time = cursor.time()
            if bookable and (day > now.date() or slot_time > now.time().replace(tzinfo=None)):
                slot_end = cursor + timedelta(minutes=settings.slot_minutes)
                # Count overlapping appointments too, so editing office hours or
                # slot length cannot make an existing booking disappear from capacity.
                occupied = sum(start < slot_end and end > cursor for start, end in booked_intervals[day])
                slots.append(AppointmentSlotResponse(time=slot_time, remaining=min(
                    daily_remaining, max(0, settings.slot_capacity - occupied)
                )))
            cursor += timedelta(minutes=settings.slot_minutes)
        result.append(AppointmentDayResponse(
            date=day, scheduled=scheduled, booked=daily_counts[day],
            remaining=min(daily_remaining, sum(slot.remaining for slot in slots)), slots=slots,
        ))
    return result


async def reserve_appointment(db: AsyncSession, day: date, requested_time: time | None) -> tuple[time, int]:
    now = local_now()
    if day < now.date():
        raise HTTPException(status_code=422, detail="Appointment date must be today or a future date.")
    if day > now.date() + timedelta(days=BOOKING_HORIZON_DAYS):
        raise HTTPException(status_code=422, detail="Appointments can be booked up to 90 days ahead.")
    settings = await lock_schedule(db)
    details = (await availability(db, settings, day, day))[0]
    if not details.scheduled:
        raise HTTPException(status_code=409, detail="Appointments are unavailable on this date. Choose an available date.")
    if not details.remaining:
        raise HTTPException(status_code=409, detail="This date has no available appointments. Choose another date.")
    if requested_time is not None:
        if requested_time.tzinfo is not None:
            raise HTTPException(status_code=422, detail="Choose a local appointment time in Philippine time.")
        slot = next((slot for slot in details.slots if slot.time == requested_time), None)
        if slot is None or not slot.remaining:
            raise HTTPException(status_code=409, detail="This time slot is no longer available. Choose another slot.")
        return slot.time, settings.slot_minutes
    return next(slot.time for slot in details.slots if slot.remaining), settings.slot_minutes

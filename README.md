# Barangay Complaint and Request Tracking System

This repository contains the first working milestone of BCRTS: resident registration, case tracking, a staff queue, forward-only status updates, an auditable status timeline, and staff-to-resident case notes.

For a complete installation walkthrough starting from a clean Windows 11 computer, see [WINDOWS_SETUP.md](WINDOWS_SETUP.md).

## Requirements

- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
- [Node.js 20 or newer](https://nodejs.org/en/download) (npm is included)
- Python 3.11 or newer; the Windows instructions below install Python through `uv`

## Windows setup (PowerShell)

On a new Windows machine, install `uv` and Node.js LTS first:

```powershell
winget install --id=astral-sh.uv -e
winget install --id=OpenJS.NodeJS.LTS -e
```

Close and reopen PowerShell after installation, then verify `uv --version`, `node --version`, and `npm --version`. From the cloned project directory, set up and run the backend:

```powershell
cd backend
uv python install 3.13
uv venv --python 3.13 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements-dev.txt
Copy-Item .env.example .env
# Edit .env and replace JWT_SECRET and STAFF_PASSWORD.
.\.venv\Scripts\uvicorn.exe app.main:app --reload
```

In a second PowerShell terminal, run the frontend:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

Do not copy `.venv` or `node_modules` from Linux to Windows. Those directories are platform-specific and are recreated by the commands above.

## Linux/macOS setup

### Backend

```bash
cd backend
uv venv .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt
cp .env.example .env
# Replace JWT_SECRET and STAFF_PASSWORD in .env before sharing or deployment.
.venv/bin/uvicorn app.main:app --reload
```

Calling the executable from `.venv/bin` works in Bash, Zsh, and Fish without activating the environment. Fish users who prefer activation can run `source .venv/bin/activate.fish` and then use `uvicorn app.main:app --reload`.

The API runs at `http://localhost:8000`; interactive API documentation is available at `http://localhost:8000/docs`. The SQLite database is created as `backend/bcrts.db` and persists between restarts.

Run backend tests from `backend/`:

```bash
.venv/bin/pytest
```

### Frontend

In a second terminal:

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. Residents create their own accounts. Staff sign in with the `STAFF_EMAIL` and `STAFF_PASSWORD` configured in `backend/.env`.

Run frontend checks from `frontend/`:

```bash
npm test
npm run build
```

## Configuration

The backend reads `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRE_MINUTES`, `STAFF_NAME`, `STAFF_EMAIL`, `STAFF_PASSWORD`, and `FRONTEND_ORIGIN`. No staff account is created unless all three `STAFF_*` values are provided.

The frontend reads `VITE_API_URL`, defaulting to `http://localhost:8000/api`.

## Password recovery

Choose **Forgot password?** on the login page and enter the account email. The backend manages recovery for residents and staff; no external authentication service is required. By default, `PASSWORD_RESET_DELIVERY=console` prints the reset link in the terminal running the backend. Open that link, enter and confirm a new password, then sign in again. Links expire after 30 minutes and can be used once. A successful reset invalidates other reset links and existing login sessions for that account. Repeated requests for the same account within 60 seconds reuse the existing delivery; check the original terminal message or email.

Restart the backend after updating the code so it creates the reset-token table automatically; existing users and case records are preserved. `FRONTEND_ORIGIN` must match the frontend address used to open reset links. Adding session invalidation also requires users with sessions issued by the older code to sign in again once.

For email delivery later, set `PASSWORD_RESET_DELIVERY=smtp` and configure `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM` in `backend/.env`, plus `SMTP_USERNAME` and `SMTP_PASSWORD` if your mail server requires authentication. The default uses STARTTLS on port 587. For implicit TLS on port 465, set `SMTP_SSL=true` and `SMTP_PORT=465`. Console delivery is for local development only. `PASSWORD_RESET_EXPIRE_MINUTES` controls link lifetime. The API returns the same recovery message for existing and unknown accounts, limits requests per client in each backend process, and stores only hashes of reset tokens in the database.

## Service appointments

Service requests book confirmed appointments automatically. Residents select an available date and time in Philippine time (UTC+8), up to 90 days ahead; additional details are optional. The backend checks the configured booking days, office hours, per-slot capacity, and daily limit in the same database transaction as the booking. Simultaneous requests cannot exceed capacity. If a slot fills while the form is open, the resident sees a conflict and can select another slot. API callers omitting the time receive the first available slot on their chosen date.

Staff open **Service appointments** at `/staff/appointments` to see a monthly calendar with daily counts, inspect the residents and services booked on a date, and filter by Upcoming, Today, or Past within that month. Counts refresh every minute. Schedule groups are calculated by the backend from Philippine dates and require no manual approvals or scheduled background job. Past means the appointment date passed; it does not mark attendance, service completion, or document release. Scheduled services no longer use the complaint status buttons or appear in the case queue. Notes remain available to staff and residents.

Under **Booking settings**, staff configure a start date, a repeat interval (including every other day), allowed weekdays, opening and closing times, slot duration, appointments per slot, and daily booking limit. For a two-day interval, bookings occur on the start date and every two days afterward, skipping unchecked weekdays without shifting the interval. Defaults are every day, 09:00–17:00, 30-minute slots, two appointments per slot, and a daily limit of 30. No appointment can start at or before the current time. Schedule changes affect new bookings and preserve existing appointments, even if the new settings close their dates or lower capacity.

Restart the backend after updating. Startup creates the schedule settings table and automatically adds nullable `appointment_date` and `appointment_time` columns to an existing database, preserving users and case records. Existing requests with dates appear on the calendar and count toward the daily limit; dates are retained and no appointment time is invented. Requests without dates remain in the case queue. Residents' confirmed dates and times are shown on case cards and details.

## Moving to MySQL later

The application uses SQLAlchemy's async interface, so the service layer and API do not need to change. Before production migration, add Alembic migrations, install an async MySQL driver such as `asyncmy`, change `DATABASE_URL` to the MySQL connection string, apply the initial migration, and stop relying on startup-time `create_all`.

## Included and deferred

Included: JWT authentication, role checks, complaint/request submission, resident ownership boundaries, case details, staff queue filters, forward-only case statuses, status history, and staff notes visible to residents.

Deferred: attachments, assignments, notifications, profile and category management, reports, payments, document generation, and deployment infrastructure.

# Barangay Complaint and Request Tracking System

This repository contains the first functional milestone of BCRTS: resident registration and case tracking plus a basic staff queue and forward-only status updates.

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

## Moving to MySQL later

The application uses SQLAlchemy's async interface, so the service layer and API do not need to change. Before production migration, add Alembic migrations, install an async MySQL driver such as `asyncmy`, change `DATABASE_URL` to the MySQL connection string, apply the initial migration, and stop relying on startup-time `create_all`.

## Included and deferred

Included: JWT authentication, role checks, complaint/request submission, resident ownership boundaries, case details, staff queue filters, and forward-only case statuses.

Deferred: attachments, assignments, notes/history, notifications, profile and category management, reports, payments, document generation, and deployment infrastructure.

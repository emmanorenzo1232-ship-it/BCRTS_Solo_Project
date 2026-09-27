# BCRTS Setup Guide for Windows 11

This guide starts with a Windows 11 computer that does not have Python, `uv`, Node.js, or npm installed.

## 1. Open PowerShell

Open the Start menu, search for **PowerShell**, and open it. Administrator mode is not normally required.

Check that Windows Package Manager is available:

```powershell
winget --version
```

If `winget` is not recognized, install or update **App Installer** from the Microsoft Store, reopen PowerShell, and try again.

## 2. Install the required tools

Install `uv`, which will manage Python:

```powershell
winget install --id=astral-sh.uv -e
```

Install the current Node.js LTS release. npm is included with Node.js:

```powershell
winget install --id=OpenJS.NodeJS.LTS -e
```

Close PowerShell completely and open a new PowerShell window. Verify the installations:

```powershell
uv --version
node --version
npm.cmd --version
```

All three commands should print version numbers.

## 3. Obtain and open the project

Extract the project ZIP or clone the repository. Do not copy `.venv`, `node_modules`, `dist`, or `.env` from a Linux computer; they are machine-specific or contain local configuration.

In PowerShell, change into the extracted project directory. For example:

```powershell
cd "$HOME\Downloads\emman_system"
```

Confirm that the folder contains `backend`, `frontend`, and `README.md`:

```powershell
Get-ChildItem
```

## 4. Set up the backend

Enter the backend directory:

```powershell
cd backend
```

Install Python 3.13 through `uv`:

```powershell
uv python install 3.13
```

Create a project-local Python environment and install the backend dependencies:

```powershell
uv venv --python 3.13 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements-dev.txt
```

Create the local backend configuration:

```powershell
Copy-Item .env.example .env
notepad .env
```

Before saving, replace `JWT_SECRET` and `STAFF_PASSWORD`. A local configuration can look like this:

```dotenv
DATABASE_URL=sqlite+aiosqlite:///./bcrts.db
JWT_SECRET=replace-this-with-a-long-random-private-value
JWT_EXPIRE_MINUTES=480
STAFF_NAME=Barangay Staff
STAFF_EMAIL=staff@example.com
STAFF_PASSWORD=Choose-A-Private-Password-123!
FRONTEND_ORIGIN=http://localhost:5173
```

Do this before starting the backend for the first time. The initial staff account is created from these values.

Start the backend:

```powershell
.\.venv\Scripts\uvicorn.exe app.main:app --reload
```

Keep this PowerShell window open. A successful startup includes:

```text
Application startup complete.
Uvicorn running on http://127.0.0.1:8000
```

The API documentation is available at <http://localhost:8000/docs>.

If Windows Firewall asks for permission, allowing access on **Private networks** is sufficient for local development.

## 5. Set up the frontend

Open a second PowerShell window and return to the project directory:

```powershell
cd "$HOME\Downloads\emman_system\frontend"
```

Install the exact frontend dependency versions recorded in `package-lock.json`:

```powershell
npm.cmd ci
```

Create the frontend configuration:

```powershell
Copy-Item .env.example .env
```

Start the frontend:

```powershell
npm.cmd run dev
```

Keep this second window open and visit <http://localhost:5173>.

## 6. Sign in

- **Resident:** Select **Create an account** and register a new resident.
- **Staff:** Use the `STAFF_EMAIL` and `STAFF_PASSWORD` saved in `backend\.env`.

## Starting the system later

The installation steps only need to be completed once.

Start the backend in the first PowerShell window:

```powershell
cd "$HOME\Downloads\emman_system\backend"
.\.venv\Scripts\uvicorn.exe app.main:app --reload
```

Start the frontend in a second PowerShell window:

```powershell
cd "$HOME\Downloads\emman_system\frontend"
npm.cmd run dev
```

## Stopping or restarting

Press `Ctrl+C` in each PowerShell window to stop its development server. Run the two startup commands again to restart them. Restarting does not delete accounts or cases; they remain in `backend\bcrts.db`.

## Running tests

Backend tests, from the `backend` directory:

```powershell
.\.venv\Scripts\pytest.exe
```

Frontend tests, from the `frontend` directory:

```powershell
npm.cmd test
```

## Common Windows problems

### `uv`, `node`, or `npm` is not recognized

Close every PowerShell or VS Code window and open it again so Windows reloads `PATH`. Check the tools with:

```powershell
where.exe uv
where.exe node
where.exe npm
```

### PowerShell says running scripts is disabled

Use `npm.cmd` instead of `npm`. The commands in this guide already use `npm.cmd` and do not require changing PowerShell's execution policy.

### `.venv` already exists

Do not recreate it during normal startup. Run the existing executable directly:

```powershell
.\.venv\Scripts\uvicorn.exe app.main:app --reload
```

If the environment came from Linux or is damaged, remove only the backend environment and recreate it:

```powershell
Remove-Item -Recurse -Force .venv
uv venv --python 3.13 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements-dev.txt
```

### A port is already in use

Stop the previous backend or frontend terminal with `Ctrl+C`. To identify the process using a port:

```powershell
Get-NetTCPConnection -LocalPort 8000,5173 -ErrorAction SilentlyContinue |
    Select-Object LocalPort, State, OwningProcess
```

### Resetting local application data

Stopping the servers does not remove data. To intentionally start with an empty database, stop the backend and remove only `backend\bcrts.db`. This permanently deletes local accounts and cases; the database and staff account will be recreated on the next backend startup.


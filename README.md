# Roomie

CSE 115A Fall 2026. A React Native roommate app; the first feature is a household message board.

## Stack
- Frontend: React Native (Expo), in `frontend/`
- Backend: Node.js / Express, in `backend/`
- Database: PostgreSQL, in `database/`
- Authentication: Firebase Authentication

## Sprint 1
Send and receive messages between users, with a server-enforced 3-second cooldown per sender. Hardcode names for now.

## Team
Frontend: Sopeck. Backend: Nikhil and Austin. Database: Jacob and Enoch. Auth: TBA.

## Layout
```
frontend/   Expo app (App.js, src/{screens,components,navigation,hooks,context,services,constants,utils})
backend/    Express API (src/{routes,controllers,services,middleware,config,utils}, tests/)
database/   migrations/, seeds/, tests/, and the setup/migrate/test scripts
shared/     API contracts agreed between frontend and backend
docs/       architecture and sprint notes
```

## Setup
1. Local database (macOS, needs Homebrew from https://brew.sh). Run once; safe to re-run:
   ```
   ./database/setup-local.sh
   ```
   It installs Postgres 17, creates `roomie_dev`, and writes `DATABASE_URL=postgresql://localhost/roomie_dev` to `.env` at the repo root.
2. Backend:
   ```
   cd backend && npm install && npm run dev
   ```
   Check it at http://localhost:3000/health.
3. Frontend:
   ```
   cd frontend && npm install && npm start
   ```

Secrets live in the untracked root `.env`; `.env.example` lists the variable names.

## Execution
1. Run in terminal: cd frontend && npm start
2. Enter username and password for your account for the Expo Go app
3. Scan the given qr code
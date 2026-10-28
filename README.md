# Roomie

CSE 115A Fall 2026. A React Native roommate app; the first feature is a household message board.

## Stack
- Frontend: React Native (Expo), in `frontend/`
- Backend: Node.js / Express, in `backend/`
- Database: PostgreSQL, in `database/`
- Authentication: Temporary username/password accounts; Firebase is planned for a later sprint

## Sprint 1
Send and receive messages between users, with a server-enforced 3-second cooldown per sender.

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
   Re-run this command after pulling database migrations; it applies pending
   migrations and refreshes the demo seed data.
2. Backend:
   ```
   cd backend && npm install && npm run dev
   ```
   The backend reads `DATABASE_URL` from the root `.env`. Check that it is
   running with `curl http://localhost:3000/health`.

### API commands

Except signup, login, and health, requests require the bearer token returned
by signup or login. Passwords are stored as scrypt hashes. This is a prototype:
use HTTPS and Firebase token verification before using real accounts.

| Action | Request |
| --- | --- |
| Create account | `POST /users` with `{"username":"Alex","password":"long-password"}` |
| Sign in | `POST /sessions` with the same username/password |
| List conversations | `GET /conversations` (also `GET /convos`) |
| List messages | `GET /messages/:inviteCode` |
| List all users | `GET /users` |
| List conversation members | `GET /conversations/:inviteCode/users` |
| Send message | `POST /messages/:inviteCode` with `{"messageText":"Hello!"}` |
| Create conversation | `POST /conversations` with optional `{"name":"House chat"}` |
| Join conversation | `POST /conversations/:inviteCode/members` |
| Delete conversation | `DELETE /conversations/:inviteCode` (owner only) |
| Leave conversation | `DELETE /conversations/:inviteCode/members` |
| Delete own account | `DELETE /users/:username` (must match signed-in user) |
| Sign out | `DELETE /sessions` |

For example, after signing in, send the token as `Authorization: Bearer <token>`.
The backend derives the message author from that session; clients cannot choose
another username as the sender. A sender can post once every three seconds.

For Expo Go on a physical phone, replace `localhost` in the API URL with your
computer's LAN IP (for example `http://192.168.1.25:3000`). Keep the phone and
computer on the same network.

### Smoke test with curl

Run these commands in a second terminal while the backend is running. Use
distinct usernames each time you repeat the signup steps. Save each returned
`token` value and replace `<OWNER_TOKEN>`, `<MEMBER_TOKEN>`, and `<INVITE_CODE>`
below. `jq` is optional and only used to read the JSON response.

```sh
# Create two temporary test accounts (passwords must be at least 8 characters).
curl -i -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"roomie-owner-test","password":"test-password-123"}'
curl -i -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"roomie-member-test","password":"test-password-456"}'

# Sign in and copy the token from each response.
curl -i -X POST http://localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"username":"roomie-owner-test","password":"test-password-123"}'
curl -i -X POST http://localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"username":"roomie-member-test","password":"test-password-456"}'

# Create a household; copy its inviteCode from the response.
curl -i -X POST http://localhost:3000/conversations \
  -H 'Authorization: Bearer <OWNER_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"API smoke test"}'

# Join as the second test account, then check the member list.
curl -i -X POST http://localhost:3000/conversations/<INVITE_CODE>/members \
  -H 'Authorization: Bearer <MEMBER_TOKEN>'
curl -i http://localhost:3000/conversations/<INVITE_CODE>/users \
  -H 'Authorization: Bearer <OWNER_TOKEN>'

# Send a message, then read it back.
curl -i -X POST http://localhost:3000/messages/<INVITE_CODE> \
  -H 'Authorization: Bearer <OWNER_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"messageText":"Hello from the API"}'
curl -i http://localhost:3000/messages/<INVITE_CODE> \
  -H 'Authorization: Bearer <OWNER_TOKEN>'

# Immediately repeating the send should return HTTP 429 (cooldown).
curl -i -X POST http://localhost:3000/messages/<INVITE_CODE> \
  -H 'Authorization: Bearer <OWNER_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"messageText":"This should be rate limited"}'

# Remove only the test household and its test posts when finished.
curl -i -X DELETE http://localhost:3000/conversations/<INVITE_CODE> \
  -H 'Authorization: Bearer <OWNER_TOKEN>'
```

Expected status codes: signup `201`, login `200`, create/join/send `201`,
successful reads `200`, second rapid send `429`, and delete `204`. Invalid or
expired tokens return `401`; non-members cannot read or post in a conversation.
3. Frontend:
   ```
   cd frontend && npm install && npm start
   ```

Secrets live in the untracked root `.env`; `.env.example` lists the variable names.
# Roomie

CSE 115A Fall 2026. A React Native roommate app; the first feature is a household message board.

## Stack
- Frontend: React Native (Expo), in `frontend/`
- Backend: Node.js / Express, in `backend/`
- Database: PostgreSQL, in `database/`
- Authentication: Temporary username/password accounts; Firebase is planned for a later sprint

## Sprint 1
Send and receive messages between users, with a server-enforced 3-second cooldown per sender.

## Sprint 2
Implement chores and user ties. Functionality is limited depending on what a user does/doesn't do in their group.
Users have a complete/incomplete status on their chores/tasks in a roommate group. This is enforced in chores.ts by
add/update functions to set and update a status for each user.

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

Chore routes require an authenticated member of the household. Chore lists default
to the signed-in user and a title of `"<username>'s chores"`; set `assignee` to a
household member's username to assign it to them, or set it to `null` for a
whole-house list. A custom title can be up to 80 characters, and chore text can
be up to 200 characters. Successful list/item creation returns `201`, reads and
updates return `200`, and deletes return `204`.

| Action | Request |
| --- | --- |
| Create account | `POST /users` with `{"username":"Alex","password":"long-password"}` |
| Sign in | `POST /sessions` with the same username/password |
| List conversations | `GET /conversations` (also `GET /convos`) |
| List messages | `GET /messages/:inviteCode` |
| List all users | `GET /users` |
| List conversation members | `GET /conversations/:inviteCode/users` |
| Send message | `POST /messages/:inviteCode` with `{"messageText":"Hello!"}`, optionally `"attachmentIds":[...]` |
| Create conversation | `POST /conversations` with optional `{"name":"House chat"}` |
| Join conversation | `POST /conversations/:inviteCode/members` |
| Delete conversation | `DELETE /conversations/:inviteCode` (owner only) |
| Leave conversation | `DELETE /conversations/:inviteCode/members` |
| Request upload URL | `POST /conversations/:inviteCode/attachments` with `{"fileName":"pic.png","contentType":"image/png","sizeBytes":12345}` |
| Mark upload complete | `POST /attachments/:attachmentId/complete` (uploader only) |
| Get download URL | `GET /attachments/:attachmentId` (household members, complete files only) |
| Delete own account | `DELETE /users/:username` (must match signed-in user) |
| Sign out | `DELETE /sessions` |
| List household chores | `GET /conversations/:inviteCode/chores` |
| Create chore list | `POST /conversations/:inviteCode/chores` with optional `{"title":"Kitchen","assignee":"Alex"}` |
| Add chore to list | `POST /chores/:listId/items` with `{"text":"Take out the trash"}` |
| Mark chore complete/incomplete | `PATCH /chores/items/:itemId` with `{"isDone":true}` or `{"isDone":false}` |
| Delete chore | `DELETE /chores/items/:itemId` |
| Delete chore list | `DELETE /chores/:listId` |

For example, after signing in, send the token as `Authorization: Bearer <token>`.
The backend derives the message author from that session; clients cannot choose
another username as the sender. A sender can post once every three seconds.

For Expo Go on a physical phone, replace `localhost` in the API URL with your
computer's LAN IP (for example `http://192.168.1.25:3000`). Keep the phone and
computer on the same network.

### File uploads

Files go straight to S3-compatible storage (AWS S3, Cloudflare R2, MinIO); the API only signs URLs.

1. `POST /conversations/:inviteCode/attachments` checks membership, type, and size (images, PDF, or
   plain text, up to 10 MB), inserts an `attachments` row with status `pending`, and returns
   `uploadUrl` and `uploadHeaders`. The URL expires after 5 minutes.
2. The client `PUT`s the raw file bytes to `uploadUrl` with the returned `Content-Type` header. The
   content type and size are signed, so a different file is rejected by the storage service.
3. `POST /attachments/:attachmentId/complete` checks the object exists with the declared size and
   sets the status to `complete` (409 if it is missing or the size differs). Calling it again is safe.

Set `S3_BUCKET` in the root `.env` (plus `S3_REGION`, `S3_ENDPOINT` for R2/MinIO, and
`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`). Without `S3_BUCKET` the upload route returns 503. The
bucket needs a CORS rule allowing `PUT` from the web app's origin. Apply the new table with
`./database/setup-local.sh` (or `database/migrate.sh`).

#### Sending files in a message

After an upload is `complete`, pass its id in `attachmentIds` (up to 5) when sending. The text may
be empty if there is at least one attachment. Only your own finished uploads in that household can
be attached, and each file can be sent once; otherwise the request fails with 400. Message
responses (`GET /messages/:inviteCode` and the send response) include
`attachments: [{id, fileName, contentType, sizeBytes, url}]`. `url` is a temporary download link,
signed per hour so it stays the same across polls. The app shows JPEG, PNG, GIF, and WebP files as
inline pictures (tap for full size); other files appear as a tappable chip. Run
`./database/setup-local.sh` to apply migration 004.

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

## Deploying (test without Expo Go)
**Backend (Render Web Service):** root directory `backend`, build `npm install && npm run build`,
start `npm start`. Environment: `DATABASE_URL` (the Neon URL, no quotes) and optionally
`NODE_VERSION=22`. Optional `CORS_ORIGINS` (comma-separated) limits which websites may call the
API; when unset, any origin is allowed. Run `database/migrate.sh` against Neon after adding a migration.

**Web app (Render Static Site):** root directory `frontend`, build `npm ci && npm run build:web`,
publish directory `dist`. Set `EXPO_PUBLIC_API_URL` to the backend URL; it is baked in at build
time, so redeploy after changing it.

**Android APK:** `npm i -g eas-cli`, `eas login`, then from `frontend/` run
`eas build -p android --profile preview`. The backend URL lives in `eas.json` under the `preview`
profile. The first build asks to create an Expo project and adds its id to `app.json`; commit that.

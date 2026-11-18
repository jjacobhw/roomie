---
id: US-3-T-7
story: US-2
sprint: 3
assignee: Jacob Wei
estimate_hours: 5
---

# Make photo uploads fail cleanly instead of returning 500s.

## Description
Serves US-2 (send photos in the message thread). Users attaching photos hit 500 errors when the uploaded size didn't match the signed size, or when storage or database calls failed. This task covers reporting the real uploaded size, failing cleanly on storage errors, and keeping message listing resilient. Out of scope: video uploads, upload UI redesign, retry logic.

## Specs
- The composer (`frontend/src/components/Composer.tsx`) reports the byte length of the file actually uploaded, not `asset.fileSize`, so the signed Content-Length matches the upload.
- The upload-sign endpoint (`backend/uploads.ts`) signs the URL before inserting the attachment row. If S3 signing fails, it responds 502 and leaves no pending attachment row.
- `GET /messages` (`publicAttachments` in `backend/storage.ts`) skips and logs an attachment that cannot be signed, and still returns the remaining attachments with status 200.
- In `backend/routes.ts`, a failed `ROLLBACK` does not mask the original error: the original error is returned and the broken connection is discarded.

## Requirements
- No database schema changes.
- Existing attachment response shapes stay unchanged.
- The database pool in `backend/db.ts` uses `keepAlive` to survive idle connection drops (Neon/Render).
- Existing tests continue to pass.

## Acceptance criteria
1. When S3 signing throws, the upload-sign endpoint responds 502 and no pending attachment row exists.
2. When the picker's re-encoded file size differs from `asset.fileSize`, the size sent for signing equals the real uploaded byte length.
3. When one attachment cannot be signed, `GET /messages` responds 200 and includes all other attachments.
4. When `ROLLBACK` throws during error handling, the response reflects the original error, not the rollback error.


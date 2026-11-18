---
id: US-3-T-9
story: US-3
sprint: 3
assignee: Jacob Wei
estimate_hours: 5
---

# Post a message as an alert and pin it in a banner with "Seen by" acknowledgments.

## Description
Serves US-3 (keep household members aware of important messages). A member can post a message as an alert; the chat pins the latest alert in a banner under the header so it cannot scroll out of sight. Other members can acknowledge it, and the banner shows who has seen it. This task covers posting alerts, acknowledging them, and displaying them. Out of scope: push notifications, unpinning or dismissing alerts, editing or deleting alerts, and alert expiry.

## Specs
- Database (`database/migrations/005_alerts.sql`): `posts.is_alert` is a boolean, NOT NULL, default false. New table `alert_seen (post_id, user_id, seen_at)` has primary key `(post_id, user_id)` and cascades on delete of the post or user.
- `POST /messages/:inviteCode` accepts an optional `isAlert` boolean (default false).
  - A non-boolean `isAlert` responds 400 with `{ error: 'isAlert must be a boolean.' }`.
  - An alert is stored with `is_alert = true`, and the sender is recorded in `alert_seen` in the same transaction.
  - The 201 response message includes `id`, `isAlert`, and `seenBy` (`[senderUsername]` for an alert, `[]` otherwise).
- `POST /alerts/:alertId/seen` (authenticated) records the caller in `alert_seen` and responds `{ seenBy: string[] }`, ordered by `seen_at` then name.
  - Calling it twice does not create a duplicate row or an error.
  - A non-numeric ID, an unknown ID, or a post that is not an alert responds 404 `{ error: 'Alert not found.' }`.
  - A caller who is not a member of the alert's household responds 403.
- `GET /messages/:inviteCode` (`getMessages` in `backend/texting.ts`) returns `id` (string), `isAlert`, and `seenBy` on every message. `seenBy` is `[]` for ordinary messages.
- Composer (`frontend/src/components/Composer.tsx`): a 🔔 toggle posts the next message as an alert. The placeholder changes to "Write an alert...", and the toggle resets to off after a successful send.
- `AlertBanner` (`frontend/src/components/AlertBanner.tsx`) renders under the chat header (`ChatScreen`) for the most recent alert, chosen by `latestAlert` in `frontend/src/utils/messages.ts`.
  - It shows the poster's name, the message text, and "Seen by <names>" or "Not seen by anyone yet".
  - A "Got it" button appears only if the current user has not seen the alert. On failure it shows "Couldn’t mark as seen. Try again."
  - On success, `useConversation.acknowledge` updates `seenBy` in the message list immediately.
- `MessageBubble` shows an "ALERT" tag and alert styling for alert messages.

## Requirements
- Only members of the alert's household may read or acknowledge its alert.
- The client sends `isAlert` only when true, so older servers receive the same request body as before.
- Ordinary messages are unchanged: `isAlert` is false and `seenBy` is empty.
- The existing message length limit (2000 characters) and the text-or-attachment rule still apply to alerts.
- The mock API (`frontend/src/services/mockApi.ts`) supports `isAlert` and acknowledgment so the app runs without a backend.
- Existing tests continue to pass.

## Acceptance criteria
1. Posting a message with `isAlert: true` returns 201 with `isAlert: true` and `seenBy` containing only the sender.
2. Posting a message with a non-boolean `isAlert` (e.g. `"yes"`) returns 400 with `isAlert must be a boolean.` and creates no post.
3. Posting a message without `isAlert` returns 201 with `isAlert: false` and `seenBy: []`.
4. `POST /alerts/:alertId/seen` by a household member adds that member to `seenBy`, and a second call returns the same list with no duplicate.
5. `POST /alerts/:alertId/seen` returns 404 for a non-numeric ID, an unknown ID, and a post that is not an alert.
6. `POST /alerts/:alertId/seen` returns 403 for a user who is not a member of the alert's household.
7. `GET /messages/:inviteCode` includes `id`, `isAlert`, and `seenBy` for each message, with alerts listing their acknowledgers in the order they saw them.
8. `latestAlert` returns the alert with the newest timestamp, and `null` when no message is an alert.
9. The banner shows "Got it" only for a user who has not seen the alert, and hides it after acknowledging.
10. Turning on the bell button toggle and sending posts an alert, and the toggle is off again after a successful send.

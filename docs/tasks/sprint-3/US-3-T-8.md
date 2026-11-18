---
id: US-3-T-8
story: US-3
sprint: 3
assignee: <your name>
estimate_hours: 4
---

# Send a push notification to roommates when a chore is assigned or added

## Description
Serves US-1 (U.1.2: alert roommates about the house with a guarantee they'll see it), second half of sprint plan Task 3.8 (send a notification when something new is posted). Alerts (Task 3.6) are not in the backend yet, so this slice sends on the household events that exist today: a new chore list assigned to a roommate, and a new chore item. It uses the tokens saved by US-3-T-8. Sending on alert creation (once Task 3.6 lands), reminders for due chores, notification settings, read receipts, and Web Push for the browser are out of scope.

## Specs
- `notifyUsers(pool, userIds, message)` in `backend/notifications.ts` looks up every token in `push_tokens` for those users (duplicates in `userIds` count once) and sends one message per token to Expo's push service, `POST https://exp.host/--/api/v2/push/send`, in batches of at most 100. Each message has `to`, `title`, `body`, `data`, `sound: "default"`, `channelId: "default"`.
- `notifyHousehold(pool, householdId, exceptUserId, message)` sends to every member of the household except `exceptUserId`.
- `POST /conversations/:inviteCode/chores` that creates a list assigned to another roommate sends that roommate one notification with title `New chore list`, body `<creator> assigned you "<list title>"`, and data `{ "type": "chore", "listId": "<new list id>" }`. A list assigned to the creator, or unassigned (`assignee: null`), sends no "New chore list" notification.
- `POST /chores/:listId/items` sends title `New chore in <list title>`, body `<author>: <item text>`, data `{ "type": "chore", "listId": "<list id>" }`:
  - If the list is assigned to someone other than the author, only that person is notified.
  - If the list is unassigned (shared), every household member except the author is notified.
  - If the list is assigned to the author, nobody is notified.
- When Expo answers a ticket with `details.error` `DeviceNotRegistered`, that token is deleted from `push_tokens`. Other tokens are kept.
- Sending never changes the HTTP response: the route still returns 201 with the same body when the database lookup fails, when Expo is unreachable, or when Expo answers with an error status. Errors are only logged.
- If `EXPO_ACCESS_TOKEN` is set, requests to Expo carry `Authorization: Bearer <EXPO_ACCESS_TOKEN>`.

## Requirements
- Use the `push_tokens` table and routes from US-3-T-8. Do not store tokens anywhere else.
- Use Node's built-in `fetch`. No new runtime dependencies in `backend/` (no `expo-server-sdk`).
- Chore routes keep their existing status codes, bodies and member checks, and their existing tests keep passing.
- Tests use a mocked `pg` pool and a stubbed `fetch`, so they need no live database and make no real calls to Expo.

## Acceptance criteria
1. Creating a chore list assigned to another roommate sends that roommate's phones one "New chore list" notification with the list id in its data.
2. Creating a chore list assigned to yourself, or unassigned, sends no "New chore list" notification.
3. Adding an item to a list assigned to another roommate notifies only that roommate.
4. Adding an item to an unassigned list notifies every household member except the author.
5. Adding an item to your own list sends no notification.
6. A token that Expo reports as `DeviceNotRegistered` is removed from `push_tokens`, and other tokens stay.
7. When Expo is unreachable or returns an error, the chore route still returns 201 with the same response body.

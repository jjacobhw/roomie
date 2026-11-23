---
id: US-4-T-7
story: US-4
sprint: 4
assignee: Austin LaMarche
estimate_hours: 3
---

# Restrict chore management to the assigned roommate

## Description
Serves US-4 (allow each user to manage only their own chores). This task makes chore ownership enforceable in both the API and the Chores screen. A user may add chores to, complete, reopen, or delete chores and delete a chore list only when it belongs to that user or is a whole-house list; users must not be able to change a list assigned to another roommate. Creating a list for another roommate remains allowed, but management then belongs to the assignee. Shared whole-house lists remain manageable by every household member. Out of scope: reassigning an existing list, deleting or changing a household user's account, and chore due dates or reminders.

## Specs
- A chore list is manageable by a signed-in user when `assignedTo` is `null` (whole house) or matches the signed-in user's account, ignoring letter case.
- `POST /conversations/:inviteCode/chores` continues to allow a member to create a list assigned to themselves, another roommate, or the whole house. Creating someone else's list is allowed; that other user becomes responsible for managing it.
- `DELETE /chores/:listId`:
  - An assigned list may be deleted only by its assignee.
  - A whole-house list may be deleted by any household member.
  - A signed-in user who is a member of the household but is not allowed to delete the list gets HTTP 403 with `{ "error": "You can only manage your own chores." }`.
- `POST /chores/:listId/items`:
  - A chore item may be added only to an assigned list belonging to the caller or to a whole-house list.
  - An assigned list belonging to another roommate gets HTTP 403 with `{ "error": "You can only manage your own chores." }`.
- `PATCH /chores/items/:itemId`:
  - A chore item may be checked off or reopened only in an assigned list belonging to the caller or in a whole-house list.
  - An item in another user's assigned list gets HTTP 403 with `{ "error": "You can only manage your own chores." }`.
- `DELETE /chores/items/:itemId`:
  - A chore item may be deleted only from an assigned list belonging to the caller or from a whole-house list.
  - An item in another user's assigned list gets HTTP 403 with `{ "error": "You can only manage your own chores." }`.
- Existing 404 behavior remains for unknown or invalid list and item IDs. Existing 403 household-membership behavior remains for users outside the conversation.
- `frontend/src/screens/ChoresScreen.tsx`:
  - Keeps the list and its existing details visible to every household member.
  - Shows add-chore, check/uncheck, delete-chore, and delete-list controls only for a list the signed-in user may manage.
  - If a disallowed mutation is attempted because the UI is stale or not used, the screen displays the API error instead of changing ownership or silently succeeding.
- The fake-data API in `frontend/src/services/mockApi.ts` must enforce the same ownership rules as the real API.

## Requirements
- Ownership checks use the authenticated account and the chore list's `assignedTo`/`assignee`, not a caller-supplied username or client-side state alone.
- Apply checks on every mutation route: deleting a list, adding an item, toggling an item, and deleting an item.
- Whole-house lists remain available for management by every member.
- Use the existing `authenticated`, `listAccess`, and `itemAccess` helpers and patterns where possible.
- Do not introduce a new ownership column or migration.
- Existing tests must keep passing. New tests should use mocked API behavior or a mocked `pg` pool and need no live database.

## Acceptance criteria
1. A user can add, complete, reopen, and delete chores in their own assigned list.
2. A user can delete their own assigned chore list.
3. A user cannot add, toggle, reopen, or delete a chore in another user's assigned list and receives HTTP 403 with the ownership error.
4. A user cannot delete another user's assigned chore list and receives HTTP 403 with the ownership error.
5. A user can add, complete, reopen, and delete chores and delete the list for a whole-house list.
6. Users outside the household retain the existing conversation-not-found or not-member responses for chore mutations.
7. The Chores screen shows mutation controls only for lists the signed-in user may manage.
---
id: US-3-T-4
story: US-3
sprint: 3
assignee: Nikhil Augustine
estimate_hours: 3
---

# update routes with links to expenses and database

## Description
Serves US-3 (expense splitting). Can't split costs if you can't get any of the costs to begin with. That's what this task was for.

## Specs
- POST /attachments/:attachmentId/complete accesses database to then send to backend

## Requirements
- server and data must be linked by server with same API

## Acceptance criteria
- server must be able to access database and retrieve expenses and communicate
- must happen in a way that doesn't inconvenience anything else
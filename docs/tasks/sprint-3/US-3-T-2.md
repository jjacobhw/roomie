---
id: US-3-T-2
story: US-3
sprint: 3
assignee: Austin LaMarche
estimate_hours: 2
---

# Store household expenses.

## Description
Serves US-3 (input household expenses). This task covers storing household expenses with a name and amount, defaulting the amount to -1 when omitted, and rejecting expenses without an expense name or conversation ID.

## Specs
- POST /houseexpenses/:conversationId/:name/:amount stores an expense with the specified name and amount.
- POST /houseexpenses/:conversationId/:name stores an expense with the specified name and defaults the amount to -1.
- POST /houseexpenses/:conversationId does not store an expense when no expense name is provided.
- POST /houseexpenses does not store an expense when no conversation ID is provided.
- GET /houseexpenses retrieves stored household expenses.

## Requirements
- Use the existing household expense handling functionality.
- Do not store expenses without a valid expense name.
- Do not store expenses without a conversation ID.
- Default the expense amount to -1 when no amount is provided.
- Do not introduce unnecessary changes to existing functionality.
- Existing tests must keep passing.

## Acceptance criteria
1. An expense name and amount are stored successfully.
2. An expense name without an amount is stored successfully, with the amount defaulting to -1.
3. An expense submitted without an expense name is not stored.
4. An expense submitted without a conversation ID is not stored.
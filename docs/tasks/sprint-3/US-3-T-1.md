---
id: US-3-T-1
story: US-3
sprint: 3
assignee: Austin LaMarche
estimate_hours: 1
---

# Input household expenses.

## Description
Serves US-3 (input household expenses). This task covers accepting an expense name and amount, handling expenses without an amount, and rejecting expenses without a name.

## Specs
- POST /houseexpenses/:conversationId/:name/:amount accepts an expense name and amount
- POST /houseexpenses/:conversationId/:name accepts an expense name without an amount and defaults the amount to -1.
- POST /houseexpenses/:conversationId returns HTTP 400 when an expense is created without an expense name.
- Successful expense submissions return no error.

## Requirements
- Use the existing household expense handling functionality.
- Do not introduce unnecessary changes to existing functionality.
- Existing tests must keep passing.

## Acceptance criteria
1. An expense name and amount are accepted successfully.
2. An expense name without an amount is accepted, and the amount defaults to -1.
3. An expense submitted without an expense name is rejected with HTTP 400.
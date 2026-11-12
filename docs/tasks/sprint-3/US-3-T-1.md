Input household expenses.

US-3-T-1 accepts an expense name and amount.
POST /houseexpenses/:conversationId/:name/:amount
No error
1

US-3-T-1 accepts an expense name and sets amount to -1 if no amount is input.
POST /houseexpenses/:conversationId/:name
No error
2

US-3-T-1 returns an error if an expense is created without an expense name.
POST /houseexpenses/:conversationId
status 400
3

US-3-T-1 returns an error if an expense is created without a conversation id.
POST /houseexpenses
status 400
4
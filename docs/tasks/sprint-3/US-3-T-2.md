Store household expenses.

US-3-T-2 stores an expense name and amount.
POST /houseexpenses/:conversationId/:name/:amount
GET /houseexpenses
1

US-3-T-2 stores an expense name and sets amount to -1 if no amount is input.
POST /houseexpenses/:conversationId/:name
GET /houseexpenses
2

US-3-T-2 doesn't store an expense created without an expense name.
POST /houseexpenses/:conversationId
GET /houseexpenses
3

US-3-T-2 doesn't store an expense created without a conversation id.
POST /houseexpenses
GET /houseexpenses
4
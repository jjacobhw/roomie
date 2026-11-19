// Shapes of shared expenses, matching what the backend sends (GET /conversations/:inviteCode/expenses).
// All money is whole cents, never decimals, so amounts add up exactly.

// One person's share of an expense.
export type ExpenseSplit = {
  userId: string;
  username: string;
  amountCents: number;
  // True once that person has paid their share. The person who paid the bill starts out paid.
  isPaid: boolean;
};

export type Expense = {
  id: string;
  title: string;
  amountCents: number;
  createdAt: string; // ISO string
  paidByUsername: string;
  splits: ExpenseSplit[];
};

// What the app sends to create an expense. The server sees only userId and amountCents; the
// username is kept so the new expense can be shown right away.
export type NewExpenseSplit = {
  userId: string;
  username: string;
  amountCents: number;
};

export type NewExpense = {
  title: string;
  amountCents: number;
  splits: NewExpenseSplit[];
};

export const EXPENSE_TITLE_MAX_LENGTH = 100; // matches the backend limit
// $999,999.99: far inside what whole-number arithmetic can hold exactly.
export const EXPENSE_MAX_CENTS = 99_999_999;

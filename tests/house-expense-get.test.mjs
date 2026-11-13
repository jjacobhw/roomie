import assert from 'node:assert/strict';
import test from 'node:test';

import { withExpenseApi } from './expense_test_helpers.mjs';

test('GET returns stored household expenses', async () => {
  const dueDate = new Date('2026-10-01T00:00:00.000Z');
  const createdAt = new Date('2026-09-01T12:30:00.000Z');
  const storedExpense = {
    id: 'expense-1',
    name: 'Rent',
    amount: 850,
    dueDate,
    createdAt,
    paid: false,
    conversationId: 'conversation-1',
  };

  await withExpenseApi(async (baseUrl, queries) => {
    const response = await fetch(`${baseUrl}/houseexpenses`);
    const expenses = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(expenses, [{
      ...storedExpense,
      dueDate: dueDate.toISOString(),
      createdAt: createdAt.toISOString(),
    }]);
    assert.equal(queries.length, 1);
    assert.match(queries[0][0], /FROM household_expenses/i);
  }, { rows: [storedExpense] });
});

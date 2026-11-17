import assert from 'node:assert/strict';
import test from 'node:test';

import { withExpenseApi } from './expense_test_helpers.mjs';

test('creates a household expense with its supplied name and amount', async () => {
  await withExpenseApi(async (baseUrl, queries) => {
    const response = await fetch(`${baseUrl}/houseexpenses/conversation-1/Rent/850`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.expense.conversationId, 'conversation-1');
    assert.equal(body.expense.name, 'Rent');
    assert.equal(body.expense.amount, 850);
    const householdInsert = queries.find(([sql]) => /INSERT INTO household_expenses/i.test(sql));
    assert.equal(householdInsert[1][1], 'Rent');
    assert.equal(householdInsert[1][2], 850);
  });
});

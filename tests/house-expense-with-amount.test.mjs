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
    assert.equal(queries.length, 1);
    assert.equal(queries[0][1][1], 'Rent');
    assert.equal(queries[0][1][2], 850);
  });
});

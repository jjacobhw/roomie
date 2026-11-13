import assert from 'node:assert/strict';
import test from 'node:test';

import { withExpenseApi } from './expense_test_helpers.mjs';

test('defaults the amount to -1 when omitted', async () => {
  await withExpenseApi(async (baseUrl, queries) => {
    const response = await fetch(`${baseUrl}/houseexpenses/conversation-1/Internet`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.expense.name, 'Internet');
    assert.equal(body.expense.amount, -1);
    assert.equal(queries.length, 1);
    assert.equal(queries[0][1][2], -1);
  });
});

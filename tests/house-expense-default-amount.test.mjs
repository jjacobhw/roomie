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
    const householdInsert = queries.find(([sql]) => /INSERT INTO household_expenses/i.test(sql));
    assert.equal(householdInsert[1][2], -1);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { withExpenseApi } from './expense_test_helpers.mjs';

test('rejects a household expense without a name', async () => {
  await withExpenseApi(async (baseUrl, queries) => {
    const response = await fetch(`${baseUrl}/houseexpenses/conversation-1`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /name is required/i);
    assert.equal(queries.length, 0);
  });
});

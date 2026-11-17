import assert from 'node:assert/strict';
import test from 'node:test';

import { withExpenseApi } from './expense_test_helpers.mjs';

test('does not store a household expense without a conversation ID', async () => {
  await withExpenseApi(async (baseUrl, queries) => {
    const response = await fetch(`${baseUrl}/houseexpenses`, { method: 'POST' });

    assert.ok(response.status >= 400);
    assert.equal(queries.length, 0);
  });
});

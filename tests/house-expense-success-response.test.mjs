import assert from 'node:assert/strict';
import test from 'node:test';

import { withExpenseApi } from './expense_test_helpers.mjs';

test('successful expense submissions return no error', async () => {
  await withExpenseApi(async (baseUrl) => {
    const withAmount = await fetch(`${baseUrl}/houseexpenses/conversation-1/Utilities/120`, { method: 'POST' });
    const withAmountBody = await withAmount.json();
    const withoutAmount = await fetch(`${baseUrl}/houseexpenses/conversation-1/Water`, { method: 'POST' });
    const withoutAmountBody = await withoutAmount.json();

    assert.equal(withAmount.status, 201);
    assert.equal(withAmountBody.error, undefined);
    assert.equal(withoutAmount.status, 201);
    assert.equal(withoutAmountBody.error, undefined);
  });
});

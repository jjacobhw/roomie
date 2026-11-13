import assert from 'node:assert/strict';
import test from 'node:test';

import { withExpenseApi } from './expense_test_helpers.mjs';

test('splits a household expense across roommates and assigns rounding remainder to owner', async () => {
  const householdMembers = [
    { roommateId: 'owner-1', role: 'owner' },
    { roommateId: 'roommate-2', role: 'member' },
    { roommateId: 'roommate-3', role: 'member' },
  ];

  await withExpenseApi(async (baseUrl, queries) => {
    const response = await fetch(`${baseUrl}/houseexpenses/conversation-1/Internet/10`, { method: 'POST' });

    assert.equal(response.status, 201);
    const householdInsert = queries.find(([sql]) => /INSERT INTO household_expenses/i.test(sql));
    const roommateInserts = queries.filter(([sql]) => /INSERT INTO roommate_expenses/i.test(sql));
    const shares = roommateInserts.map(([, values]) => ({
      amount: values[2],
      roommateId: values[6],
    }));

    assert.equal(roommateInserts.length, householdMembers.length);
    assert.deepEqual(shares, [
      { amount: 3.34, roommateId: 'owner-1' },
      { amount: 3.33, roommateId: 'roommate-2' },
      { amount: 3.33, roommateId: 'roommate-3' },
    ]);
    assert.ok(roommateInserts.every(([, values]) => values[0] === householdInsert[1][0]));
    assert.equal(shares.reduce((total, share) => total + share.amount, 0), householdInsert[1][2]);
  }, { householdMembers });
});

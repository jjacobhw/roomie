import assert from 'node:assert/strict';
import test from 'node:test';

import { withExpenseApi } from './expense_test_helpers.mjs';

test('splits a $30.01 household expense across four roommates and assigns the remainder to the owner', async () => {
  const householdMembers = [
    { roommateId: 'owner-1', role: 'owner' },
    { roommateId: 'roommate-2', role: 'member' },
    { roommateId: 'roommate-3', role: 'member' },
    { roommateId: 'roommate-4', role: 'member' },
  ];

  await withExpenseApi(async (baseUrl, queries) => {
    const response = await fetch(`${baseUrl}/houseexpenses/conversation-1/Internet/30.01`, { method: 'POST' });

    assert.equal(response.status, 201);
    const householdInsert = queries.find(([sql]) => /INSERT INTO household_expenses/i.test(sql));
    const roommateInserts = queries.filter(([sql]) => /INSERT INTO roommate_expenses/i.test(sql));
    const shares = roommateInserts.map(([, values]) => ({
      amount: values[2],
      roommateId: values[6],
    }));

    assert.equal(roommateInserts.length, householdMembers.length);
    assert.deepEqual(shares, [
      { amount: 7.51, roommateId: 'owner-1' },
      { amount: 7.5, roommateId: 'roommate-2' },
      { amount: 7.5, roommateId: 'roommate-3' },
      { amount: 7.5, roommateId: 'roommate-4' },
    ]);
    assert.ok(roommateInserts.every(([, values]) => values[0] === householdInsert[1][0]));
    assert.equal(
      Math.round(shares.reduce((total, share) => total + share.amount, 0) * 100),
      Math.round(householdInsert[1][2] * 100)
    );
  }, { householdMembers });
});

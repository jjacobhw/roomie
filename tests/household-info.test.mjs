import assert from 'node:assert/strict';
import test from 'node:test';

import { INVITE_CODE, users, withHouseholdApi } from './household_test_helpers.mjs';
// Loaded after the helper registers its .ts resolver.
const { initial, sortMembers } = await import('../frontend/src/utils/members.ts');

test('US-3-T-13 the owner can rename the household and gets the trimmed name back', async () => {
  await withHouseholdApi(async (api) => {
    const response = await api.rename({ name: '  Ocean Street  ' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { conversation: { inviteCode: INVITE_CODE, name: 'Ocean Street' } });
    assert.equal(api.household.name, 'Ocean Street');
  });
});

test('US-3-T-13 a member who is not the owner cannot rename the household', async () => {
  await withHouseholdApi(async (api) => {
    const response = await api.rename({ name: 'Max House' });

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Only the owner can rename this household.' });
    assert.equal(api.household.name, 'Beach House');
  }, { signedIn: users.member });
});

test('US-3-T-13 a user outside the household cannot rename it', async () => {
  await withHouseholdApi(async (api) => {
    const response = await api.rename({ name: 'Otto House' });

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Only the owner can rename this household.' });
    assert.equal(api.household.name, 'Beach House');
  }, { signedIn: users.outsider });
});

test('US-3-T-13 an empty, blank or too long name is rejected and an 80 character name is accepted', async () => {
  await withHouseholdApi(async (api) => {
    const lengthError = { error: 'name must be between 1 and 80 characters.' };
    for (const name of ['', '    ', 'x'.repeat(81)]) {
      const response = await api.rename({ name });
      assert.equal(response.status, 400, `name of length ${name.length}`);
      assert.deepEqual(response.body, lengthError);
    }
    assert.equal(api.household.name, 'Beach House');

    const missing = await api.rename({});
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, { error: 'name must be a string.' });

    const longest = await api.rename({ name: 'y'.repeat(80) });
    assert.equal(longest.status, 200);
    assert.equal(api.household.name, 'y'.repeat(80));
  });
});

test('US-3-T-13 renaming an unknown household returns 404', async () => {
  await withHouseholdApi(async (api) => {
    const response = await api.rename({ name: 'Nowhere' }, { inviteCode: 'NOPE99' });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Conversation not found.' });
  });
});

test('US-3-T-13 renaming without a valid session returns 401', async () => {
  await withHouseholdApi(async (api) => {
    const noHeader = await api.rename({ name: 'Sneaky' }, { auth: null });
    assert.equal(noHeader.status, 401);
  });
  await withHouseholdApi(async (api) => {
    const expired = await api.rename({ name: 'Sneaky' });
    assert.equal(expired.status, 401);
    assert.equal(api.household.name, 'Beach House');
  }, { signedIn: null });
});

test('US-3-T-13 sortMembers puts the owner first, then names in case-insensitive order, without changing its input', () => {
  const members = [
    { username: 'zoe', role: 'member' },
    { username: 'Bea', role: 'member' },
    { username: 'olivia', role: 'owner' },
    { username: 'adam', role: 'member' },
  ];
  const before = structuredClone(members);

  const sorted = sortMembers(members);

  assert.deepEqual(sorted.map((m) => m.username), ['olivia', 'adam', 'Bea', 'zoe']);
  assert.deepEqual(members, before);
  assert.notEqual(sorted, members);
});

test('US-3-T-13 initial is the upper-case first letter, or ? for a blank name', () => {
  assert.equal(initial('olivia'), 'O');
  assert.equal(initial('  max'), 'M');
  assert.equal(initial(''), '?');
  assert.equal(initial('   '), '?');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { INVITE_CODE, users, withUsernameApi } from './username-change_test_helpers.mjs';

// Run with: backend/node_modules/.bin/tsx --test tests/username-change.test.mjs tests/username-change-client.test.mjs
const change = (call, body, options = {}) => call('PATCH', '/users/me', { ...options, body });

test('US-4-T-16 an authenticated rename trims and persists the username without replacing the account or session', async () => {
  await withUsernameApi(async ({ state, call }) => {
    const response = await change(call, { username: '  Olivia New  ', userId: users.roommate.id });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      user: { id: users.owner.id, username: 'Olivia New' },
    });
    assert.deepEqual(state.accounts.get(users.owner.id), { id: users.owner.id, username: 'Olivia New' });
    assert.deepEqual(state.accounts.get(users.roommate.id), { id: users.roommate.id, username: 'max' });
    assert.equal(state.updateCount, 1);
    assert.equal(state.sessionWriteCount, 0);

    const members = await call('GET', `/conversations/${INVITE_CODE}/users`);
    assert.equal(members.status, 200);
    assert.deepEqual(members.body.users.map(({ username }) => username), ['Olivia New', 'max']);

    const messages = await call('GET', `/messages/${INVITE_CODE}`);
    assert.equal(messages.status, 200);
    assert.equal(messages.body.messages[0].username, 'Olivia New');

    // The original bearer token continues to identify the same account after the rename.
    const stillAuthenticated = await call('GET', `/conversations/${INVITE_CODE}/users`);
    assert.equal(stillAuthenticated.status, 200);
    assert.equal(state.sessionWriteCount, 0);
  });
});

test('US-4-T-16 usernames are trimmed before applying the inclusive 1-50 character limit', async () => {
  await withUsernameApi(async ({ state, call }) => {
    for (const username of ['', '   ', 'x'.repeat(51)]) {
      const response = await change(call, { username });
      assert.equal(response.status, 400, `should reject username ${JSON.stringify(username)}`);
      assert.equal(response.body.error, 'username must be between 1 and 50 characters.');
      assert.equal(state.accounts.get(users.owner.id).username, 'olivia');
    }

    const oneCharacter = await change(call, { username: ' x ' });
    assert.equal(oneCharacter.status, 200);
    assert.equal(oneCharacter.body.user.username, 'x');

    const fiftyCharacters = 'u'.repeat(50);
    const maximum = await change(call, { username: fiftyCharacters });
    assert.equal(maximum.status, 200);
    assert.equal(maximum.body.user.username, fiftyCharacters);
    assert.equal(state.updateCount, 2);
  });
});

test('US-4-T-16 missing and non-string usernames are rejected without changing account data', async () => {
  await withUsernameApi(async ({ state, call }) => {
    for (const body of [{}, { username: null }, { username: 42 }]) {
      const response = await change(call, body);
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'username must be a string.');
    }
    assert.equal(state.accounts.get(users.owner.id).username, 'olivia');
    assert.equal(state.updateCount, 0);
  });
});

test('US-4-T-16 a username already owned with different letter case conflicts without partial changes', async () => {
  await withUsernameApi(async ({ state, call }) => {
    const response = await change(call, { username: '  MAX  ' });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: 'Username is already taken.' });
    assert.equal(state.accounts.get(users.owner.id).username, 'olivia');
    assert.equal(state.accounts.get(users.roommate.id).username, 'max');
    assert.equal(state.updateCount, 0);
  });
});

test('US-4-T-16 a missing or expired bearer session cannot rename an account', async () => {
  await withUsernameApi(async ({ state, call }) => {
    const missing = await change(call, { username: 'new-name' }, { token: null });
    const expired = await change(call, { username: 'new-name' }, { token: 'expired-session' });

    assert.equal(missing.status, 401);
    assert.equal(expired.status, 401);
    assert.equal(state.accounts.get(users.owner.id).username, 'olivia');
    assert.equal(state.updateCount, 0);
  });
});

test('US-4-T-16 database failures do not partially change the username or session', async () => {
  await withUsernameApi(async ({ state, call }) => {
    const response = await change(call, { username: 'new-name' });

    assert.equal(response.status, 500);
    assert.equal(state.accounts.get(users.owner.id).username, 'olivia');
    assert.equal(state.updateCount, 0);
    assert.equal(state.sessionWriteCount, 0);
  }, { failUpdate: true });
});

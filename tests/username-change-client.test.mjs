import assert from 'node:assert/strict';
import test from 'node:test';

import './username-change_test_helpers.mjs';

const httpApi = await import('../frontend/src/services/httpApi.ts');
const mockApi = await import('../frontend/src/services/mockApi.ts');
const { MessagingError } = await import('../frontend/src/types/messaging.ts');

test('US-4-T-16 the HTTP client sends a single authenticated self-rename request and returns the updated identity', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ user: { id: 'user-id', username: 'New Name' } });
  };

  try {
    const result = await httpApi.renameUsername('session-token', 'New Name');

    assert.deepEqual(result, { id: 'user-id', username: 'New Name' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/users/me');
    assert.equal(requests[0].options.method, 'PATCH');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer session-token');
    assert.deepEqual(JSON.parse(requests[0].options.body), { username: 'New Name' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('US-4-T-16 the HTTP client maps taken, invalid, expired-session, and network failures to existing app errors', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Username is already taken.' }, { status: 409 });
    await assert.rejects(
      httpApi.renameUsername('session-token', 'taken'),
      (error) => error instanceof MessagingError && error.code === 'USERNAME_TAKEN',
    );

    globalThis.fetch = async () => Response.json({ error: 'username must be between 1 and 50 characters.' }, { status: 400 });
    await assert.rejects(
      httpApi.renameUsername('session-token', ''),
      (error) => error instanceof MessagingError && error.code === 'INVALID_INPUT',
    );

    globalThis.fetch = async () => Response.json({ error: 'Session is invalid or expired.' }, { status: 401 });
    await assert.rejects(
      httpApi.renameUsername('session-token', 'new-name'),
      (error) => error instanceof MessagingError && error.code === 'UNAUTHENTICATED',
    );

    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(
      httpApi.renameUsername('session-token', 'new-name'),
      (error) => error instanceof MessagingError && error.code === 'NETWORK_ERROR',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('US-4-T-16 fake data renames the signed-in account and all visible conversation identity references while retaining its token', async () => {
  const suffix = Date.now().toString(36);
  const original = await mockApi.signUp(`rename-${suffix}`, 'long-password');
  const roommate = await mockApi.signUp(`roommate-${suffix}`, 'long-password');
  const inviteCode = await mockApi.createConversation(original.token);
  await mockApi.joinConversation(roommate.token, inviteCode);
  await mockApi.sendMessage(original.token, inviteCode, 'Before rename');

  const renamed = await mockApi.renameUsername(original.token, `  renamed-${suffix}  `);

  assert.deepEqual(renamed, { id: original.user.id, username: `renamed-${suffix}` });
  assert.equal(renamed.id, original.user.id);
  assert.equal((await mockApi.getMembers(original.token, inviteCode))[0].username, `renamed-${suffix}`);
  assert.deepEqual(
    (await mockApi.getMembers(original.token, inviteCode)).map(({ username }) => username),
    [`renamed-${suffix}`, `roommate-${suffix}`].sort((a, b) => a.localeCompare(b)),
  );
  assert.equal((await mockApi.getMessages(original.token, inviteCode))[0].username, `renamed-${suffix}`);
  assert.equal((await mockApi.getMyConversation(original.token)).users.includes(`renamed-${suffix}`), true);

  await assert.rejects(
    mockApi.signIn(`renamed-${suffix}`, 'long-password'),
    (error) => error instanceof MessagingError && error.code === 'INVALID_CREDENTIALS',
  );
});

test('US-4-T-16 fake data applies the same validation, case-insensitive conflict, and no-partial-update rules', async () => {
  const suffix = Date.now().toString(36);
  const original = await mockApi.signUp(`unique-${suffix}`, 'long-password');
  await mockApi.signUp(`claimed-${suffix}`, 'long-password');

  for (const username of ['', '   ', 'x'.repeat(51)]) {
    await assert.rejects(
      mockApi.renameUsername(original.token, username),
      (error) => error instanceof MessagingError && error.code === 'INVALID_INPUT',
    );
  }

  await assert.rejects(
    mockApi.renameUsername(original.token, `  CLAIMED-${suffix.toUpperCase()} `),
    (error) => error instanceof MessagingError && error.code === 'USERNAME_TAKEN',
  );

  const signedInAgain = await mockApi.signIn(`unique-${suffix}`, 'long-password');
  assert.equal(signedInAgain.user.id, original.user.id);
  assert.equal((await mockApi.getMyConversation(original.token)), null);
});

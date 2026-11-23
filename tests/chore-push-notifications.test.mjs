import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVITE_CODE,
  NEW_LIST_ID,
  tokenFor,
  users,
  withChoreApi,
} from './push_test_helpers.mjs';

const SHARED_LIST = { id: '22222222-2222-4222-8222-222222222222', title: 'Kitchen', assignedTo: null };
const BOBS_LIST = { id: '33333333-3333-4333-8333-333333333333', title: "bob's chores", assignedTo: users.bob.id };
const ALICES_LIST = { id: '44444444-4444-4444-8444-444444444444', title: "alice's chores", assignedTo: users.alice.id };

test('US-3-T-8 creating a chore list assigned to a roommate notifies that roommate', async () => {
  await withChoreApi(async (api) => {
    const response = await api.post(`/conversations/${INVITE_CODE}/chores`, { title: 'Bathroom', assignee: 'bob' });
    await api.settle();

    assert.equal(response.status, 201);
    assert.deepEqual(api.sentMessages(), [{
      to: tokenFor(users.bob),
      title: 'New chore list',
      body: 'alice assigned you "Bathroom"',
      data: { type: 'chore', listId: NEW_LIST_ID },
      sound: 'default',
      channelId: 'default',
    }]);
  });
});

test('US-3-T-8 creating a chore list assigned to a roommate reaches every one of their phones', async () => {
  const tokens = [
    { token: tokenFor(users.bob, 1), userId: users.bob.id },
    { token: tokenFor(users.bob, 2), userId: users.bob.id },
    { token: tokenFor(users.cara), userId: users.cara.id },
  ];
  await withChoreApi(async (api) => {
    await api.post(`/conversations/${INVITE_CODE}/chores`, { title: 'Bathroom', assignee: 'bob' });
    await api.settle();

    const recipients = api.sentMessages().map((message) => message.to).sort();
    assert.deepEqual(recipients, [tokenFor(users.bob, 1), tokenFor(users.bob, 2)]);
  }, { tokens });
});

test('US-3-T-8 creating a chore list for yourself or for the whole house sends no new list notification', async () => {
  await withChoreApi(async (api) => {
    const own = await api.post(`/conversations/${INVITE_CODE}/chores`, { title: 'Mine' });
    const shared = await api.post(`/conversations/${INVITE_CODE}/chores`, { title: 'House', assignee: null });
    await api.settle();
    assert.equal(own.status, 201);
    assert.equal(shared.status, 201);
    assert.deepEqual(api.sentMessages(), []);

    // Same setup, assigned to someone else: the notification does go out.
    await api.post(`/conversations/${INVITE_CODE}/chores`, { title: 'Theirs', assignee: 'cara' });
    await api.settle();
    assert.deepEqual(api.sentMessages().map((m) => m.to), [tokenFor(users.cara)]);
  });
});

test('US-3-T-8 adding an item to a roommate\'s list is denied and sends no notification', async () => {
  await withChoreApi(async (api) => {
    const response = await api.post(`/chores/${BOBS_LIST.id}/items`, { text: 'Take out trash' });
    await api.settle();

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'You can only manage your own chores.' });
    assert.deepEqual(api.sentMessages(), []);
  }, { lists: [BOBS_LIST] });
});

test('US-3-T-8 adding an item to a shared list notifies every member except the author', async () => {
  await withChoreApi(async (api) => {
    await api.post(`/chores/${SHARED_LIST.id}/items`, { text: 'Wipe counters' });
    await api.settle();

    const messages = api.sentMessages();
    assert.deepEqual(messages.map((m) => m.to).sort(), [tokenFor(users.bob), tokenFor(users.cara)]);
    for (const message of messages) {
      assert.equal(message.title, 'New chore in Kitchen');
      assert.equal(message.body, 'alice: Wipe counters');
    }
  }, { lists: [SHARED_LIST] });
});

test('US-3-T-8 adding an item to your own list sends no notification', async () => {
  await withChoreApi(async (api) => {
    const response = await api.post(`/chores/${ALICES_LIST.id}/items`, { text: 'Vacuum' });
    await api.settle();
    assert.equal(response.status, 201);
    assert.deepEqual(api.sentMessages(), []);

    // Mutating a roommate's list is denied, so it sends no notification.
    const denied = await api.post(`/chores/${BOBS_LIST.id}/items`, { text: 'Vacuum' });
    await api.settle();
    assert.equal(denied.status, 403);
    assert.deepEqual(api.sentMessages(), []);
  }, { lists: [ALICES_LIST, BOBS_LIST] });
});

test('US-3-T-8 a token Expo reports as DeviceNotRegistered is removed and other tokens stay', async () => {
  const tokens = [
    { token: tokenFor(users.bob, 1), userId: users.bob.id },
    { token: tokenFor(users.bob, 2), userId: users.bob.id },
    { token: tokenFor(users.cara), userId: users.cara.id },
  ];
  const expo = async (messages) => Response.json({
    data: messages.map((message) => (message.to === tokenFor(users.bob, 1)
      ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok' })),
  });
  await withChoreApi(async (api) => {
    await api.post(`/chores/${SHARED_LIST.id}/items`, { text: 'Mop' });
    await api.settle();

    assert.equal(api.sentMessages().length, 3);
    assert.deepEqual(api.storedTokens.map((row) => row.token).sort(), [tokenFor(users.bob, 2), tokenFor(users.cara)]);
  }, { lists: [SHARED_LIST], tokens, expo });
});

test('US-3-T-8 other Expo errors do not remove any token', async () => {
  const expo = async (messages) => Response.json({
    data: messages.map(() => ({ status: 'error', message: 'rate limited', details: { error: 'MessageRateExceeded' } })),
  });
  await withChoreApi(async (api) => {
    await api.post(`/chores/${SHARED_LIST.id}/items`, { text: 'Mop' });
    await api.settle();

    assert.equal(api.sentMessages().length, 2);
    assert.equal(api.storedTokens.length, 3);
  }, { lists: [SHARED_LIST], expo });
});

async function itemResponse(scenario) {
  let result;
  await withChoreApi(async (api) => {
    result = await api.post(`/chores/${SHARED_LIST.id}/items`, { text: 'Dishes' });
    await api.settle();
    result.expoCalls = api.expoRequests.length;
  }, { lists: [SHARED_LIST], ...scenario });
  return result;
}

test('US-3-T-8 the chore route still returns 201 with the same body when sending fails', async () => {
  const normal = await itemResponse({});
  assert.equal(normal.status, 201);
  assert.equal(normal.expoCalls, 1);

  const unreachable = await itemResponse({ expo: async () => { throw new TypeError('fetch failed'); } });
  const serverError = await itemResponse({ expo: async () => new Response('oops', { status: 500 }) });
  const databaseDown = await itemResponse({ failTokenLookup: true });

  for (const result of [unreachable, serverError, databaseDown]) {
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, normal.body);
  }
  assert.equal(unreachable.expoCalls, 1);
  assert.equal(serverError.expoCalls, 1);
});

test('US-3-T-8 requests to Expo carry the access token when EXPO_ACCESS_TOKEN is set', async () => {
  process.env.EXPO_ACCESS_TOKEN = 'secret-for-test';
  try {
    await withChoreApi(async (api) => {
      await api.post(`/chores/${SHARED_LIST.id}/items`, { text: 'Laundry' });
      await api.settle();
      assert.equal(api.expoRequests[0].headers.Authorization, 'Bearer secret-for-test');
    }, { lists: [SHARED_LIST] });
  } finally {
    delete process.env.EXPO_ACCESS_TOKEN;
  }
});

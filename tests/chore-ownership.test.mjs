// US-4-T-7: only the assignee or the whole household may mutate a chore list.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire, register } from 'node:module';
import test from 'node:test';

register(
  'data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try {
        return await next(specifier, context);
      } catch (error) {
        const fromTs = context.parentURL && context.parentURL.endsWith('.ts');
        if (fromTs && /^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/.test(specifier)) {
          return next(specifier + '.ts', context);
        }
        throw error;
      }
    }
  `)
);

const { registerChoreRoutes } = await import('../backend/chores.ts');
const { canManageChoreList } = await import('../frontend/src/utils/chores.ts');
const mockApi = await import('../frontend/src/services/mockApi.ts');

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');

const OWNER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'alice' };
const MEMBER = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'bob' };
const OUTSIDER = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'cara' };
const OWNER_LIST = '11111111-1111-4111-8111-111111111111';
const MEMBER_LIST = '22222222-2222-4222-8222-222222222222';
const SHARED_LIST = '33333333-3333-4333-8333-333333333333';

async function withRealChoreApi(signedIn, run) {
  const lists = [
    { id: OWNER_LIST, assignedTo: OWNER.id },
    { id: MEMBER_LIST, assignedTo: MEMBER.id },
    { id: SHARED_LIST, assignedTo: null },
  ];
  const items = new Map([
    ['42', { id: '42', listId: OWNER_LIST, isDone: false }],
    ['43', { id: '43', listId: MEMBER_LIST, isDone: false }],
    ['44', { id: '44', listId: SHARED_LIST, isDone: false }],
  ]);
  const isMember = signedIn.id !== OUTSIDER.id;

  const pool = {
    async query(sql, params = []) {
      if (/FROM user_sessions/i.test(sql)) return { rows: [signedIn], rowCount: 1 };
      if (/FROM chore_lists cl WHERE cl\.id = \$1/i.test(sql)) {
        const list = lists.find((entry) => entry.id === params[0]);
        return list
          ? { rows: [{ assignedTo: list.assignedTo, isMember }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (/FROM chore_items ci JOIN chore_lists cl/i.test(sql)) {
        const item = items.get(String(params[0]));
        const list = item ? lists.find((entry) => entry.id === item.listId) : null;
        return list
          ? { rows: [{ assignedTo: list.assignedTo, isMember }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (/WITH updated AS/i.test(sql)) {
        const item = items.get(String(params[0]));
        if (item) item.isDone = params[1];
        return {
          rows: [{
            id: params[0],
            text: 'Test chore',
            isDone: params[1],
            doneBy: params[1] ? signedIn.username : null,
            doneAt: params[1] ? new Date('2026-11-23T15:00:00.000Z') : null,
            createdAt: new Date('2026-11-23T15:00:00.000Z'),
          }],
          rowCount: 1,
        };
      }
      if (/INSERT INTO chore_items/i.test(sql)) {
        return {
          rows: [{
            id: '45',
            text: params[1],
            isDone: false,
            doneBy: null,
            doneAt: null,
            createdAt: new Date('2026-11-23T15:00:00.000Z'),
          }],
          rowCount: 1,
        };
      }
      if (/FROM chore_lists WHERE id = \$1/i.test(sql)) {
        const list = lists.find((entry) => entry.id === params[0]);
        return list
          ? { rows: [{ title: 'Test chores', householdId: 'household', assignedTo: list.assignedTo }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (/FROM household_members/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT token FROM push_tokens/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/DELETE FROM chore_lists/i.test(sql) || /DELETE FROM chore_items/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    },
  };

  const app = express();
  app.use(express.json());
  registerChoreRoutes(app, pool);
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  async function request(method, path, body) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  try {
    await run({
      get: (path) => request('GET', path),
      post: (path, body) => request('POST', path, body),
      patch: (path, body) => request('PATCH', path, body),
      delete: (path) => request('DELETE', path),
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('US-4-T-7 canManageChoreList allows own and whole-house lists but not another roommate', () => {
  const list = (assignee) => ({
    id: 'l',
    title: 'Chores',
    assignee,
    createdBy: null,
    createdAt: '2026-11-23T15:00:00.000Z',
    items: [],
  });

  assert.equal(canManageChoreList(list('Alice'), 'alice'), true);
  assert.equal(canManageChoreList(list('alice'), 'ALICE'), true);
  assert.equal(canManageChoreList(list(null), 'alice'), true);
  assert.equal(canManageChoreList(list('bob'), 'alice'), false);
});

test('US-4-T-7 real API permits mutations on the assignee own list', async () => {
  await withRealChoreApi(OWNER, async (api) => {
    assert.equal((await api.post(`/chores/${OWNER_LIST}/items`, { text: 'Dishes' })).status, 201);
    assert.equal((await api.patch('/chores/items/42', { isDone: true })).status, 200);
    assert.equal((await api.patch('/chores/items/42', { isDone: false })).status, 200);
    assert.equal((await api.delete('/chores/items/42')).status, 204);
    assert.equal((await api.delete(`/chores/${OWNER_LIST}`)).status, 204);
  });
});

test('US-4-T-7 real API denies every mutation on another roommate assigned list', async () => {
  await withRealChoreApi(OWNER, async (api) => {
    const denied = [
      await api.post(`/chores/${MEMBER_LIST}/items`, { text: 'Dishes' }),
      await api.patch('/chores/items/43', { isDone: true }),
      await api.patch('/chores/items/43', { isDone: false }),
      await api.delete('/chores/items/43'),
      await api.delete(`/chores/${MEMBER_LIST}`),
    ];
    for (const response of denied) {
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: 'You can only manage your own chores.' });
    }
  });
});

test('US-4-T-7 real API permits members to mutate whole-house chores', async () => {
  await withRealChoreApi(MEMBER, async (api) => {
    assert.equal((await api.post(`/chores/${SHARED_LIST}/items`, { text: 'Mop' })).status, 201);
    assert.equal((await api.patch('/chores/items/44', { isDone: true })).status, 200);
    assert.equal((await api.delete('/chores/items/44')).status, 204);
    assert.equal((await api.delete(`/chores/${SHARED_LIST}`)).status, 204);
  });
});

test('US-4-T-7 real API keeps 404 and outside-household 403 behavior', async () => {
  await withRealChoreApi(OUTSIDER, async (api) => {
    const denied = [
      await api.post(`/chores/${OWNER_LIST}/items`, { text: 'No' }),
      await api.patch('/chores/items/42', { isDone: true }),
      await api.delete('/chores/items/42'),
      await api.delete(`/chores/${OWNER_LIST}`),
    ];
    for (const response of denied) assert.deepEqual(response, {
      status: 403,
      body: { error: 'User is not a member of this conversation.' },
    });
  });
  await withRealChoreApi(OWNER, async (api) => {
    assert.equal((await api.delete('/chores/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await api.patch('/chores/items/999', { isDone: true })).status, 404);
    assert.equal((await api.delete('/chores/items/999')).status, 404);
    assert.equal((await api.post('/chores/00000000-0000-4000-8000-000000000000/items', { text: 'No' })).status, 404);
  });
});

test('US-4-T-7 fake API enforces own, shared, and another-users list rules', async () => {
  const run = `${Date.now().toString(36)}ownership`;
  const owner = await mockApi.signUp(`owner-${run}`, 'password-owner');
  const member = await mockApi.signUp(`member-${run}`, 'password-member');
  const inviteCode = await mockApi.createConversation(owner.token);
  await mockApi.joinConversation(member.token, inviteCode);

  const ownerList = await mockApi.createChoreList(owner.token, inviteCode, { assignee: owner.user.username });
  await mockApi.createChoreItem(owner.token, ownerList.id, 'Owner chore');
  const ownerItem = (await mockApi.getChoreLists(owner.token, inviteCode))[0].items[0];
  await mockApi.setChoreItemDone(owner.token, ownerItem.id, true);
  await mockApi.setChoreItemDone(owner.token, ownerItem.id, false);
  await mockApi.deleteChoreItem(owner.token, ownerItem.id);
  await mockApi.deleteChoreList(owner.token, ownerList.id);

  const shared = await mockApi.createChoreList(owner.token, inviteCode, { assignee: null });
  const sharedItem = await mockApi.createChoreItem(member.token, shared.id, 'Shared chore');
  await mockApi.setChoreItemDone(member.token, sharedItem.id, true);
  await mockApi.deleteChoreItem(member.token, sharedItem.id);
  await mockApi.deleteChoreList(member.token, shared.id);

  const memberList = await mockApi.createChoreList(owner.token, inviteCode, { assignee: member.user.username });
  await assert.rejects(
    mockApi.createChoreItem(owner.token, memberList.id, 'Not allowed'),
    (error) => error.code === 'NOT_A_MEMBER' && error.message === 'You can only manage your own chores.',
  );
  const memberItem = await mockApi.createChoreItem(member.token, memberList.id, 'Member chore');
  await assert.rejects(
    mockApi.setChoreItemDone(owner.token, memberItem.id, true),
    (error) => error.code === 'NOT_A_MEMBER' && error.message === 'You can only manage your own chores.',
  );
  await assert.rejects(
    mockApi.setChoreItemDone(owner.token, memberItem.id, false),
    (error) => error.code === 'NOT_A_MEMBER' && error.message === 'You can only manage your own chores.',
  );
  await assert.rejects(
    mockApi.deleteChoreItem(owner.token, memberItem.id),
    (error) => error.code === 'NOT_A_MEMBER' && error.message === 'You can only manage your own chores.',
  );
  await assert.rejects(
    mockApi.deleteChoreList(owner.token, memberList.id),
    (error) => error.code === 'NOT_A_MEMBER' && error.message === 'You can only manage your own chores.',
  );
});

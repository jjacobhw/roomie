// US-3-T-14: choose which roommate a new chore list is for.
// Runs the real frontend code (chore helpers and the fake-data API layer), so no server or database is needed.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// The frontend's imports leave off ".ts" (tsc allows that, plain Node doesn't); this adds it.
register(
  'data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try {
        return await next(specifier, context);
      } catch (error) {
        const fromTs = context.parentURL && context.parentURL.endsWith('.ts');
        if (fromTs && /^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) {
          return next(specifier + '.ts', context);
        }
        throw error;
      }
    }
  `)
);

const { assigneeChoices, assigneeLabel } = await import('../frontend/src/utils/chores.ts');
const api = await import('../frontend/src/services/mockApi.ts');

const member = (username, role = 'member') => ({ username, role });

// A household with an owner and one roommate, plus an outsider who has an account but no household.
let counter = 0;
async function setup(roommateName = 'max') {
  const run = `${Date.now().toString(36)}${counter++}`;
  const owner = await api.signUp(`olivia-${run}`, 'password-owner');
  const roommate = await api.signUp(`${roommateName}-${run}`, 'password-max1');
  const outsider = await api.signUp(`otto-${run}`, 'password-otto');
  const inviteCode = await api.createConversation(owner.token);
  await api.joinConversation(roommate.token, inviteCode);
  return { owner, roommate, outsider, inviteCode };
}

test('US-3-T-14 assigneeChoices lists Me first, then roommates in case-insensitive order, then Whole house', () => {
  const members = [member('zoe'), member('Bob'), member('olivia', 'owner'), member('amy')];

  const choices = assigneeChoices(members, 'olivia');

  assert.deepEqual(choices, [
    { key: 'me', label: 'Me', assignee: 'olivia' },
    { key: 'user:amy', label: 'amy', assignee: 'amy' },
    { key: 'user:Bob', label: 'Bob', assignee: 'Bob' },
    { key: 'user:zoe', label: 'zoe', assignee: 'zoe' },
    { key: 'house', label: 'Whole house', assignee: null },
  ]);
});

test('US-3-T-14 the signed-in user appears once as Me, even when their name has different letter case', () => {
  const choices = assigneeChoices([member('OLIVIA', 'owner'), member('max')], 'olivia');

  assert.deepEqual(choices.map((c) => c.key), ['me', 'user:max', 'house']);
  assert.equal(choices[0].assignee, 'olivia');
  assert.equal(choices.filter((c) => c.label.toLowerCase() === 'olivia').length, 0);
});

test('US-3-T-14 with no other members the choices are Me and Whole house, and the members array is not changed', () => {
  assert.deepEqual(assigneeChoices([], 'olivia').map((c) => c.label), ['Me', 'Whole house']);
  assert.deepEqual(assigneeChoices([member('olivia', 'owner')], 'olivia').map((c) => c.label), ['Me', 'Whole house']);

  const members = [member('zoe'), member('amy'), member('olivia', 'owner')];
  const before = JSON.stringify(members);
  Object.freeze(members);
  assigneeChoices(members, 'olivia'); // would throw if it tried to sort the frozen array in place
  assert.equal(JSON.stringify(members), before);
});

test('US-3-T-14 creating a list for a roommate saves that roommate in their own spelling with the default title', async () => {
  const { owner, roommate, inviteCode } = await setup('MaxPower');
  const spelledByAccount = roommate.user.username;

  // Typed in a different letter case than the account uses.
  const list = await api.createChoreList(owner.token, inviteCode, { assignee: spelledByAccount.toLowerCase() });

  assert.equal(list.assignee, spelledByAccount);
  assert.equal(list.title, `${spelledByAccount}'s chores`);
  assert.equal(list.createdBy, owner.user.username);
  assert.deepEqual(list.items, []);
});

test('US-3-T-14 the roommate and every other member see the list with the same assignee', async () => {
  const { owner, roommate, inviteCode } = await setup();
  const list = await api.createChoreList(owner.token, inviteCode, { assignee: roommate.user.username });

  for (const person of [roommate, owner]) {
    const lists = await api.getChoreLists(person.token, inviteCode);
    assert.equal(lists.length, 1);
    assert.equal(lists[0].id, list.id);
    assert.equal(lists[0].assignee, roommate.user.username);
  }
});

test('US-3-T-14 a list for someone who is not in the household is rejected and nothing is created', async () => {
  const { owner, outsider, inviteCode } = await setup();

  for (const nobody of [outsider.user.username, 'nobody-has-this-name']) {
    await assert.rejects(api.createChoreList(owner.token, inviteCode, { assignee: nobody }), (error) => {
      assert.equal(error.name, 'MessagingError');
      assert.equal(error.code, 'INVALID_INPUT');
      assert.equal(error.message, 'assignee is not a member of this conversation.');
      return true;
    });
  }
  assert.deepEqual(await api.getChoreLists(owner.token, inviteCode), []);
});

test('US-3-T-14 the Me and Whole house choices create a list for the user and for the whole house', async () => {
  const { owner, roommate, inviteCode } = await setup();
  const members = await api.getMembers(owner.token, inviteCode);
  const [me, ...rest] = assigneeChoices(members, owner.user.username);
  const house = rest[rest.length - 1];

  const mine = await api.createChoreList(owner.token, inviteCode, { assignee: me.assignee });
  const forAll = await api.createChoreList(owner.token, inviteCode, { assignee: house.assignee });

  assert.equal(mine.assignee, owner.user.username);
  assert.equal(mine.title, `${owner.user.username}'s chores`);
  assert.equal(forAll.assignee, null);
  assert.equal(forAll.title, 'House chores');
  // The roommate shows up as a choice built from the real member list.
  assert.ok(rest.some((c) => c.assignee === roommate.user.username));
});

test('US-3-T-14 assigneeLabel says You for the user, the roommate name for others, and Whole house for no assignee', () => {
  const list = (assignee) => ({ id: 'l', title: 't', assignee, createdBy: null, createdAt: '2026-11-18T12:00:00.000Z', items: [] });

  assert.equal(assigneeLabel(list('olivia'), 'olivia'), 'You');
  assert.equal(assigneeLabel(list('Olivia'), 'olivia'), 'You');
  assert.equal(assigneeLabel(list('max'), 'olivia'), 'max');
  assert.equal(assigneeLabel(list(null), 'olivia'), 'Whole house');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { users, withAlertApi } from './alert_test_helpers.mjs';
// Loaded after the helper registers its .ts resolver.
const { canAcknowledge, latestAlert } = await import('../frontend/src/utils/messages.ts');

// ---- Backend ---------------------------------------------------------------------------------

test('US-3-T-7 posting with isAlert true returns an alert seen only by the sender', async () => {
  await withAlertApi(async (api) => {
    const response = await api.send({ messageText: 'Water is off until 5pm', isAlert: true });

    assert.equal(response.status, 201);
    assert.equal(response.body.message.isAlert, true);
    assert.deepEqual(response.body.message.seenBy, [users.poster.username]);
    assert.equal(api.store.posts[0].isAlert, true);
    assert.equal(api.store.seen.length, 1);
  });
});

test('US-3-T-7 a non-boolean isAlert is rejected with 400 and creates no post', async () => {
  await withAlertApi(async (api) => {
    for (const bad of ['yes', 1, null, {}]) {
      const response = await api.send({ messageText: 'hello', isAlert: bad });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'isAlert must be a boolean.');
    }
    assert.equal(api.store.posts.length, 0);
    assert.equal(api.store.seen.length, 0);
  });
});

test('US-3-T-7 a message without isAlert is not an alert and has an empty seenBy', async () => {
  await withAlertApi(async (api) => {
    const response = await api.send({ messageText: 'hello' });

    assert.equal(response.status, 201);
    assert.equal(response.body.message.isAlert, false);
    assert.deepEqual(response.body.message.seenBy, []);
    assert.equal(api.store.posts[0].isAlert, false);
    assert.equal(api.store.seen.length, 0);
  });
});

test('US-3-T-7 acknowledging an alert adds the member once, even when called twice', async () => {
  await withAlertApi(async (api) => {
    const posted = await api.send({ messageText: 'Meeting at 6', isAlert: true });
    const alertId = posted.body.message.id;

    api.signInAs(users.roommate);
    const first = await api.acknowledge(alertId);
    const second = await api.acknowledge(alertId);

    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { seenBy: [users.poster.username, users.roommate.username] });
    assert.deepEqual(second.body, first.body);
    assert.equal(api.store.seen.length, 2);
  });
});

test('US-3-T-7 acknowledging lists everyone who has seen the alert in the order they saw it', async () => {
  await withAlertApi(async (api) => {
    const posted = await api.send({ messageText: 'Fire drill', isAlert: true });

    api.signInAs(users.roommate);
    const response = await api.acknowledge(posted.body.message.id);

    // The poster saw it first (when posting), then the roommate.
    assert.deepEqual(response.body.seenBy, [users.poster.username, users.roommate.username]);
  });
});

test('US-3-T-7 acknowledging returns 404 for a non-numeric id, an unknown id and a non-alert post', async () => {
  await withAlertApi(async (api) => {
    const ordinary = await api.send({ messageText: 'just chatting' });

    for (const id of ['abc', '1.5', '99999', ordinary.body.message.id]) {
      const response = await api.acknowledge(id);
      assert.equal(response.status, 404, `id ${id}`);
      assert.equal(response.body.error, 'Alert not found.');
    }
    assert.equal(api.store.seen.length, 0);
  });
});

test('US-3-T-7 a user outside the household cannot acknowledge its alert', async () => {
  await withAlertApi(async (api) => {
    const posted = await api.send({ messageText: 'Keys are under the mat', isAlert: true });
    assert.equal(posted.status, 201);

    api.signInAs(users.outsider);
    const response = await api.acknowledge(posted.body.message.id);

    assert.equal(response.status, 403);
    assert.deepEqual(api.store.seen.map((s) => s.userId), [users.poster.id]);
  });
});

test('US-3-T-7 listing messages includes id, isAlert and seenBy for every message', async () => {
  await withAlertApi(async (api) => {
    const ordinary = await api.send({ messageText: 'hello' });
    const alert = await api.send({ messageText: 'Heads up', isAlert: true });
    api.markSeenDirectly(Number(alert.body.message.id), users.roommate.id);

    const response = await api.list();

    assert.equal(response.status, 200);
    const [first, second] = response.body.messages;
    assert.equal(first.id, ordinary.body.message.id);
    assert.equal(first.isAlert, false);
    assert.deepEqual(first.seenBy, []);
    assert.equal(second.id, alert.body.message.id);
    assert.equal(typeof second.id, 'string');
    assert.equal(second.isAlert, true);
    assert.deepEqual(second.seenBy, [users.poster.username, users.roommate.username]);
  });
});

// ---- Frontend --------------------------------------------------------------------------------

const message = (id, timestamp, isAlert) => ({
  id,
  username: 'olivia',
  messageText: id,
  timestamp,
  attachments: [],
  isAlert,
  seenBy: [],
});

test('US-3-T-7 latestAlert returns the alert with the newest timestamp', () => {
  const messages = [
    message('old-alert', '2026-11-01T10:00:00.000Z', true),
    message('new-alert', '2026-11-01T12:00:00.000Z', true),
    message('newer-chat', '2026-11-01T13:00:00.000Z', false),
  ];
  assert.equal(latestAlert(messages)?.id, 'new-alert');
});

test('US-3-T-7 latestAlert returns null when no message is an alert', () => {
  assert.equal(latestAlert([]), null);
  assert.equal(latestAlert([message('chat', '2026-11-01T10:00:00.000Z', false)]), null);
});

test('US-3-T-7 the Got it button is offered only to a user who has not seen the alert', () => {
  const alert = { ...message('alert', '2026-11-01T12:00:00.000Z', true), seenBy: ['olivia'] };

  assert.equal(canAcknowledge(alert, 'max'), true);
  assert.equal(canAcknowledge(alert, 'olivia'), false);
  // Acknowledging adds the user to seenBy (as useConversation.acknowledge does), and the button goes away.
  assert.equal(canAcknowledge({ ...alert, seenBy: [...alert.seenBy, 'max'] }, 'max'), false);
});

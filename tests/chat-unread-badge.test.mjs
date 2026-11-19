// US-3-T-15: unread-messages badge on the Chat tab.
// Tests the real unread logic in frontend/src/utils/unread.ts. It imports no React Native code, so no
// server, database or phone is needed.
import assert from 'node:assert/strict';
import test from 'node:test';

const { advanceUnread, badgeText, countUnread, latestTimestamp, INITIAL_UNREAD_STATE } = await import(
  '../frontend/src/utils/unread.ts'
);

let counter = 0;
const at = (hh, mm, ss = 0, ms = 0) =>
  new Date(Date.UTC(2026, 10, 18, hh, mm, ss, ms)).toISOString();
const msg = (username, timestamp) => ({
  id: `m${counter++}`,
  username,
  messageText: 'hi',
  timestamp,
  attachments: [],
});
const deepFreeze = (value) => {
  Object.values(value).forEach((inner) => typeof inner === 'object' && inner !== null && deepFreeze(inner));
  return Object.freeze(value);
};

test('US-3-T-15 countUnread counts the roommates\' messages that are later than lastSeen', () => {
  const messages = [
    msg('max', at(10, 0, 0)), // older than lastSeen
    msg('max', at(10, 1)),
    msg('zoe', at(10, 2)),
    msg('amy', at(10, 3)),
  ];

  assert.equal(countUnread(messages, 'olivia', at(10, 0, 30)), 3);
  assert.equal(countUnread(messages, 'olivia', at(10, 2)), 1);
  assert.equal(countUnread(messages, 'olivia', at(10, 3)), 0);
});

test('US-3-T-15 countUnread never counts the signed-in user\'s own messages, whatever the letter case', () => {
  const messages = [msg('olivia', at(10, 5)), msg('Olivia', at(10, 6)), msg('OLIVIA ', at(10, 7)), msg('max', at(10, 8))];

  assert.equal(countUnread(messages, 'olivia', at(10, 0)), 1);
  assert.equal(countUnread(messages.slice(0, 3), 'olivia', null), 0);
});

test('US-3-T-15 a message exactly at lastSeen is not unread, one millisecond later is', () => {
  const lastSeen = at(11, 0, 0, 0);

  assert.equal(countUnread([msg('max', at(11, 0, 0, 0))], 'olivia', lastSeen), 0);
  assert.equal(countUnread([msg('max', at(11, 0, 0, 1))], 'olivia', lastSeen), 1);
});

test('US-3-T-15 with lastSeen null every roommate message counts', () => {
  const messages = [msg('max', at(9, 0)), msg('zoe', at(9, 1)), msg('olivia', at(9, 2)), msg('amy', at(9, 3))];

  assert.equal(countUnread(messages, 'olivia', null), 3);
  assert.equal(countUnread([], 'olivia', null), 0);
});

test('US-3-T-15 messages with an invalid timestamp are ignored by countUnread and latestTimestamp', () => {
  const messages = [msg('max', 'not a date'), msg('max', ''), msg('zoe', at(12, 0))];

  assert.equal(countUnread(messages, 'olivia', null), 1);
  assert.equal(countUnread(messages, 'olivia', at(11, 0)), 1);
  assert.equal(latestTimestamp(messages), at(12, 0));
  assert.equal(latestTimestamp([msg('max', 'garbage'), msg('max', '')]), null);
});

test('US-3-T-15 latestTimestamp returns the newest timestamp whatever the order, and null for no messages', () => {
  const newest = at(14, 30);
  const messages = [msg('max', at(14, 0)), msg('zoe', newest), msg('amy', at(14, 15))];

  assert.equal(latestTimestamp(messages), newest);
  assert.equal(latestTimestamp([...messages].reverse()), newest);
  assert.equal(latestTimestamp([]), null);
});

test('US-3-T-15 advanceUnread treats the first batch as history, then counts only newer roommate messages', () => {
  const history = [msg('max', at(8, 0)), msg('zoe', at(8, 5))];

  // First call: even with the chat closed, what is already there is not unread.
  const first = advanceUnread(INITIAL_UNREAD_STATE, history, 'olivia', false);
  assert.deepEqual(first, { started: true, lastSeen: at(8, 5), unread: 0 });

  // New messages from roommates arrive while the chat is closed; the user's own does not count.
  const later = [...history, msg('max', at(8, 10)), msg('olivia', at(8, 11)), msg('amy', at(8, 12))];
  const second = advanceUnread(first, later, 'olivia', false);
  assert.deepEqual(second, { started: true, lastSeen: at(8, 5), unread: 2 });

  // The same batch again does not pile up: the count is recomputed, not added to.
  assert.equal(advanceUnread(second, later, 'olivia', false).unread, 2);

  // A household with no messages at the start: the first roommate message counts.
  const empty = advanceUnread(INITIAL_UNREAD_STATE, [], 'olivia', false);
  assert.deepEqual(empty, { started: true, lastSeen: null, unread: 0 });
  assert.equal(advanceUnread(empty, [msg('max', at(8, 20))], 'olivia', false).unread, 1);
});

test('US-3-T-15 while the chat is open advanceUnread shows 0 and moves lastSeen, so nothing comes back as unread', () => {
  const started = advanceUnread(INITIAL_UNREAD_STATE, [msg('max', at(7, 0))], 'olivia', false);
  const withNew = [msg('max', at(7, 0)), msg('zoe', at(7, 5)), msg('amy', at(7, 6))];

  assert.equal(advanceUnread(started, withNew, 'olivia', false).unread, 2);

  // The user opens the chat: badge clears and lastSeen moves to the newest message.
  const open = advanceUnread(started, withNew, 'olivia', true);
  assert.deepEqual(open, { started: true, lastSeen: at(7, 6), unread: 0 });

  // They go back to Chores: the same messages are no longer unread...
  const left = advanceUnread(open, withNew, 'olivia', false);
  assert.equal(left.unread, 0);
  // ...but a message that arrives afterwards is.
  assert.equal(advanceUnread(left, [...withNew, msg('max', at(7, 9))], 'olivia', false).unread, 1);

  // An empty batch while the chat is open keeps the last known lastSeen.
  assert.equal(advanceUnread(open, [], 'olivia', true).lastSeen, at(7, 6));
});

test('US-3-T-15 badgeText shows nothing for 0 and invalid counts, the number for 1 to 9, and 9+ from 10', () => {
  for (const nothing of [0, -1, -50, Number.NaN, Infinity, -Infinity, 0.5]) {
    assert.equal(badgeText(nothing), '', `count ${nothing} should show no badge`);
  }
  for (let n = 1; n <= 9; n++) assert.equal(badgeText(n), String(n));
  for (const many of [10, 11, 99, 250]) assert.equal(badgeText(many), '9+');
});

test('US-3-T-15 advanceUnread does not modify the state or the messages it is given', () => {
  const state = deepFreeze({ started: true, lastSeen: at(6, 0), unread: 0 });
  const messages = deepFreeze([msg('max', at(6, 5)), msg('olivia', at(6, 6))]);
  const before = JSON.stringify({ state, messages });

  // Frozen inputs would throw if they were changed in place.
  const closed = advanceUnread(state, messages, 'olivia', false);
  const open = advanceUnread(state, messages, 'olivia', true);
  const first = advanceUnread(INITIAL_UNREAD_STATE, messages, 'olivia', false);

  assert.equal(JSON.stringify({ state, messages }), before);
  assert.notEqual(closed, state);
  assert.notEqual(open, state);
  assert.deepEqual(INITIAL_UNREAD_STATE, { started: false, lastSeen: null, unread: 0 });
  assert.equal(closed.unread, 1);
  assert.equal(first.started, true);
});

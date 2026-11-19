import type { Message } from '../types/messaging';

// Tracks how many messages from roommates arrived while the chat was not open, for the badge on
// the Chat tab. Pure functions only (no React), so they are easy to test.

export type UnreadState = {
  // False until the first batch of messages has been seen; those are history, not unread.
  started: boolean;
  // Time of the newest message the user has seen, or null if there was none.
  lastSeen: string | null;
  unread: number;
};

export const INITIAL_UNREAD_STATE: UnreadState = { started: false, lastSeen: null, unread: 0 };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The newest valid timestamp (by time, not by position in the list), or null if there is none.
export function latestTimestamp(messages: Message[]): string | null {
  let newest: string | null = null;
  let newestTime = -Infinity;
  for (const message of messages) {
    const time = Date.parse(message.timestamp);
    if (Number.isNaN(time)) continue;
    if (time > newestTime) {
      newestTime = time;
      newest = message.timestamp;
    }
  }
  return newest;
}

// How many messages from someone other than `username` are strictly newer than `lastSeen`.
// lastSeen null means "nothing seen yet", so every message from a roommate counts.
export function countUnread(messages: Message[], username: string, lastSeen: string | null): number {
  const parsed = lastSeen === null ? Number.NaN : Date.parse(lastSeen);
  const seenAt = Number.isNaN(parsed) ? -Infinity : parsed;
  let count = 0;
  for (const message of messages) {
    if (sameName(message.username, username)) continue;
    const time = Date.parse(message.timestamp);
    if (Number.isNaN(time)) continue;
    if (time > seenAt) count++;
  }
  return count;
}

// The next unread state after a fresh batch of `messages`. `chatOpen` says whether the Chat tab
// is showing right now. Returns a new object and changes neither `state` nor `messages`.
export function advanceUnread(
  state: UnreadState,
  messages: Message[],
  username: string,
  chatOpen: boolean,
): UnreadState {
  // Messages that were already there when we started looking are history, not unread.
  if (!state.started) {
    return { started: true, lastSeen: latestTimestamp(messages), unread: 0 };
  }
  // While the chat is open everything on screen is seen.
  if (chatOpen) {
    return { started: true, lastSeen: latestTimestamp(messages) ?? state.lastSeen, unread: 0 };
  }
  return { started: true, lastSeen: state.lastSeen, unread: countUnread(messages, username, state.lastSeen) };
}

// The text inside the badge: nothing for 0 (or a bad number), the count up to 9, then "9+".
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count < 1) return '';
  return count > 9 ? '9+' : String(Math.floor(count));
}

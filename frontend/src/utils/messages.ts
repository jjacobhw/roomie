import type { Message } from '../types/messaging';

// Combine two lists of messages into one, oldest first, with no duplicates (by id).
// Needed because a poll can come back while a send is still in flight: replacing the
// list with the poll result would make the message you just sent vanish until the next poll.
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of [...current, ...incoming]) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
}

// The alert to pin at the top: the most recent message posted as an alert, or null.
export function latestAlert(messages: Message[]): Message | null {
  let latest: Message | null = null;
  for (const message of messages) {
    if (message.isAlert && (!latest || Date.parse(message.timestamp) >= Date.parse(latest.timestamp))) {
      latest = message;
    }
  }
  return latest;
}

// Whether to offer the "Got it" button: only to someone who hasn't yet seen the alert.
export function canAcknowledge(alert: Message, username: string): boolean {
  return alert.isAlert && !alert.seenBy.includes(username);
}

// Whether the 🔔 toggle stays on after a send: it resets only when the send succeeded, so a failed
// alert can be retried as an alert.
export function alertToggleAfterSend(asAlert: boolean, sendOk: boolean): boolean {
  return sendOk ? false : asAlert;
}

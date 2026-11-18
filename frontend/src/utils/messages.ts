import { Message } from '../types/messaging';

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

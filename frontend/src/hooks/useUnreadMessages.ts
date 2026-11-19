import { useCallback, useEffect, useRef, useState } from 'react';
import { getMessages } from '../services/messagingApi';
import { type Message, MessagingError } from '../types/messaging';
import { advanceUnread, INITIAL_UNREAD_STATE, type UnreadState } from '../utils/unread';

const POLL_INTERVAL_MS = 5000;

// How many messages from roommates arrived since the Chat tab was last open. Loads the messages
// itself (the chat screen keeps its own copy), so it also works while the chat is hidden.
// onSessionExpired runs when the server says the token is no longer valid (401).
export function useUnreadMessages(
  token: string,
  inviteCode: string,
  username: string,
  chatOpen: boolean,
  onSessionExpired: () => void,
): number {
  const [unread, setUnread] = useState(0);

  // Latest values, so the polling timer never has to restart when they change.
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const usernameRef = useRef(username);
  usernameRef.current = username;
  const expiredRef = useRef(onSessionExpired);
  expiredRef.current = onSessionExpired;

  const state = useRef<UnreadState>(INITIAL_UNREAD_STATE);
  const latest = useRef<Message[]>([]);
  // True once the first batch of messages has arrived (before that there is nothing to mark as seen).
  const loaded = useRef(false);

  const apply = useCallback((messages: Message[], open: boolean) => {
    state.current = advanceUnread(state.current, messages, usernameRef.current, open);
    setUnread(state.current.unread);
  }, []);

  useEffect(() => {
    let cancelled = false;
    state.current = INITIAL_UNREAD_STATE;
    latest.current = [];
    loaded.current = false;
    setUnread(0);

    async function refresh() {
      try {
        const messages = await getMessages(token, inviteCode);
        if (cancelled) return;
        latest.current = messages;
        loaded.current = true;
        apply(messages, chatOpenRef.current);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof MessagingError && e.code === 'UNAUTHENTICATED') expiredRef.current();
        // Any other failure: keep showing the last count and try again at the next tick.
      }
    }

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, inviteCode, apply]);

  // Opening the Chat tab clears the badge straight away, without waiting for the next poll.
  useEffect(() => {
    if (chatOpen && loaded.current) apply(latest.current, true);
  }, [chatOpen, apply]);

  return unread;
}

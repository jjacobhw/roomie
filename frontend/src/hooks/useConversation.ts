import { useCallback, useEffect, useRef, useState } from 'react';
import { getMessages, sendMessage } from '../services/messagingApi';
import { Message, MessagingError } from '../types/messaging';
import { mergeMessages } from '../utils/messages';

const POLL_INTERVAL_MS = 3000; // Sprint 1 has no WebSockets, so ask for new messages on a timer

export type SendResult =
  | { ok: true }
  | { ok: false; error: string; retryAfterMs?: number };

// Loads a household's messages, keeps them fresh, and sends new ones.
// onSessionExpired runs when the server says the token is no longer valid (401),
// so the app can send the user back to sign in.
export function useConversation(token: string, inviteCode: string, onSessionExpired: () => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Always call the latest callback without restarting the polling timer when it changes.
  const expiredRef = useRef(onSessionExpired);
  expiredRef.current = onSessionExpired;

  useEffect(() => {
    // `cancelled` stops a slow response from updating state after we've left the screen
    // or switched to another household.
    let cancelled = false;

    async function refresh() {
      try {
        const latest = await getMessages(token, inviteCode);
        if (cancelled) return;
        setMessages((current) => mergeMessages(current, latest));
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof MessagingError && e.code === 'UNAUTHENTICATED') {
          expiredRef.current();
          return;
        }
        setLoadError(e instanceof Error ? e.message : 'Could not load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setMessages([]);
    setLoading(true);
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, inviteCode]);

  const send = useCallback(
    async (messageText: string): Promise<SendResult> => {
      setSending(true);
      try {
        const sent = await sendMessage(token, inviteCode, messageText);
        // Show it straight away instead of waiting for the next poll.
        setMessages((current) => mergeMessages(current, [sent]));
        return { ok: true };
      } catch (e) {
        if (e instanceof MessagingError) {
          if (e.code === 'UNAUTHENTICATED') expiredRef.current();
          return { ok: false, error: e.message, retryAfterMs: e.retryAfterMs };
        }
        return { ok: false, error: 'Could not send message' };
      } finally {
        setSending(false);
      }
    },
    [token, inviteCode],
  );

  return { messages, loading, loadError, sending, send };
}

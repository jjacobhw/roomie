import { useCallback, useEffect, useState } from 'react';
import { getMessages, sendMessage } from '../services/messagingApi';
import { Message, MessagingError } from '../types/messaging';
import { mergeMessages } from '../utils/messages';

const POLL_INTERVAL_MS = 3000; // Sprint 1 has no WebSockets, so ask for new messages on a timer

export type SendResult =
  | { ok: true }
  | { ok: false; error: string; retryAfterMs?: number };

// Loads a conversation's messages, keeps them fresh, and sends new ones.
export function useConversation(username: string, inviteCode: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // `cancelled` stops a slow response from updating state after we've left the screen
    // or switched to another conversation.
    let cancelled = false;

    async function refresh() {
      try {
        const latest = await getMessages(inviteCode);
        if (cancelled) return;
        setMessages((current) => mergeMessages(current, latest));
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
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
  }, [inviteCode]);

  const send = useCallback(
    async (messageText: string): Promise<SendResult> => {
      setSending(true);
      try {
        const sent = await sendMessage(username, inviteCode, messageText);
        // Show it straight away instead of waiting for the next poll.
        setMessages((current) => mergeMessages(current, [sent]));
        return { ok: true };
      } catch (e) {
        if (e instanceof MessagingError) {
          return { ok: false, error: e.message, retryAfterMs: e.retryAfterMs };
        }
        return { ok: false, error: 'Could not send message' };
      } finally {
        setSending(false);
      }
    },
    [username, inviteCode],
  );

  return { messages, loading, loadError, sending, send };
}

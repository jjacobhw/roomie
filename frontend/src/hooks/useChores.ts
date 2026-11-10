import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createChoreItem,
  createChoreList,
  getChoreLists,
  setChoreItemDone,
} from '../services/messagingApi';
import { ChoreList, NewChoreList } from '../types/chores';
import { MessagingError } from '../types/messaging';
import { appendChoreItem, appendChoreList, toggleChoreItem } from '../utils/chores';

const POLL_INTERVAL_MS = 5000; // so one roommate's checkmark shows up for the others

export type ChoreActionResult = { ok: true } | { ok: false; error: string };

// Loads the household's chore lists, keeps them fresh, and changes them.
// onSessionExpired runs when the server says the token is no longer valid (401).
export function useChores(
  token: string,
  inviteCode: string,
  username: string,
  onSessionExpired: () => void,
) {
  const [lists, setLists] = useState<ChoreList[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Always call the latest callback without restarting the polling timer when it changes.
  const expiredRef = useRef(onSessionExpired);
  expiredRef.current = onSessionExpired;

  // Guards against a slow refresh overwriting a change you just made: while a change is in
  // flight, or if one finished since the refresh started, the refresh's answer is thrown away.
  const inFlight = useRef(0);
  const changes = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const startedAtChange = changes.current;
    try {
      const latest = await getChoreLists(token, inviteCode);
      if (!alive.current) return;
      if (inFlight.current > 0 || changes.current !== startedAtChange) return;
      setLists(latest);
      setLoadError(null);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof MessagingError && e.code === 'UNAUTHENTICATED') {
        expiredRef.current();
        return;
      }
      setLoadError(e instanceof Error ? e.message : 'Could not load chores');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [token, inviteCode]);

  useEffect(() => {
    alive.current = true;
    setLists([]);
    setLoading(true);
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  // Runs one change to the server. `optimistic` updates the screen immediately; if the server
  // refuses, a refresh puts the screen back to what the server really has.
  const change = useCallback(
    async (action: () => Promise<void>, optimistic?: () => void): Promise<ChoreActionResult> => {
      inFlight.current++;
      changes.current++;
      try {
        optimistic?.();
        await action();
        return { ok: true };
      } catch (e) {
        if (e instanceof MessagingError) {
          if (e.code === 'UNAUTHENTICATED') expiredRef.current();
          return { ok: false, error: e.message };
        }
        return { ok: false, error: 'Something went wrong' };
      } finally {
        inFlight.current--;
        changes.current++;
        refresh();
      }
    },
    [refresh],
  );

  const toggle = useCallback(
    (itemId: string, isDone: boolean) =>
      change(
        async () => {
          await setChoreItemDone(token, itemId, isDone);
        },
        () =>
          setLists((current) => toggleChoreItem(current, itemId, isDone, username, new Date().toISOString())),
      ),
    [change, token, username],
  );

  const addItem = useCallback(
    (listId: string, text: string) =>
      change(async () => {
        const item = await createChoreItem(token, listId, text);
        setLists((current) => appendChoreItem(current, listId, item));
      }),
    [change, token],
  );

  const createList = useCallback(
    (input: NewChoreList) =>
      change(async () => {
        const list = await createChoreList(token, inviteCode, input);
        setLists((current) => appendChoreList(current, list));
      }),
    [change, token, inviteCode],
  );

  return { lists, loading, loadError, toggle, addItem, createList };
}

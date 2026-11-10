import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addChoreItem,
  createChoreList,
  deleteChoreItem,
  deleteChoreList,
  getChores,
  setChoreItemDone,
} from '../services/messagingApi';
import { ChoreList, MessagingError } from '../types/messaging';

const POLL_INTERVAL_MS = 10000; // pick up roommates' changes without a manual refresh

export type ChoreResult = { ok: true } | { ok: false; error: string };

// Loads a household's chore lists, keeps them fresh, and applies changes.
// Toggling and deleting update the screen at once and roll back if the server says no.
export function useChores(token: string, inviteCode: string, onSessionExpired: () => void) {
  const [lists, setLists] = useState<ChoreList[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const expiredRef = useRef(onSessionExpired);
  expiredRef.current = onSessionExpired;
  // Counts changes in flight; a poll that started before a change must not overwrite it.
  const pending = useRef(0);
  const version = useRef(0);

  const refresh = useCallback(async () => {
    const startedAt = version.current;
    try {
      const latest = await getChores(token, inviteCode);
      if (pending.current === 0 && version.current === startedAt) setLists(latest);
      setLoadError(null);
    } catch (e) {
      if (e instanceof MessagingError && e.code === 'UNAUTHENTICATED') {
        expiredRef.current();
        return;
      }
      setLoadError(e instanceof Error ? e.message : 'Could not load chores');
    } finally {
      setLoading(false);
    }
  }, [token, inviteCode]);

  useEffect(() => {
    setLists([]);
    setLoading(true);
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Runs one change. `apply` updates the screen first; on failure the previous lists come back.
  const change = useCallback(
    async (apply: (current: ChoreList[]) => ChoreList[], send: () => Promise<void>, fallback: string): Promise<ChoreResult> => {
      let before: ChoreList[] = [];
      setLists((current) => {
        before = current;
        return apply(current);
      });
      pending.current++;
      version.current++;
      try {
        await send();
        return { ok: true };
      } catch (e) {
        setLists(before);
        if (e instanceof MessagingError) {
          if (e.code === 'UNAUTHENTICATED') expiredRef.current();
          return { ok: false, error: e.message };
        }
        return { ok: false, error: fallback };
      } finally {
        pending.current--;
        version.current++;
      }
    },
    [],
  );

  const toggleItem = useCallback(
    (listId: string, itemId: string, isDone: boolean, username: string) =>
      change(
        (cur) =>
          cur.map((l) =>
            l.id !== listId
              ? l
              : {
                  ...l,
                  items: l.items.map((i) =>
                    i.id === itemId
                      ? { ...i, isDone, doneBy: isDone ? username : null, doneAt: isDone ? new Date().toISOString() : null }
                      : i,
                  ),
                },
          ),
        async () => {
          const saved = await setChoreItemDone(token, itemId, isDone);
          setLists((cur) =>
            cur.map((l) => (l.id !== listId ? l : { ...l, items: l.items.map((i) => (i.id === itemId ? saved : i)) })),
          );
        },
        'Could not update that chore',
      ),
    [token, change],
  );

  const removeItem = useCallback(
    (listId: string, itemId: string) =>
      change(
        (cur) => cur.map((l) => (l.id !== listId ? l : { ...l, items: l.items.filter((i) => i.id !== itemId) })),
        () => deleteChoreItem(token, itemId),
        'Could not delete that chore',
      ),
    [token, change],
  );

  const removeList = useCallback(
    (listId: string) =>
      change(
        (cur) => cur.filter((l) => l.id !== listId),
        () => deleteChoreList(token, listId),
        'Could not delete that list',
      ),
    [token, change],
  );

  // Adding waits for the server, because the new item's id comes from the database.
  const addItem = useCallback(
    async (listId: string, text: string): Promise<ChoreResult> => {
      pending.current++;
      version.current++;
      try {
        const item = await addChoreItem(token, listId, text);
        setLists((cur) => cur.map((l) => (l.id !== listId ? l : { ...l, items: [...l.items, item] })));
        return { ok: true };
      } catch (e) {
        if (e instanceof MessagingError) {
          if (e.code === 'UNAUTHENTICATED') expiredRef.current();
          return { ok: false, error: e.message };
        }
        return { ok: false, error: 'Could not add that chore' };
      } finally {
        pending.current--;
        version.current++;
      }
    },
    [token],
  );

  const addList = useCallback(
    async (options: { title?: string; assignee?: string | null }): Promise<ChoreResult> => {
      pending.current++;
      version.current++;
      try {
        const list = await createChoreList(token, inviteCode, options);
        setLists((cur) => [...cur, list]);
        return { ok: true };
      } catch (e) {
        if (e instanceof MessagingError) {
          if (e.code === 'UNAUTHENTICATED') expiredRef.current();
          return { ok: false, error: e.message };
        }
        return { ok: false, error: 'Could not create that list' };
      } finally {
        pending.current--;
        version.current++;
      }
    },
    [token, inviteCode],
  );

  return { lists, loading, loadError, refresh, toggleItem, removeItem, removeList, addItem, addList };
}

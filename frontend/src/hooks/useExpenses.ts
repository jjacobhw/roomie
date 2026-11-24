import { useCallback, useEffect, useRef, useState } from 'react';
import { createExpense, deleteExpense, getExpenses } from '../services/messagingApi';
import type { Expense, NewExpense } from '../types/expenses';
import { MessagingError } from '../types/messaging';
import { addExpense, removeExpense } from '../utils/expenses';

const POLL_INTERVAL_MS = 10000; // so a roommate's new expense shows up without a manual refresh

export type ExpenseResult = { ok: true } | { ok: false; error: string };

// Loads the household's expenses, keeps them fresh, and adds new ones.
// onSessionExpired runs when the server says the token is no longer valid (401).
export function useExpenses(token: string, inviteCode: string, onSessionExpired: () => void) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const expiredRef = useRef(onSessionExpired);
  expiredRef.current = onSessionExpired;

  // A slow refresh must not overwrite an expense you just added: while an add is in flight, or if
  // one finished since the refresh started, the refresh's answer is thrown away.
  const inFlight = useRef(0);
  const changes = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const startedAtChange = changes.current;
    try {
      const latest = await getExpenses(token, inviteCode);
      if (!alive.current) return;
      if (inFlight.current > 0 || changes.current !== startedAtChange) return;
      setExpenses(latest);
      setLoadError(null);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof MessagingError && e.code === 'UNAUTHENTICATED') {
        expiredRef.current();
        return;
      }
      setLoadError(e instanceof Error ? e.message : 'Could not load expenses');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [token, inviteCode]);

  useEffect(() => {
    alive.current = true;
    setExpenses([]);
    setLoading(true);
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  // Pull-to-refresh.
  const reload = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    if (alive.current) setRefreshing(false);
  }, [refresh]);

  const create = useCallback(
    async (input: NewExpense): Promise<ExpenseResult> => {
      inFlight.current++;
      changes.current++;
      try {
        const saved = await createExpense(token, inviteCode, input);
        // Show it straight away; the refresh below then confirms what the server really has.
        if (alive.current) setExpenses((current) => addExpense(current, saved));
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
    [token, inviteCode, refresh],
  );

  // Delete an expense you added. It disappears at once; if the server refuses, the refresh that
  // follows brings it back and the reason is returned.
  const remove = useCallback(
    async (expenseId: string): Promise<ExpenseResult> => {
      inFlight.current++;
      changes.current++;
      if (alive.current) setExpenses((current) => removeExpense(current, expenseId));
      try {
        await deleteExpense(token, inviteCode, expenseId);
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
    [token, inviteCode, refresh],
  );

  return { expenses, loading, loadError, refreshing, reload, refresh, create, remove };
}

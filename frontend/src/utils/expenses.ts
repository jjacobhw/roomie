import { EXPENSE_MAX_CENTS } from '../types/expenses';
import type { Expense, NewExpenseSplit } from '../types/expenses';

// Money helpers for the Expenses tab. Everything is whole cents; no decimals are ever added up.
// Pure functions only (no React), so they are easy to test.

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

// Turn what someone typed ("12", "12.5", "$1,234.50") into cents, or null if it isn't a usable amount:
// more than 2 decimals, zero, negative, not a number, or above the limit.
export function parseAmountToCents(text: string): number | null {
  const trimmed = text.trim();
  // Commas are only allowed as thousands separators.
  if (trimmed.includes(',') && !/^\$?\s*\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/^\$/, '').replace(/,/g, '').trim();
  if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  const cents = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2));
  return cents >= 1 && cents <= EXPENSE_MAX_CENTS ? cents : null;
}

// Keeps the amount box tidy as someone types: digits and one decimal point only, at most 2 decimals.
// "12.345" -> "12.34", "1a2.5.6" -> "12.5", "$ 4" -> "4".
export function sanitizeAmountInput(text: string): string {
  const kept = text.replace(/[^0-9.]/g, '');
  const dot = kept.indexOf('.');
  if (dot === -1) return kept;
  return kept.slice(0, dot + 1) + kept.slice(dot + 1).replace(/\./g, '').slice(0, 2);
}

// 125000 -> "$1,250.00"; negative amounts get a leading minus.
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return '$0.00';
  const whole = Math.abs(Math.round(cents));
  const dollars = String(Math.floor(whole / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(whole % 100).padStart(2, '0')}`;
}

// Split a total evenly between people so the shares always add up to exactly the total.
// Everyone pays the rounded-down share. The leftover cents go to the payer if they are one of the
// people (so nobody else ever pays more than their fair share), otherwise to the first people listed.
export function splitEqually(totalCents: number, people: string[], payerId?: string): { userId: string; amountCents: number }[] {
  const ids = people.filter((id, index) => people.indexOf(id) === index);
  if (ids.length === 0) return [];
  const base = Math.floor(totalCents / ids.length);
  const shares = ids.map(() => base);
  let leftover = totalCents - base * ids.length;
  const payerIndex = payerId === undefined ? -1 : ids.indexOf(payerId);
  if (payerIndex >= 0) {
    shares[payerIndex] += leftover;
  } else {
    for (let i = 0; leftover > 0; i++, leftover--) shares[i] += 1;
  }
  return ids.map((userId, index) => ({ userId, amountCents: shares[index] }));
}

// The one-line explanation under the split chips while adding an expense.
export function splitPreview(totalCents: number, peopleCount: number, payerIncluded: boolean): string {
  if (peopleCount < 1) return 'Pick at least one person';
  const base = Math.floor(totalCents / peopleCount);
  if (peopleCount === 1) return payerIncluded ? 'Just you: nobody owes anything' : `They pay ${formatCents(totalCents)}`;
  if (base * peopleCount === totalCents) return `Everyone pays ${formatCents(base)}`;
  return payerIncluded
    ? `Others pay ${formatCents(base)} each · you cover the rest`
    : `Each pays about ${formatCents(base)}`;
}

// Who owes whom, from the open (unpaid) shares only. cents > 0 means that person owes you;
// cents < 0 means you owe them. net is the total of all of them (positive: you are owed overall).
export type Balance = { net: number; people: { username: string; cents: number }[] };

export function computeBalances(expenses: Expense[], me: string): Balance {
  const byPerson = new Map<string, { username: string; cents: number }>();
  const add = (username: string, cents: number) => {
    const key = username.trim().toLowerCase();
    const entry = byPerson.get(key) ?? { username, cents: 0 };
    entry.cents += cents;
    byPerson.set(key, entry);
  };
  for (const expense of expenses) {
    const payer = expense.paidByUsername;
    for (const split of expense.splits) {
      // Paid shares are settled, and the payer's own share is money they owe themselves.
      if (split.isPaid || sameName(split.username, payer)) continue;
      if (sameName(payer, me)) add(split.username, split.amountCents);
      else if (sameName(split.username, me)) add(payer, -split.amountCents);
    }
  }
  const people = [...byPerson.values()]
    .filter((person) => person.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
  return { net: sum(people.map((person) => person.cents)), people };
}

// The lines shown under the big balance, e.g. "Sam owes you $30.00" or "You owe Taylor $12.50".
export function balanceLines(balance: Balance): string[] {
  return balance.people.map((person) =>
    person.cents > 0
      ? `${person.username} owes you ${formatCents(person.cents)}`
      : `You owe ${person.username} ${formatCents(-person.cents)}`,
  );
}

// How one expense affects you, for the right-hand side of its row.
export type Share = {
  kind: 'lent' | 'owe' | 'settled' | 'none';
  cents: number; // 0 when there is nothing to show
  label: string;
};

export function describeShare(expense: Expense, me: string): Share {
  if (sameName(expense.paidByUsername, me)) {
    const others = expense.splits.filter((split) => !sameName(split.username, me));
    if (others.length === 0) return { kind: 'none', cents: 0, label: 'just you' };
    const open = sum(others.filter((split) => !split.isPaid).map((split) => split.amountCents));
    if (open === 0) return { kind: 'settled', cents: sum(others.map((split) => split.amountCents)), label: 'settled up' };
    return { kind: 'lent', cents: open, label: 'you lent' };
  }
  const mine = expense.splits.find((split) => sameName(split.username, me));
  if (!mine) return { kind: 'none', cents: 0, label: 'not involved' };
  return mine.isPaid
    ? { kind: 'settled', cents: mine.amountCents, label: 'settled up' }
    : { kind: 'owe', cents: mine.amountCents, label: 'you owe' };
}

// "You paid $60.00 · 3 people" / "Sam paid $60.00 · 3 people"
export function expenseSubtitle(expense: Expense, me: string): string {
  const payer = sameName(expense.paidByUsername, me) ? 'You' : expense.paidByUsername;
  const people = Math.max(expense.splits.length, 1);
  return `${payer} paid ${formatCents(expense.amountCents)} · ${people} ${people === 1 ? 'person' : 'people'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Newest first, grouped under a heading per calendar day (in the phone's own time zone):
// "Today", "Yesterday", "Nov 12", or "Nov 12, 2025" for another year. Bad dates go under "Earlier".
export function groupByDay(expenses: Expense[], now: Date = new Date()): { key: string; label: string; expenses: Expense[] }[] {
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const time = (expense: Expense) => Date.parse(expense.createdAt);
  const sorted = [...expenses].sort((a, b) => {
    const [ta, tb] = [time(a), time(b)];
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) === Number.isNaN(tb) ? 0 : Number.isNaN(ta) ? 1 : -1;
    return tb - ta;
  });
  const groups: { key: string; label: string; expenses: Expense[] }[] = [];
  for (const expense of sorted) {
    const when = new Date(time(expense));
    const valid = !Number.isNaN(when.getTime());
    const key = valid ? dayKey(when) : 'earlier';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      let label = 'Earlier';
      if (valid) {
        if (key === dayKey(now)) label = 'Today';
        else if (key === dayKey(yesterday)) label = 'Yesterday';
        else label = `${MONTHS[when.getMonth()]} ${when.getDate()}${when.getFullYear() === now.getFullYear() ? '' : `, ${when.getFullYear()}`}`;
      }
      group = { key, label, expenses: [] };
      groups.push(group);
    }
    group.expenses.push(expense);
  }
  return groups;
}

// Put an expense the server just saved into the list, newest first. Nothing changes if it is already there.
export function addExpense(expenses: Expense[], expense: Expense): Expense[] {
  if (expenses.some((existing) => existing.id === expense.id)) return expenses;
  return [expense, ...expenses].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// Check a split before sending it: whole positive cents, adding up to the total. Returns a message or null.
export function checkSplits(totalCents: number, splits: NewExpenseSplit[]): string | null {
  if (splits.length === 0) return 'Pick at least one person to split with.';
  if (splits.some((split) => !Number.isInteger(split.amountCents) || split.amountCents < 0)) return 'Each share must be a whole number of cents.';
  if (sum(splits.map((split) => split.amountCents)) !== totalCents) return 'The shares must add up to the total.';
  return null;
}

// Only the person who added an expense can delete it. The person who adds an expense is always
// recorded as the one who paid, so that is who it belongs to.
export function canDeleteExpense(expense: Expense, me: string): boolean {
  return sameName(expense.paidByUsername, me);
}

// Take an expense out of the list. If it isn't there, the same list comes back.
export function removeExpense(expenses: Expense[], expenseId: string): Expense[] {
  return expenses.some((expense) => expense.id === expenseId)
    ? expenses.filter((expense) => expense.id !== expenseId)
    : expenses;
}


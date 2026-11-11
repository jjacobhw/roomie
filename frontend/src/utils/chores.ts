import { ChoreItem, ChoreList } from '../types/chores';

// Check or uncheck one chore. Checking records who did it and when; unchecking clears both,
// like the backend does. Returns new lists and never changes the ones passed in.
export function toggleChoreItem(
  lists: ChoreList[],
  itemId: string,
  isDone: boolean,
  username: string,
  nowIso: string,
): ChoreList[] {
  return lists.map((list) =>
    // Lists that don't contain the item come back untouched.
    list.items.some((item) => item.id === itemId)
      ? {
          ...list,
          items: list.items.map((item) =>
            item.id === itemId
              ? { ...item, isDone, doneBy: isDone ? username : null, doneAt: isDone ? nowIso : null }
              : item,
          ),
        }
      : list,
  );
}

// Put a chore the server just saved at the end of its list. If the list isn't there or already
// has that chore (a refresh got there first), the same lists come back.
export function appendChoreItem(lists: ChoreList[], listId: string, item: ChoreItem): ChoreList[] {
  const target = lists.find((list) => list.id === listId);
  if (!target || target.items.some((existing) => existing.id === item.id)) return lists;
  return lists.map((list) => (list === target ? { ...list, items: [...list.items, item] } : list));
}

// Put a list the server just saved at the end. Does nothing if it's already there.
export function appendChoreList(lists: ChoreList[], list: ChoreList): ChoreList[] {
  return lists.some((existing) => existing.id === list.id) ? lists : [...lists, list];
}

// Take one chore out of whichever list holds it. Lists that don't hold it come back untouched.
export function removeChoreItem(lists: ChoreList[], itemId: string): ChoreList[] {
  return lists.map((list) =>
    list.items.some((item) => item.id === itemId)
      ? { ...list, items: list.items.filter((item) => item.id !== itemId) }
      : list,
  );
}

// Take a whole list out. If it isn't there, the same lists come back.
export function removeChoreList(lists: ChoreList[], listId: string): ChoreList[] {
  return lists.some((list) => list.id === listId) ? lists.filter((list) => list.id !== listId) : lists;
}

export function choreProgress(list: ChoreList): { done: number; total: number } {
  return { done: list.items.filter((item) => item.isDone).length, total: list.items.length };
}

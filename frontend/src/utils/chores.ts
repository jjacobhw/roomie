import { CHORE_ITEM_MAX_LENGTH, ChoreList } from '../types/chores';

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

// Add a chore to a list. Blank text, text over the length limit, or an unknown list
// change nothing (the same lists come back).
export function addChoreItem(
  lists: ChoreList[],
  listId: string,
  text: string,
  id: string,
  nowIso: string,
): ChoreList[] {
  const body = text.trim();
  if (body.length < 1 || body.length > CHORE_ITEM_MAX_LENGTH) return lists;
  if (!lists.some((list) => list.id === listId)) return lists;
  return lists.map((list) =>
    list.id === listId
      ? {
          ...list,
          items: [...list.items, { id, text: body, isDone: false, doneBy: null, doneAt: null, createdAt: nowIso }],
        }
      : list,
  );
}

export function choreProgress(list: ChoreList): { done: number; total: number } {
  return { done: list.items.filter((item) => item.isDone).length, total: list.items.length };
}

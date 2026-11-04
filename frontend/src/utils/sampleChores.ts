import { ChoreList } from '../types/chores';

// Placeholder chores so the Chores screen has something to show. Delete this file and load
// the lists from the server (GET /conversations/:inviteCode/chores) when that's connected.
export function sampleChoreLists(username: string, now: Date = new Date()): ChoreList[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();
  const item = (id: string, text: string, doneBy: string | null = null, doneHoursAgo = 0) => ({
    id,
    text,
    isDone: doneBy !== null,
    doneBy,
    doneAt: doneBy !== null ? ago(doneHoursAgo) : null,
    createdAt: ago(48),
  });
  return [
    {
      id: 'sample-list-1',
      title: `${username}'s chores`,
      assignee: username,
      createdBy: username,
      createdAt: ago(48),
      items: [
        item('sample-1', 'Take out the trash'),
        item('sample-2', 'Do the dishes', username, 1),
        item('sample-3', 'Water the plants'),
      ],
    },
    {
      id: 'sample-list-2',
      title: 'Whole house',
      assignee: null,
      createdBy: username,
      createdAt: ago(47),
      items: [
        item('sample-4', 'Clean the bathroom', 'Alex', 3),
        item('sample-5', 'Vacuum the living room'),
        item('sample-6', 'Restock toilet paper'),
      ],
    },
  ];
}

// Shapes of chore lists, matching what the backend sends (backend/choreRoutes.ts).

export type ChoreItem = {
  id: string;
  text: string;
  isDone: boolean;
  doneBy: string | null; // username of whoever checked it off
  doneAt: string | null; // ISO string
  createdAt: string; // ISO string
};

export type ChoreList = {
  id: string;
  title: string;
  assignee: string | null; // username, or null for the whole household
  createdBy: string | null;
  createdAt: string; // ISO string
  items: ChoreItem[];
};

export const CHORE_ITEM_MAX_LENGTH = 200; // matches the backend and database limit

export const CHORE_TITLE_MAX_LENGTH = 80; // matches the backend and database limit

// What you can set when creating a list. Leave a field out for the server's default:
// the title becomes "<name>'s chores" and the list is assigned to you. assignee: null means the whole house.
export type NewChoreList = {
  title?: string;
  assignee?: string | null;
};

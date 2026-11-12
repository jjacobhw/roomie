import { HouseholdMember } from '../types/messaging';

// Owner first, then everyone else by name (case-insensitive).
export function sortMembers(members: HouseholdMember[]): HouseholdMember[] {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
    return a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
  });
}

// The letter shown in a member's avatar circle.
export function initial(username: string): string {
  return (username.trim()[0] ?? '?').toUpperCase();
}

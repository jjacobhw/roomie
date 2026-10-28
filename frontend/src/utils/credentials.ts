import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH } from '../types/messaging';

// The same limits the server enforces on sign up, checked first so mistakes show up instantly.
// Returns a message to show the user, or null when the fields are fine.
export function validateCredentials(username: string, password: string): string | null {
  const name = username.trim();
  if (name.length < 1) return 'Enter a username.';
  if (name.length > USERNAME_MAX_LENGTH) return `Username can be at most ${USERNAME_MAX_LENGTH} characters.`;
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password can be at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

export const INVITE_CODE_LENGTH = 6;

// Clean up what the user typed or pasted into the invite-code box: letters and
// digits only, uppercase, at most 6 characters. ("ab-12 cd" -> "AB12CD")
export function normalizeInviteCode(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, INVITE_CODE_LENGTH);
}

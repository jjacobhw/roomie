// Shapes shared by the messaging UI, the mock API and (later) the real API.
// They mirror the backend's Message/Conversation in backend/texting.ts.

export type Message = {
  // The backend doesn't have message ids yet; the UI needs one for list keys.
  id: string;
  username: string;
  messageText: string;
  // ISO string, because JSON can't carry Date objects over the network.
  timestamp: string;
};

export type Conversation = {
  inviteCode: string;
  users: string[];
  messages: Message[];
};

// The hardcoded Sprint 1 users.
export const USERS = ['testuser', 'world'] as const;
export type Username = (typeof USERS)[number];

// Why a request failed, so the UI can show a useful message.
export type MessagingErrorCode =
  | 'ALREADY_IN_CONVERSATION'
  | 'CONVERSATION_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'EMPTY_MESSAGE';

export class MessagingError extends Error {
  code: MessagingErrorCode;
  // Only set for RATE_LIMITED: how long until the user can send again.
  retryAfterMs?: number;

  constructor(code: MessagingErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'MessagingError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

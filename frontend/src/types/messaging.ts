// Shapes shared by the screens, the mock API and the real API.
// They mirror what the backend (backend/routes.ts) sends and accepts.

export type Message = {
  // The backend doesn't send message ids; httpApi builds a stable one so lists have unique keys.
  id: string;
  username: string;
  messageText: string;
  // ISO string, because JSON can't carry Date objects over the network.
  timestamp: string;
};

// A signed-in account.
export type AuthUser = {
  id: string;
  username: string;
};

// What sign up / sign in give back. The token goes with every other request.
export type Session = {
  user: AuthUser;
  token: string;
};

// A household as GET /conversations describes it.
export type ConversationSummary = {
  inviteCode: string;
  name: string;
  users: string[];
};

// Why a request failed, so the UI can show a useful message.
export type MessagingErrorCode =
  | 'INVALID_INPUT' // 400: the server rejected a field (too short, too long...)
  | 'EMPTY_MESSAGE' // 400 on send
  | 'UNAUTHENTICATED' // 401: no token, or the session expired
  | 'INVALID_CREDENTIALS' // 401 on sign in: wrong username or password
  | 'NOT_A_MEMBER' // 403
  | 'CONVERSATION_NOT_FOUND' // 404
  | 'USERNAME_TAKEN' // 409 on sign up
  | 'ALREADY_IN_CONVERSATION' // 409 on create/join: one household per user
  | 'RATE_LIMITED' // 429: sending faster than once every 3 seconds
  | 'NETWORK_ERROR' // the server couldn't be reached
  | 'SERVER_ERROR'; // anything else

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

// Same limits the backend enforces on sign up, checked here first for faster feedback.
export const USERNAME_MAX_LENGTH = 50;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

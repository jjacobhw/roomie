// Shapes shared by the screens, the mock API and the real API.
// They mirror what the backend (backend/routes.ts) sends and accepts.

export type Message = {
  // The backend doesn't send message ids; httpApi builds a stable one so lists have unique keys.
  id: string;
  username: string;
  messageText: string;
  // ISO string, because JSON can't carry Date objects over the network.
  timestamp: string;
  // Files sent with the message. Empty for plain text.
  attachments: MessageAttachment[];
};

// A file inside a message. `url` is a temporary download link from the server.
export type MessageAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
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
  | 'FILE_TOO_LARGE' // 413 on upload
  | 'UNSUPPORTED_FILE' // 415 on upload
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

// A file the user picked, as expo-document-picker describes it.
export type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

// A file that is fully uploaded and recorded as 'complete' on the server.
export type UploadedAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

// Same rules the backend enforces on uploads (backend/uploads.ts), checked here first for faster feedback.
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'application/pdf',
  'text/plain',
];

// Pictures the chat draws inline. HEIC is left out because most browsers can't display it.
export function isPreviewableImage(contentType: string): boolean {
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType.toLowerCase());
}

// Throws the same errors the server would, before any network call is made.
export function checkAttachment(file: PickedFile): void {
  if (!ATTACHMENT_CONTENT_TYPES.includes(file.mimeType.toLowerCase())) {
    throw new MessagingError('UNSUPPORTED_FILE', 'That file type can’t be sent. Use an image, PDF, or text file.');
  }
  if (file.sizeBytes < 1 || file.sizeBytes > ATTACHMENT_MAX_BYTES) {
    throw new MessagingError('FILE_TOO_LARGE', 'Files must be between 1 byte and 10 MB.');
  }
}

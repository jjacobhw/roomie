// Talks to the real backend over HTTP. Same functions as mockApi.ts, so the screens
// don't know which one they're using. Routes follow the contract sent to the backend team.
import { API_URL } from '../config';
import { Message, MessagingError, MessagingErrorCode } from '../types/messaging';

const REQUEST_TIMEOUT_MS = 8000;

// Turn a failed HTTP response into the same errors the mock throws.
export function errorFromResponse(status: number, body: unknown): MessagingError {
  const data = (body ?? {}) as { error?: unknown; retryAfterMs?: unknown };
  const text = typeof data.error === 'string' && data.error ? data.error : undefined;

  let code: MessagingErrorCode;
  let fallback: string;
  switch (status) {
    case 400:
      code = 'EMPTY_MESSAGE';
      fallback = 'That message can’t be sent';
      break;
    case 403:
      code = 'NOT_A_MEMBER';
      fallback = 'You’re not in this household';
      break;
    case 404:
      // The server says what wasn't found; "User not found" is different from a bad code.
      code = text && /user/i.test(text) ? 'USER_NOT_FOUND' : 'CONVERSATION_NOT_FOUND';
      fallback = 'Not found';
      break;
    case 409:
      code = 'ALREADY_IN_CONVERSATION';
      fallback = 'Already in a household';
      break;
    case 429:
      code = 'RATE_LIMITED';
      fallback = 'Slow down a little';
      break;
    default:
      code = 'SERVER_ERROR';
      fallback = 'Something went wrong on the server';
  }
  const retryAfterMs = typeof data.retryAfterMs === 'number' ? data.retryAfterMs : undefined;
  return new MessagingError(code, text ?? fallback, retryAfterMs);
}

// Accept what the server sends and return exactly the Message the UI expects.
// Tolerates a missing id (builds one) and any date format the server uses.
export function parseMessage(raw: unknown, index = 0): Message {
  const m = (raw ?? {}) as Record<string, unknown>;
  const username = String(m.username ?? 'unknown');
  const parsed = new Date(String(m.timestamp));
  const timestamp = isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
  const id = m.id !== undefined && m.id !== null ? String(m.id) : `${timestamp}-${username}-${index}`;
  return { id, username, messageText: String(m.messageText ?? ''), timestamp };
}

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new MessagingError('NETWORK_ERROR', 'Can’t reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // An empty or non-JSON body is fine for success; errors fall back to a generic message.
  }
  if (!response.ok) throw errorFromResponse(response.status, data);
  return data;
}

const enc = encodeURIComponent;

export async function createConversation(username: string): Promise<string> {
  const data = await request('POST', '/households', { username });
  if (typeof data?.inviteCode !== 'string') {
    throw new MessagingError('SERVER_ERROR', 'The server didn’t return an invite code');
  }
  return data.inviteCode;
}

export async function joinConversation(username: string, inviteCode: string): Promise<void> {
  await request('POST', '/households/join', { username, inviteCode });
}

export async function getMessages(inviteCode: string): Promise<Message[]> {
  const data = await request('GET', `/messages/${enc(inviteCode)}`);
  const list: unknown[] = Array.isArray(data?.messages) ? data.messages : [];
  return list.map(parseMessage);
}

export async function sendMessage(
  username: string,
  inviteCode: string,
  messageText: string,
): Promise<Message> {
  const text = messageText.trim();
  if (!text) throw new MessagingError('EMPTY_MESSAGE', 'Message is empty');

  const data = await request('POST', `/households/${enc(inviteCode)}/messages`, {
    username,
    messageText: text,
  });
  return parseMessage(data?.message);
}

// The backend has no leave route yet, and no screen uses this.
export async function leaveConversation(_username: string, _inviteCode: string): Promise<void> {
  throw new MessagingError('SERVER_ERROR', 'Leaving a household isn’t supported by the server yet');
}

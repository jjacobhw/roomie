// Talks to the real backend (backend/routes.ts) over HTTP. Same functions as mockApi.ts,
// so the screens don't know which one they're using.
// Everything except sign up and sign in needs the token from signUp/signIn.
import { API_URL } from '../config';
import {
  AuthUser,
  ConversationSummary,
  Message,
  MessageAttachment,
  MessagingError,
  MessagingErrorCode,
  PickedFile,
  Session,
  UploadedAttachment,
  checkAttachment,
} from '../types/messaging';

const REQUEST_TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60000; // the file itself can be several MB

// Which request failed decides what a status code means (401 on sign in is a wrong password,
// 401 anywhere else is an expired session).
type Context = 'signup' | 'signin' | 'send' | 'upload' | 'other';

// Turn a failed HTTP response into the same errors the mock throws.
export function errorFromResponse(
  status: number,
  body: unknown,
  retryAfterHeader: string | null = null,
  context: Context = 'other',
): MessagingError {
  const data = (body ?? {}) as { error?: unknown; retryAfterMs?: unknown };
  const text = typeof data.error === 'string' && data.error ? data.error : undefined;

  let code: MessagingErrorCode;
  let fallback: string;
  switch (status) {
    case 400:
      code = context === 'send' ? 'EMPTY_MESSAGE' : 'INVALID_INPUT';
      fallback = 'That wasn’t accepted';
      break;
    case 401:
      code = context === 'signin' ? 'INVALID_CREDENTIALS' : 'UNAUTHENTICATED';
      fallback = context === 'signin' ? 'Invalid username or password' : 'Please sign in again';
      break;
    case 403:
      code = 'NOT_A_MEMBER';
      fallback = 'You’re not in this household';
      break;
    case 413:
      code = 'FILE_TOO_LARGE';
      fallback = 'That file is too large';
      break;
    case 415:
      code = 'UNSUPPORTED_FILE';
      fallback = 'That file type can’t be sent';
      break;
    case 404:
      code = 'CONVERSATION_NOT_FOUND';
      fallback = 'Household not found';
      break;
    case 409:
      code = context === 'signup' ? 'USERNAME_TAKEN' : 'ALREADY_IN_CONVERSATION';
      fallback = context === 'signup' ? 'That username is taken' : 'Already in a household';
      break;
    case 429:
      code = 'RATE_LIMITED';
      fallback = 'Please wait before sending another message';
      break;
    default:
      code = 'SERVER_ERROR';
      fallback = 'Something went wrong on the server';
  }

  // The server says how long to wait in the Retry-After header (seconds); a body value wins.
  let retryAfterMs: number | undefined;
  if (typeof data.retryAfterMs === 'number') {
    retryAfterMs = data.retryAfterMs;
  } else if (retryAfterHeader !== null && retryAfterHeader.trim() !== '') {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = seconds * 1000;
  }
  return new MessagingError(code, text ?? fallback, retryAfterMs);
}

// Older servers send an empty list (or nothing); skip anything that isn't a complete attachment.
function parseAttachments(raw: unknown): MessageAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const a = (item ?? {}) as Record<string, unknown>;
    if (typeof a.id !== 'string' || typeof a.url !== 'string') return [];
    return [
      {
        id: a.id,
        url: a.url,
        fileName: typeof a.fileName === 'string' ? a.fileName : 'file',
        contentType: typeof a.contentType === 'string' ? a.contentType : 'application/octet-stream',
        sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : 0,
      },
    ];
  });
}

// Accept what the server sends and return exactly the Message the UI expects.
// The server sends no id, so build one from the content. It must come out the same whether
// the message arrives in a send response or in a later poll, otherwise it shows up twice.
export function parseMessage(raw: unknown): Message {
  const m = (raw ?? {}) as Record<string, unknown>;
  const username = String(m.username ?? 'unknown');
  const messageText = String(m.messageText ?? '');
  const parsed = new Date(String(m.timestamp));
  const timestamp = isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
  const attachments = parseAttachments(m.attachments);
  const attachmentIds = attachments.map((a) => a.id).join(',');
  const id =
    m.id !== undefined && m.id !== null
      ? String(m.id)
      : `${timestamp}|${username}|${messageText}|${attachmentIds}`;
  return { id, username, messageText, timestamp, attachments };
}

type RequestOptions = {
  token?: string;
  body?: unknown;
  context?: Context;
};

async function request(method: 'GET' | 'POST' | 'DELETE', path: string, options: RequestOptions = {}): Promise<any> {
  const { token, body, context = 'other' } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
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
    // An empty body (204) or non-JSON body is fine on success; errors fall back to a generic message.
  }
  if (!response.ok) {
    throw errorFromResponse(response.status, data, response.headers.get('Retry-After'), context);
  }
  return data;
}

const enc = encodeURIComponent;

function parseSession(data: any): Session {
  const user = data?.user as AuthUser | undefined;
  if (!user || typeof user.id !== 'string' || typeof user.username !== 'string' || typeof data?.token !== 'string') {
    throw new MessagingError('SERVER_ERROR', 'The server sent an unexpected sign-in response');
  }
  return { user: { id: user.id, username: user.username }, token: data.token };
}

export async function signUp(username: string, password: string): Promise<Session> {
  return parseSession(await request('POST', '/users', { body: { username, password }, context: 'signup' }));
}

export async function signIn(username: string, password: string): Promise<Session> {
  return parseSession(await request('POST', '/sessions', { body: { username, password }, context: 'signin' }));
}

export async function signOut(token: string): Promise<void> {
  await request('DELETE', '/sessions', { token });
}

// The household this user is already in, or null. Used right after sign in to skip the Join screen.
export async function getMyConversation(token: string): Promise<ConversationSummary | null> {
  const data = await request('GET', '/conversations', { token });
  const first = Array.isArray(data?.conversations) ? data.conversations[0] : undefined;
  if (!first || typeof first.inviteCode !== 'string') return null;
  return {
    inviteCode: first.inviteCode,
    name: typeof first.name === 'string' ? first.name : '',
    users: Array.isArray(first.users) ? first.users.map(String) : [],
  };
}

export async function createConversation(token: string): Promise<string> {
  const data = await request('POST', '/conversations', { token });
  const inviteCode = data?.conversation?.inviteCode;
  if (typeof inviteCode !== 'string') {
    throw new MessagingError('SERVER_ERROR', 'The server didn’t return an invite code');
  }
  return inviteCode;
}

export async function joinConversation(token: string, inviteCode: string): Promise<void> {
  await request('POST', `/conversations/${enc(inviteCode)}/members`, { token });
}

export async function getMessages(token: string, inviteCode: string): Promise<Message[]> {
  const data = await request('GET', `/messages/${enc(inviteCode)}`, { token });
  const list: unknown[] = Array.isArray(data?.messages) ? data.messages : [];
  return list.map(parseMessage);
}

// attachmentIds are files already uploaded with uploadAttachment; a message may be only files.
export async function sendMessage(
  token: string,
  inviteCode: string,
  messageText: string,
  attachmentIds: string[] = [],
): Promise<Message> {
  const text = messageText.trim();
  if (!text && attachmentIds.length === 0) throw new MessagingError('EMPTY_MESSAGE', 'Message is empty');

  const data = await request('POST', `/messages/${enc(inviteCode)}`, {
    token,
    body: attachmentIds.length > 0 ? { messageText: text, attachmentIds } : { messageText: text },
    context: 'send',
  });
  return parseMessage(data?.message);
}

// Three steps, like the backend: get a presigned URL, send the bytes straight to storage,
// then tell the server the upload is done so it can mark the file complete.
export async function uploadAttachment(
  token: string,
  inviteCode: string,
  file: PickedFile,
): Promise<UploadedAttachment> {
  checkAttachment(file);

  const slot = await request('POST', `/conversations/${enc(inviteCode)}/attachments`, {
    token,
    body: { fileName: file.name, contentType: file.mimeType, sizeBytes: file.sizeBytes },
    context: 'upload',
  });
  if (typeof slot?.attachmentId !== 'string' || typeof slot?.uploadUrl !== 'string') {
    throw new MessagingError('SERVER_ERROR', 'The server sent an unexpected upload response');
  }

  // The storage service checks the signature, so send exactly the headers the server told us to.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const bytes = await (await fetch(file.uri)).blob();
    const put = await fetch(slot.uploadUrl, {
      method: slot.uploadMethod ?? 'PUT',
      // No Authorization header here: the URL itself carries the permission.
      headers: slot.uploadHeaders ?? { 'Content-Type': file.mimeType },
      body: bytes,
      signal: controller.signal,
    });
    if (!put.ok) throw new MessagingError('SERVER_ERROR', 'The file could not be uploaded');
  } catch (e) {
    if (e instanceof MessagingError) throw e;
    throw new MessagingError('NETWORK_ERROR', 'Can’t reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  const done = await request('POST', `/attachments/${enc(slot.attachmentId)}/complete`, {
    token,
    context: 'upload',
  });
  const a = done?.attachment;
  if (!a || a.status !== 'complete') {
    throw new MessagingError('SERVER_ERROR', 'The server did not confirm the upload');
  }
  return { id: a.id, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes };
}

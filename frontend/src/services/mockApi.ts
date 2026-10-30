// Fake backend that keeps everything in memory, so the app runs without a server.
// It mimics backend/routes.ts: accounts with passwords, tokens, members-only households,
// one household per user, and a 3-second cooldown per sender. Same functions as httpApi.ts.
import {
  ConversationSummary,
  Message,
  MessageAttachment,
  MessagingError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PickedFile,
  Session,
  UploadedAttachment,
  USERNAME_MAX_LENGTH,
  checkAttachment,
} from '../types/messaging';

const FAKE_NETWORK_DELAY_MS = 250;
const COOLDOWN_MS = 3000; // Sprint 1: the server enforces 3s between messages per sender
const MAX_MESSAGE_LENGTH = 2000;

type Account = { id: string; username: string; password: string };
type House = { inviteCode: string; name: string; members: string[]; messages: Message[] };

const accounts = new Map<string, Account>(); // lowercase username -> account
const sessions = new Map<string, string>(); // token -> lowercase username
const houses = new Map<string, House>();
const lastSentAt = new Map<string, number>(); // lowercase username -> time of last message
// "Uploaded" files waiting to be sent, by id. The picked file's own uri stands in for a download link.
const uploads = new Map<string, MessageAttachment & { owner: string }>();

// A ready-made household so "join with code" can be tried straight away. Its only member
// is not a real account, so a new account is free to join it.
houses.set('DEMO12', {
  inviteCode: 'DEMO12',
  name: 'Demo household',
  members: ['Austin ligmarche'],
  messages: [
    {
      id: 'seed-1',
      username: 'Austin ligmarche',
      messageText: 'Welcome to the crib chat!',
      timestamp: new Date().toISOString(),
      attachments: [],
    },
  ],
});

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, FAKE_NETWORK_DELAY_MS));
}

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Always exactly 6 characters (Math.random().toString(36) can come out shorter), and
// never a code that's already taken.
function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, easy to read aloud
  let code: string;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (houses.has(code));
  return code;
}

// Every request except sign up/in needs a valid token, like the real server.
function accountFor(token: string): Account {
  const key = sessions.get(token);
  const account = key ? accounts.get(key) : undefined;
  if (!account) throw new MessagingError('UNAUTHENTICATED', 'Session is invalid or expired.');
  return account;
}

function houseOf(username: string): House | undefined {
  return [...houses.values()].find((h) => h.members.includes(username));
}

// Members only, for reading and sending alike.
function memberHouse(account: Account, inviteCode: string): House {
  const house = houses.get(inviteCode);
  if (!house) throw new MessagingError('CONVERSATION_NOT_FOUND', 'Conversation not found.');
  if (!house.members.includes(account.username)) {
    throw new MessagingError('NOT_A_MEMBER', 'User is not a member of this conversation.');
  }
  return house;
}

function startSession(account: Account): Session {
  const token = `${randomId()}${randomId()}${randomId()}`;
  sessions.set(token, account.username.toLowerCase());
  return { user: { id: account.id, username: account.username }, token };
}

export async function signUp(username: string, password: string): Promise<Session> {
  await delay();
  const name = username.trim();
  if (name.length < 1 || name.length > USERNAME_MAX_LENGTH) {
    throw new MessagingError('INVALID_INPUT', `username must be between 1 and ${USERNAME_MAX_LENGTH} characters.`);
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new MessagingError(
      'INVALID_INPUT',
      `password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  if (accounts.has(name.toLowerCase())) {
    throw new MessagingError('USERNAME_TAKEN', 'Username is already taken.');
  }
  const account: Account = { id: randomId(), username: name, password };
  accounts.set(name.toLowerCase(), account);
  return startSession(account);
}

export async function signIn(username: string, password: string): Promise<Session> {
  await delay();
  const account = accounts.get(username.trim().toLowerCase());
  if (!account || account.password !== password) {
    throw new MessagingError('INVALID_CREDENTIALS', 'Invalid username or password.');
  }
  return startSession(account);
}

export async function signOut(token: string): Promise<void> {
  await delay();
  accountFor(token);
  sessions.delete(token);
}

export async function getMyConversation(token: string): Promise<ConversationSummary | null> {
  await delay();
  const account = accountFor(token);
  const house = houseOf(account.username);
  return house ? { inviteCode: house.inviteCode, name: house.name, users: [...house.members].sort() } : null;
}

export async function createConversation(token: string): Promise<string> {
  await delay();
  const account = accountFor(token);
  if (houseOf(account.username)) {
    throw new MessagingError('ALREADY_IN_CONVERSATION', 'User already belongs to a conversation.');
  }
  const inviteCode = generateInviteCode();
  houses.set(inviteCode, {
    inviteCode,
    name: `${account.username}'s household`,
    members: [account.username],
    messages: [],
  });
  return inviteCode;
}

export async function joinConversation(token: string, inviteCode: string): Promise<void> {
  await delay();
  const account = accountFor(token);
  const house = houses.get(inviteCode);
  if (!house) throw new MessagingError('CONVERSATION_NOT_FOUND', 'Conversation not found.');
  if (houseOf(account.username)) {
    throw new MessagingError('ALREADY_IN_CONVERSATION', 'User already belongs to a conversation.');
  }
  house.members.push(account.username);
}

// Returns messages oldest-first, which is the order the screen displays them.
export async function getMessages(token: string, inviteCode: string): Promise<Message[]> {
  await delay();
  return [...memberHouse(accountFor(token), inviteCode).messages];
}

export async function sendMessage(
  token: string,
  inviteCode: string,
  messageText: string,
  attachmentIds: string[] = [],
): Promise<Message> {
  await delay();
  const account = accountFor(token);
  const house = memberHouse(account, inviteCode);

  const text = messageText.trim();
  if (text.length > MAX_MESSAGE_LENGTH || (text.length < 1 && attachmentIds.length === 0)) {
    throw new MessagingError('EMPTY_MESSAGE', `messageText must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
  }
  // Like the server: only your own uploads, and each file can be sent once.
  const attachments = attachmentIds.map((id) => {
    const upload = uploads.get(id);
    if (!upload || upload.owner !== account.username) {
      throw new MessagingError('INVALID_INPUT', 'One or more attachments are missing, unfinished, or already sent.');
    }
    return upload;
  });

  const key = account.username.toLowerCase();
  const now = Date.now();
  const waitMs = COOLDOWN_MS - (now - (lastSentAt.get(key) ?? 0));
  if (waitMs > 0) {
    throw new MessagingError('RATE_LIMITED', 'Please wait before sending another message.', waitMs);
  }

  const message: Message = {
    id: `${now}-${randomId()}`,
    username: account.username,
    messageText: text,
    timestamp: new Date(now).toISOString(),
    attachments: attachments.map(({ owner, ...attachment }) => attachment),
  };
  attachmentIds.forEach((id) => uploads.delete(id));
  house.messages.push(message);
  lastSentAt.set(key, now);
  return message;
}

// Pretends to upload: same checks as the real flow, but nothing is stored.
export async function uploadAttachment(
  token: string,
  inviteCode: string,
  file: PickedFile,
): Promise<UploadedAttachment> {
  await delay();
  const account = accountFor(token);
  memberHouse(account, inviteCode);
  checkAttachment(file);
  await delay();
  const id = randomId();
  uploads.set(id, {
    id,
    owner: account.username,
    fileName: file.name,
    contentType: file.mimeType,
    sizeBytes: file.sizeBytes,
    url: file.uri,
  });
  return { id, fileName: file.name, contentType: file.mimeType, sizeBytes: file.sizeBytes };
}

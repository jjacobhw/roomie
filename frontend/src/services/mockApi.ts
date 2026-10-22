// Fake backend that keeps everything in memory, so the UI can be built before
// the real API exists. Same functions and result shapes the real API will have.
import { Conversation, Message, MessagingError } from "../types/messaging";

const FAKE_NETWORK_DELAY_MS = 250;
const COOLDOWN_MS = 3000; // Sprint 1: the server enforces 3s between messages per sender

const conversations = new Map<string, Conversation>();
const lastSentAt = new Map<string, number>(); // username -> time of last message

// A ready-made chat so "join with code" can be tried straight away. Its owner is
// not one of the hardcoded users, so both of them start out free to create or join.
conversations.set("DEMO12", {
  inviteCode: "DEMO12",
  users: ["Austin ligmarche"],
  messages: [
    {
      id: "seed-1",
      username: "Austin ligmarche",
      messageText: "Welcome to the crib chat!",
      timestamp: new Date().toISOString(),
    },
  ],
});

// Always exactly 6 characters (Math.random().toString(36) can come out shorter), and
// never a code that's already taken.
function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, easy to read aloud
  let code: string;
  do {
    code = Array.from(
      { length: 6 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");
  } while (conversations.has(code));
  return code;
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, FAKE_NETWORK_DELAY_MS));
}

function findConversationOf(username: string): Conversation | undefined {
  return [...conversations.values()].find((c) => c.users.includes(username));
}

function getOrThrow(inviteCode: string): Conversation {
  const conversation = conversations.get(inviteCode);
  if (!conversation) {
    throw new MessagingError(
      "CONVERSATION_NOT_FOUND",
      `No chat with code ${inviteCode}`,
    );
  }
  return conversation;
}

export async function createConversation(username: string): Promise<string> {
  await delay();
  if (findConversationOf(username)) {
    // user is already in a chat, can't create a new one
    throw new MessagingError(
      "ALREADY_IN_CONVERSATION",
      `${username} is already in a chat`,
    );
  }
  const inviteCode = generateInviteCode();
  conversations.set(inviteCode, {
    inviteCode,
    users: [username],
    messages: [],
  });
  return inviteCode;
}

export async function joinConversation(
  username: string,
  inviteCode: string,
): Promise<void> {
  await delay();
  const conversation = getOrThrow(inviteCode);
  if (conversation.users.includes(username)) return; // rejoining your own chat is fine
  if (findConversationOf(username)) {
    throw new MessagingError(
      "ALREADY_IN_CONVERSATION",
      `${username} is already in a chat`,
    );
  }
  conversation.users.push(username);
}

// Returns messages oldest-first, which is the order the screen displays them.
export async function getMessages(inviteCode: string): Promise<Message[]> {
  await delay();
  return [...getOrThrow(inviteCode).messages];
}

export async function sendMessage(
  username: string,
  inviteCode: string,
  messageText: string,
): Promise<Message> {
  await delay();
  const conversation = getOrThrow(inviteCode);

  const text = messageText.trim();
  if (!text) {
    throw new MessagingError("EMPTY_MESSAGE", "Message is empty");
  }

  const now = Date.now();
  const waitMs = COOLDOWN_MS - (now - (lastSentAt.get(username) ?? 0));
  if (waitMs > 0) {
    throw new MessagingError("RATE_LIMITED", "Slow down a little", waitMs);
  }

  const message: Message = {
    id: `${now}-${Math.random().toString(36).substring(2, 6)}`,
    username,
    messageText: text,
    timestamp: new Date(now).toISOString(),
  };
  conversation.messages.push(message);
  lastSentAt.set(username, now);
  return message;
}

export async function leaveConversation(
  username: string,
  inviteCode: string,
): Promise<void> {
  await delay();
  const conversation = getOrThrow(inviteCode);
  conversation.users = conversation.users.filter((u) => u !== username);
  if (conversation.users.length === 0) conversations.delete(inviteCode);
}

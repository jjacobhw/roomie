/**
 * Roomie Texting Module
 * Provides functions to manage user accounts, conversations, and messages in PostgreSQL.
 * All error messages are logged to the console.
 */

import { publicAttachment, type StoredAttachment } from './storage';

export type QueryRow = Record<string, unknown>;

export type QueryResult<T = QueryRow> = {
  rows: T[];
};

export interface PgClient {
  query: <T = QueryRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
}

export interface User {
  id?: string;
  name: string;
  password: string;
  avatarUrl: string;
}

export interface Message {
  id?: string;
  username: string;
  messageText: string;
  attachments: unknown[];
  timestamp: Date | string;
}

export interface Conversation {
  inviteCode: string;
  name?: string;
  messages: Message[];
  users: string[];
}

export interface ConversationSummary {
  inviteCode: string;
  name: string;
  users: string[];
}

export type CreateMessageResult =
  | { status: 'created'; message: Message }
  | { status: 'conversation_not_found' }
  | { status: 'not_member' }
  | { status: 'ambiguous_user' };

const toIsoString = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function normalizeMessage(row: Record<string, unknown>): Message {
  return {
    id: typeof row.id === 'string' ? row.id : undefined,
    username: String(row.username ?? ''),
    messageText: String(row.messageText ?? ''),
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    timestamp: row.timestamp instanceof Date ? row.timestamp : (toIsoString(String(row.timestamp ?? new Date())) ?? new Date()),
  };
}

/**
 * GET /conversations
 * Retrieves a list of conversations for the authenticated user.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param userId The ID of the authenticated user.
 * @returns A promise that resolves to an array of ConversationSummary objects.
 */
export async function getConversations(
  pgClient: PgClient,
  userId: string
): Promise<ConversationSummary[]> {
  const result = await pgClient.query<ConversationSummary>(
    `SELECT h.invite_code AS "inviteCode",
            h.name,
            COALESCE(
              array_agg(u.display_name ORDER BY u.display_name)
                FILTER (WHERE u.id IS NOT NULL),
              ARRAY[]::text[]
            ) AS users
     FROM households h
     LEFT JOIN household_members hm ON hm.household_id = h.id
     LEFT JOIN users u ON u.id = hm.user_id
     WHERE EXISTS (
       SELECT 1
       FROM household_members own_membership
       WHERE own_membership.household_id = h.id AND own_membership.user_id = $1
     )
     GROUP BY h.id, h.invite_code, h.name
     ORDER BY h.created_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    inviteCode: String(row.inviteCode ?? ''),
    name: String(row.name ?? ''),
    users: Array.isArray(row.users) ? row.users.map(String) : [],
  }));
}

/**
 * Create a new message in the specified conversation.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param inviteCode The invite code of the conversation.
 * @param username The username of the sender.
 * @param messageText The contents of the message.
 * @returns A promise resolving to the created message result.
 */
export async function createMessage(
  pgClient: PgClient,
  inviteCode: string,
  username: string,
  messageText: string
): Promise<CreateMessageResult> {
  const memberResult = await pgClient.query<{ id: string }>(
    `SELECT u.id
     FROM households h
     JOIN household_members hm ON hm.household_id = h.id
     JOIN users u ON u.id = hm.user_id
     WHERE h.invite_code = $1 AND u.display_name = $2
     LIMIT 2`,
    [inviteCode, username]
  );

  if (memberResult.rows.length > 1) {
    return { status: 'ambiguous_user' };
  }

  if (memberResult.rows.length === 0) {
    const conversationResult = await pgClient.query<{ id: string }>(
      'SELECT id FROM households WHERE invite_code = $1',
      [inviteCode]
    );
    return conversationResult.rows.length === 0
      ? { status: 'conversation_not_found' }
      : { status: 'not_member' };
  }

  const result = await pgClient.query<{ createdAt: Date }>(
    `INSERT INTO posts (household_id, author_id, body)
     SELECT h.id, $2, $3
     FROM households h
     WHERE h.invite_code = $1
       AND EXISTS (
         SELECT 1
         FROM household_members hm
         WHERE hm.household_id = h.id AND hm.user_id = $2
       )
     RETURNING created_at AS "createdAt"`,
    [inviteCode, memberResult.rows[0].id, messageText]
  );

  if (result.rows.length === 0) {
    return { status: 'not_member' };
  }

  return {
    status: 'created',
    message: {
      username,
      messageText,
      attachments: [],
      timestamp: result.rows[0].createdAt,
    },
  };
}

/**
 * GET /conversations/:inviteCode/messages
 * Retrieves a list of messages for the specified conversation.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param inviteCode The invite code of the conversation.
 * @returns A promise that resolves to a list of Message objects or null if the conversation is not found.
 */
export async function getMessages(
  pgClient: PgClient,
  inviteCode: string
): Promise<Message[] | null> {
  const conversationResult = await pgClient.query<{ id: string }>(
    'SELECT id FROM households WHERE invite_code = $1',
    [inviteCode]
  );
  if (conversationResult.rows.length === 0) {
    return null;
  }

  const result = await pgClient.query<Record<string, unknown>>(
    `SELECT u.display_name AS username,
            p.body AS "messageText",
            COALESCE((
              SELECT json_agg(json_build_object(
                         'id', a.id,
                         'fileName', a.file_name,
                         'contentType', a.content_type,
                         'sizeBytes', a.size_bytes,
                         'objectKey', a.object_key
                     ) ORDER BY a.created_at, a.id)
              FROM attachments a
              WHERE a.post_id = p.id AND a.status = 'complete'
            ), '[]'::json) AS attachments,
            p.created_at AS timestamp
     FROM posts p
     JOIN households h ON h.id = p.household_id
     JOIN users u ON u.id = p.author_id
     WHERE h.invite_code = $1
     ORDER BY p.created_at ASC`,
    [inviteCode]
  );

  // The query returns storage keys; swap them for download URLs before anything leaves the server.
  return Promise.all(
    result.rows.map(async (row) => {
      const message = normalizeMessage(row);
      return {
        ...message,
        attachments: await Promise.all(
          (message.attachments as StoredAttachment[]).map(publicAttachment)
        ),
      };
    })
  );
}

/**
 * POST /users
 * Creates a user account with a username and password and stores it in PostgreSQL.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param username The username of the user to create.
 * @param password The password of the user to create.
 * @returns The created User object.
 */
export async function createAccount(
  pgClient: PgClient,
  username: string,
  password: string
): Promise<User> {
  const avatarUrl = 'https://kommodo.ai/i/zxasnXB2wNYSXfxpIr9N';
  const existing = await pgClient.query<{ id: string }>(
    'SELECT id FROM users WHERE display_name = $1 LIMIT 1',
    [username]
  );

  if (existing.rows.length > 0) {
    throw new Error(`Username ${username} already exists.`);
  }

  const result = await pgClient.query<{ id: string; display_name: string; avatar_url: string }>(
    `INSERT INTO users (display_name, password_hash, avatar_url)
     VALUES ($1, $2, $3)
     RETURNING id, display_name AS "display_name", avatar_url AS "avatar_url"`,
    [username, password, avatarUrl]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.display_name,
    password,
    avatarUrl: row.avatar_url ?? avatarUrl,
  };
}

/**
 * Has no API command.
 * Update the user's username in PostgreSQL.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param oldUsername The current username of the user.
 * @param newUsername The new username to update to.
 * @returns A boolean indicating whether the update was successful.
 */
export async function updateProfileUsername(
  pgClient: PgClient,
  oldUsername: string,
  newUsername: string
): Promise<boolean> {
  const result = await pgClient.query<{ id: string }>(
    'SELECT id FROM users WHERE display_name = $1 LIMIT 1',
    [oldUsername]
  );

  if (result.rows.length === 0) {
    return false;
  }

  await pgClient.query('UPDATE users SET display_name = $1 WHERE display_name = $2', [newUsername, oldUsername]);
  return true;
}

/**
 * Has no API command.
 * Update the user's profile picture (avatar URL) in PostgreSQL.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param username The username of the user.
 * @param avatarUrl The new avatar URL to update to.
 * @returns A boolean indicating whether the update was successful.
 */
export async function updateProfilePic(
  pgClient: PgClient,
  username: string,
  avatarUrl: string
): Promise<boolean> {
  const result = await pgClient.query<{ id: string }>(
    'SELECT id FROM users WHERE display_name = $1 LIMIT 1',
    [username]
  );

  if (result.rows.length === 0) {
    return false;
  }

  await pgClient.query('UPDATE users SET avatar_url = $1 WHERE display_name = $2', [avatarUrl, username]);
  return true;
}

/**
 * DELETE /users/:username
 * Delete the user's account from PostgreSQL.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param username The username of the user to delete.
 * @returns A boolean indicating whether the deletion was successful.
 */
export async function deleteAccount(
  pgClient: PgClient,
  username: string
): Promise<boolean> {
  const result = await pgClient.query<{ id: string }>(
    'SELECT id FROM users WHERE display_name = $1 LIMIT 1',
    [username]
  );

  if (result.rows.length === 0) {
    return false;
  }

  await pgClient.query('DELETE FROM users WHERE id = $1', [result.rows[0].id]);
  return true;
}

/**
 * POST /conversations
 * Initialize a chat room in PostgreSQL associated with the given username
 * and return an invite code to it.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param username The username of the user creating the conversation.
 * @returns A promise that resolves to the invite code of the created conversation or '-1' if an error occurred.
 */
export async function createConversation(
  pgClient: PgClient,
  username: string
): Promise<string> {
  const userResult = await pgClient.query<{ id: string }>(
    'SELECT id FROM users WHERE display_name = $1 LIMIT 1',
    [username]
  );

  if (userResult.rows.length === 0) {
    throw new Error(`User ${username} not found.`);
  }

  const memberResult = await pgClient.query<{ household_id: string }>(
    `SELECT household_id
     FROM household_members
     WHERE user_id = $1
     LIMIT 1`,
    [userResult.rows[0].id]
  );

  if (memberResult.rows.length > 0) {
    const household = await pgClient.query<{ invite_code: string }>(
      'SELECT invite_code FROM households WHERE id = $1 LIMIT 1',
      [memberResult.rows[0].household_id]
    );
    if (household.rows.length > 0) {
      return household.rows[0].invite_code;
    }
  }

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let inviteCode = '';
  for (let i = 0; i < 6; i += 1) {
    inviteCode += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  const householdResult = await pgClient.query<{ id: string }>(
    'INSERT INTO households (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING id',
    ['House chat', inviteCode, userResult.rows[0].id]
  );

  await pgClient.query(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')",
    [householdResult.rows[0].id, userResult.rows[0].id]
  );

  return inviteCode;
}

/**
 * POST /conversations/:inviteCode/members
 * Add user to the conversation in PostgreSQL associated with the given invite code.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param username The username of the user to add to the conversation.
 * @param inviteCode The invite code of the conversation.
 * @returns A boolean indicating whether the user was successfully added to the conversation.
 */
export async function joinConversation(
  pgClient: PgClient,
  username: string,
  inviteCode: string
): Promise<boolean> {
  const userResult = await pgClient.query<{ id: string }>(
    'SELECT id FROM users WHERE display_name = $1 LIMIT 1',
    [username]
  );

  if (userResult.rows.length === 0) {
    return false;
  }

  const household = await pgClient.query<{ id: string }>(
    'SELECT id FROM households WHERE upper(invite_code) = upper($1) LIMIT 1',
    [inviteCode]
  );

  if (household.rows.length === 0) {
    return false;
  }

  const current = await pgClient.query<{ household_id: string }>(
    'SELECT household_id FROM household_members WHERE user_id = $1 LIMIT 1',
    [userResult.rows[0].id]
  );

  if (current.rows.length > 0 && current.rows[0].household_id === household.rows[0].id) {
    return true;
  }

  if (current.rows.length > 0) {
    return false;
  }

  await pgClient.query(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')",
    [household.rows[0].id, userResult.rows[0].id]
  );
  return true;
}

/**
 * Has no API command.
 * Refresh messages in conversation to the user's screen.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param inviteCode The invite code of the conversation.
 * @returns A promise resolving to the conversation object or null if it does not exist.
 */
export async function getConversation(
  pgClient: PgClient,
  inviteCode: string
): Promise<Conversation | null> {
  const household = await pgClient.query<{ id: string; name: string; invite_code: string }>(
    'SELECT id, name, invite_code FROM households WHERE upper(invite_code) = upper($1) LIMIT 1',
    [inviteCode]
  );

  if (household.rows.length === 0) {
    return null;
  }

  const messages = await getMessages(pgClient, household.rows[0].invite_code);
  const members = await pgClient.query<{ display_name: string }>(
    `SELECT u.display_name
     FROM household_members hm
     JOIN users u ON u.id = hm.user_id
     WHERE hm.household_id = $1
     ORDER BY u.display_name`,
    [household.rows[0].id]
  );

  return {
    inviteCode: household.rows[0].invite_code,
    name: household.rows[0].name,
    users: members.rows.map((row) => row.display_name),
    messages: messages ?? [],
  };
}

/**
 * DELETE /conversations/:inviteCode/members
 * Remove a user from the conversation in PostgreSQL associated with the given invite code.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param username The username of the user to remove from the conversation.
 * @param inviteCode The invite code of the conversation.
 * @returns A boolean indicating whether the user was successfully removed from the conversation.
 */
export async function leaveConversation(
  pgClient: PgClient,
  username: string,
  inviteCode: string
): Promise<boolean> {
  const userResult = await pgClient.query<{ id: string }>(
    'SELECT id FROM users WHERE display_name = $1 LIMIT 1',
    [username]
  );

  if (userResult.rows.length === 0) {
    return false;
  }

  const household = await pgClient.query<{ id: string }>(
    'SELECT id FROM households WHERE upper(invite_code) = upper($1) LIMIT 1',
    [inviteCode]
  );

  if (household.rows.length === 0) {
    return false;
  }

  const current = await pgClient.query<{ household_id: string }>(
    'SELECT household_id FROM household_members WHERE user_id = $1 LIMIT 1',
    [userResult.rows[0].id]
  );

  if (current.rows.length === 0 || current.rows[0].household_id !== household.rows[0].id) {
    return false;
  }

  await pgClient.query('DELETE FROM household_members WHERE household_id = $1 AND user_id = $2', [household.rows[0].id, userResult.rows[0].id]);
  return true;
}

/**
 * DELETE /conversations/:inviteCode
 * Delete a conversation from PostgreSQL associated with the given invite code.
 * @param pgClient The PostgreSQL client to use for the query.
 * @param inviteCode The invite code of the conversation to delete.
 * @returns A boolean indicating whether the deletion was successful.
 */
export async function deleteConversation(
  pgClient: PgClient,
  inviteCode: string
): Promise<boolean> {
  const household = await pgClient.query<{ id: string }>(
    'SELECT id FROM households WHERE upper(invite_code) = upper($1) LIMIT 1',
    [inviteCode]
  );

  if (household.rows.length === 0) {
    return false;
  }

  await pgClient.query('DELETE FROM households WHERE id = $1', [household.rows[0].id]);
  return true;
}

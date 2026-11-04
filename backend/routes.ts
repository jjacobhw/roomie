import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';
import type { Pool } from 'pg';
import { getConversations, getMessages } from './texting';
import { publicAttachment, type StoredAttachment } from './storage';
import { registerUploadRoutes } from './uploads';

const SESSION_LIFETIME_DAYS = 30;
const MESSAGE_COOLDOWN_MS = 3000;
const PASSWORD_KEY_LENGTH = 64;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthenticatedRequest extends Request {
  authUser: AuthUser;
  sessionTokenHash: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      sessionTokenHash?: string;
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === '23505';
}

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, saltHex, keyHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) {
    return Promise.resolve(false);
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expectedKey = Buffer.from(keyHex, 'hex');
  if (salt.length !== 16 || expectedKey.length !== PASSWORD_KEY_LENGTH) {
    return Promise.resolve(false);
  }

  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(timingSafeEqual(derivedKey, expectedKey));
    });
  });
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

export function authenticated(
  pool: Pool,
  handler: (request: AuthenticatedRequest, response: Response) => Promise<void>
): RequestHandler {
  return asyncRoute(async (request, response) => {
    const bearer = request.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
    if (!bearer) {
      response.status(401).json({ error: 'A bearer token is required.' });
      return;
    }

    const hashedToken = tokenHash(bearer[1]);
    const result = await pool.query<AuthUser>(
      `SELECT u.id, u.display_name AS username
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashedToken]
    );
    if (result.rows.length === 0) {
      response.status(401).json({ error: 'Session is invalid or expired.' });
      return;
    }

    request.authUser = result.rows[0];
    request.sessionTokenHash = hashedToken;
    await handler(request as AuthenticatedRequest, response);
  });
}

async function createSession(pool: Pool, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 day'))`,
    [userId, tokenHash(token), SESSION_LIFETIME_DAYS]
  );
  return token;
}

async function listUsersInConversation(
  pool: Pool,
  inviteCode: string
): Promise<{ exists: boolean; users: Array<{ username: string; role: string }> }> {
  const result = await pool.query<{ username: string | null; role: string | null }>(
    `SELECT u.display_name AS username, hm.role
     FROM households h
     LEFT JOIN household_members hm ON hm.household_id = h.id
     LEFT JOIN users u ON u.id = hm.user_id
     WHERE h.invite_code = $1
     ORDER BY u.display_name`,
    [inviteCode]
  );

  return {
    exists: result.rows.length > 0,
    users: result.rows.filter(
      (row): row is { username: string; role: string } =>
        row.username !== null && row.role !== null
    ),
  };
}

export async function getConversationAccess(
  pool: Pool,
  inviteCode: string,
  userId: string
): Promise<'member' | 'not_member' | 'not_found'> {
  const result = await pool.query<{ exists: boolean; isMember: boolean }>(
    `SELECT EXISTS (
         SELECT 1
         FROM households h
         WHERE h.invite_code = $1
     ) AS "exists",
     EXISTS (
         SELECT 1
         FROM households h
         JOIN household_members hm ON hm.household_id = h.id
         WHERE h.invite_code = $1 AND hm.user_id = $2
     ) AS "isMember"`,
    [inviteCode, userId]
  );
  const access = result.rows[0];
  if (!access?.exists) {
    return 'not_found';
  }
  return access.isMember ? 'member' : 'not_member';
}

async function leaveConversation(
  pool: Pool,
  inviteCode: string,
  user: AuthUser
): Promise<'left' | 'not_found' | 'not_member'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const householdResult = await client.query<{ id: string; role: string }>(
      `SELECT h.id, hm.role
       FROM households h
       LEFT JOIN household_members hm
         ON hm.household_id = h.id AND hm.user_id = $2
       WHERE h.invite_code = $1
       FOR UPDATE OF h`,
      [inviteCode, user.id]
    );

    if (householdResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return 'not_found';
    }

    const household = householdResult.rows[0];
    if (!household.role) {
      await client.query('ROLLBACK');
      return 'not_member';
    }

    if (household.role === 'owner') {
      const successor = await client.query<{ id: string }>(
        `SELECT user_id AS id
         FROM household_members
         WHERE household_id = $1 AND user_id <> $2
         ORDER BY joined_at, user_id
         LIMIT 1`,
        [household.id, user.id]
      );
      if (successor.rows.length === 0) {
        await client.query('DELETE FROM households WHERE id = $1', [household.id]);
        await client.query('COMMIT');
        return 'left';
      }

      await client.query(
        'UPDATE households SET created_by = $1 WHERE id = $2',
        [successor.rows[0].id, household.id]
      );
      await client.query(
        `UPDATE household_members
         SET role = CASE WHEN user_id = $1 THEN 'owner' ELSE 'member' END
         WHERE household_id = $2`,
        [successor.rows[0].id, household.id]
      );
    }

    await client.query(
      'DELETE FROM household_members WHERE household_id = $1 AND user_id = $2',
      [household.id, user.id]
    );
    await client.query('COMMIT');
    return 'left';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteUserAccount(pool: Pool, user: AuthUser): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ownedHouseholds = await client.query<{ id: string }>(
      'SELECT id FROM households WHERE created_by = $1 FOR UPDATE',
      [user.id]
    );

    for (const household of ownedHouseholds.rows) {
      const successor = await client.query<{ id: string }>(
        `SELECT user_id AS id
         FROM household_members
         WHERE household_id = $1 AND user_id <> $2
         ORDER BY joined_at, user_id
         LIMIT 1`,
        [household.id, user.id]
      );
      if (successor.rows.length === 0) {
        await client.query('DELETE FROM households WHERE id = $1', [household.id]);
      } else {
        await client.query(
          'UPDATE households SET created_by = $1 WHERE id = $2',
          [successor.rows[0].id, household.id]
        );
        await client.query(
          `UPDATE household_members
           SET role = CASE WHEN user_id = $1 THEN 'owner' ELSE 'member' END
           WHERE household_id = $2`,
          [successor.rows[0].id, household.id]
        );
      }
    }

    await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function registerRoutes(app: Express, pool: Pool): void {
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  registerUploadRoutes(app, pool);

  app.post('/users', asyncRoute(async (request, response) => {
    const body: unknown = request.body;
    if (!isRecord(body) || typeof body.username !== 'string' || typeof body.password !== 'string') {
      response.status(400).json({ error: 'username and password must be strings.' });
      return;
    }

    const username = body.username.trim();
    const password = body.password;
    if (username.length < 1 || username.length > 50) {
      response.status(400).json({ error: 'username must be between 1 and 50 characters.' });
      return;
    }
    if (password.length < 8 || password.length > 256) {
      response.status(400).json({ error: 'password must be between 8 and 256 characters.' });
      return;
    }

    try {
      const passwordHash = await hashPassword(password);
      const result = await pool.query<{ id: string; username: string }>(
        `INSERT INTO users (firebase_uid, display_name, password_hash)
         VALUES (NULL, $1, $2)
         RETURNING id, display_name AS username`,
        [username, passwordHash]
      );
      const user = result.rows[0];
      const token = await createSession(pool, user.id);
      response.status(201).json({ user, token });
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: 'Username is already taken.' });
        return;
      }
      throw error;
    }
  }));

  app.post('/sessions', asyncRoute(async (request, response) => {
    const body: unknown = request.body;
    if (!isRecord(body) || typeof body.username !== 'string' || typeof body.password !== 'string') {
      response.status(400).json({ error: 'username and password must be strings.' });
      return;
    }

    const result = await pool.query<{ id: string; username: string; passwordHash: string | null }>(
      `SELECT id, display_name AS username, password_hash AS "passwordHash"
       FROM users
       WHERE lower(display_name) = lower($1)`,
      [body.username.trim()]
    );
    const account = result.rows[0];
    if (!account?.passwordHash || !(await verifyPassword(body.password, account.passwordHash))) {
      response.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    response.json({
      user: { id: account.id, username: account.username },
      token: await createSession(pool, account.id),
    });
  }));

  app.delete('/sessions', authenticated(pool, async (request, response) => {
    await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [request.sessionTokenHash]);
    response.status(204).end();
  }));

  const listConversations: RequestHandler = authenticated(pool, async (_request, response) => {
    response.json({
      conversations: await getConversations(pool, _request.authUser.id),
    });
  });
  app.get(['/convos', '/conversations'], listConversations);

  app.get('/messages/:inviteCode', authenticated(pool, async (request, response) => {
    const inviteCode = routeParam(request, 'inviteCode');
    const access = await getConversationAccess(pool, inviteCode, request.authUser.id);
    if (access !== 'member') {
      response.status(access === 'not_found' ? 404 : 403).json({
        error: access === 'not_found' ? 'Conversation not found.' : 'User is not a member of this conversation.',
      });
      return;
    }

    const messages = await getMessages(pool, inviteCode);
    if (messages === null) {
      response.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    response.json({ messages });
  }));

  app.get('/users', authenticated(pool, async (_request, response) => {
    const result = await pool.query(
      `SELECT id, display_name AS username, avatar_url AS "avatarUrl"
       FROM users ORDER BY display_name`
    );
    response.json({ users: result.rows });
  }));

  const getConversationUsers: RequestHandler = authenticated(pool, async (request, response) => {
    const inviteCode = routeParam(request, 'inviteCode');
    const access = await getConversationAccess(pool, inviteCode, request.authUser.id);
    if (access !== 'member') {
      response.status(access === 'not_found' ? 404 : 403).json({
        error: access === 'not_found' ? 'Conversation not found.' : 'User is not a member of this conversation.',
      });
      return;
    }
    const result = await listUsersInConversation(pool, inviteCode);
    response.json({ users: result.users });
  });
  app.get('/conversations/:inviteCode/users', getConversationUsers);
  app.get('/users/:inviteCode', getConversationUsers);

  app.post('/messages/:inviteCode', authenticated(pool, async (request, response) => {
    const body: unknown = request.body;
    if (!isRecord(body) || typeof body.messageText !== 'string') {
      response.status(400).json({ error: 'messageText must be a string.' });
      return;
    }

    const messageText = body.messageText.trim();

    // Files are uploaded first (see uploads.ts); sending the message claims them by id.
    let attachmentIds: string[] = [];
    if (body.attachmentIds !== undefined) {
      if (
        !Array.isArray(body.attachmentIds)
        || !body.attachmentIds.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))
      ) {
        response.status(400).json({ error: 'attachmentIds must be an array of attachment ids.' });
        return;
      }
      attachmentIds = [...new Set(body.attachmentIds.map((id: string) => id.toLowerCase()))];
      if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        response.status(400).json({
          error: `A message can have at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments.`,
        });
        return;
      }
    }

    // A message needs text, attachments, or both.
    if (messageText.length > 2000 || (messageText.length < 1 && attachmentIds.length === 0)) {
      response.status(400).json({
        error: attachmentIds.length > 0
          ? 'messageText must be at most 2000 characters.'
          : 'messageText must be between 1 and 2000 characters.',
      });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [request.authUser.id]
      );
      const cooldown = await client.query<{ retryAfterMs: number }>(
        `SELECT GREATEST(
                  0,
                  ceil(extract(epoch FROM (created_at + interval '3 seconds' - now())) * 1000)
                ) AS "retryAfterMs"
         FROM posts
         WHERE author_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [request.authUser.id]
      );
      const retryAfterMs = Number(cooldown.rows[0]?.retryAfterMs ?? 0);
      if (retryAfterMs > 0) {
        await client.query('ROLLBACK');
        response.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
        response.status(429).json({ error: 'Please wait before sending another message.' });
        return;
      }

      const result = await client.query<{ id: string; messageText: string; timestamp: Date }>(
        `INSERT INTO posts (household_id, author_id, body)
         SELECT h.id, u.id, $3
         FROM households h
         JOIN household_members hm ON hm.household_id = h.id
         JOIN users u ON u.id = hm.user_id
         WHERE h.invite_code = $1 AND u.id = $2
         RETURNING id, body AS "messageText", created_at AS timestamp`,
        [routeParam(request, 'inviteCode'), request.authUser.id, messageText]
      );

      if (result.rows.length === 0) {
        const household = await client.query(
          'SELECT id FROM households WHERE invite_code = $1',
          [routeParam(request, 'inviteCode')]
        );
        await client.query('ROLLBACK');
        response.status(household.rows.length === 0 ? 404 : 403).json({
          error: household.rows.length === 0
            ? 'Conversation not found.'
            : 'User is not a member of this conversation.',
        });
        return;
      }

      const { id: postId, ...message } = result.rows[0];
      let attachments: StoredAttachment[] = [];
      if (attachmentIds.length > 0) {
        // Only your own finished uploads in this household that no other message has used.
        const claimed = await client.query<StoredAttachment>(
          `UPDATE attachments a
           SET post_id = p.id
           FROM posts p
           WHERE p.id = $1
             AND a.id = ANY($2::uuid[])
             AND a.uploader_id = $3
             AND a.household_id = p.household_id
             AND a.status = 'complete'
             AND a.post_id IS NULL
           RETURNING a.id,
                     a.file_name AS "fileName",
                     a.content_type AS "contentType",
                     a.size_bytes AS "sizeBytes",
                     a.object_key AS "objectKey"`,
          [postId, attachmentIds, request.authUser.id]
        );
        if (claimed.rows.length !== attachmentIds.length) {
          await client.query('ROLLBACK');
          response.status(400).json({
            error: 'One or more attachments are missing, unfinished, or already sent.',
          });
          return;
        }
        attachments = attachmentIds.map(
          (id) => claimed.rows.find((row) => row.id === id) as StoredAttachment
        );
      }

      await client.query('COMMIT');
      response.status(201).json({
        message: {
          ...message,
          username: request.authUser.username,
          attachments: await Promise.all(attachments.map(publicAttachment)),
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.post('/conversations', authenticated(pool, async (request, response) => {
    const body: unknown = request.body;
    if (body !== undefined && !isRecord(body)) {
      response.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    if (isRecord(body) && body.name !== undefined && typeof body.name !== 'string') {
      response.status(400).json({ error: 'name must be a string.' });
      return;
    }

    const name = isRecord(body) && typeof body.name === 'string'
      ? body.name.trim()
      : `${request.authUser.username}'s household`;
    if (name.length < 1 || name.length > 80) {
      response.status(400).json({ error: 'name must be between 1 and 80 characters.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existingMembership = await client.query(
        'SELECT 1 FROM household_members WHERE user_id = $1',
        [request.authUser.id]
      );
      if (existingMembership.rows.length > 0) {
        await client.query('ROLLBACK');
        response.status(409).json({ error: 'User already belongs to a conversation.' });
        return;
      }

      let conversation: { inviteCode: string; name: string };
      for (;;) {
        const inviteCode = randomBytes(3).toString('hex').toUpperCase();
        try {
          const result = await client.query<{ inviteCode: string; name: string }>(
            `INSERT INTO households (name, invite_code, created_by)
             VALUES ($1, $2, $3)
             RETURNING invite_code AS "inviteCode", name`,
            [name, inviteCode, request.authUser.id]
          );
          conversation = result.rows[0];
          break;
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
          await client.query('ROLLBACK');
          await client.query('BEGIN');
        }
      }
      await client.query(
        `INSERT INTO household_members (household_id, user_id, role)
         SELECT id, $2, 'owner' FROM households WHERE invite_code = $1`,
        [conversation.inviteCode, request.authUser.id]
      );
      await client.query('COMMIT');
      response.status(201).json({ conversation });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  const joinConversation: RequestHandler = authenticated(pool, async (request, response) => {
    const body: unknown = request.body;
    const routeUsername = routeParam(request, 'username');
    if (routeUsername && routeUsername.toLowerCase() !== request.authUser.username.toLowerCase()) {
      response.status(403).json({ error: 'You can only add your signed-in account.' });
      return;
    }
    if (isRecord(body) && typeof body.username === 'string'
        && body.username.trim().toLowerCase() !== request.authUser.username.toLowerCase()) {
      response.status(403).json({ error: 'You can only add your signed-in account.' });
      return;
    }

    const household = await pool.query<{ id: string }>(
      'SELECT id FROM households WHERE invite_code = $1',
      [routeParam(request, 'inviteCode')]
    );
    if (household.rows.length === 0) {
      response.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    try {
      await pool.query(
        `INSERT INTO household_members (household_id, user_id, role)
         VALUES ($1, $2, 'member')`,
        [household.rows[0].id, request.authUser.id]
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: 'User already belongs to a conversation.' });
        return;
      }
      throw error;
    }
    response.status(201).json({ joined: true, inviteCode: routeParam(request, 'inviteCode') });
  });
  app.post('/conversations/:inviteCode/members', joinConversation);
  app.post('/users/:username/:inviteCode', joinConversation);

  const deleteConversation: RequestHandler = authenticated(pool, async (request, response) => {
    const result = await pool.query(
      `DELETE FROM households
       WHERE invite_code = $1 AND created_by = $2
       RETURNING id`,
      [routeParam(request, 'inviteCode'), request.authUser.id]
    );
    if (result.rows.length > 0) {
      response.status(204).end();
      return;
    }

    const exists = await pool.query(
      'SELECT id FROM households WHERE invite_code = $1',
      [routeParam(request, 'inviteCode')]
    );
    response.status(exists.rows.length === 0 ? 404 : 403).json({
      error: exists.rows.length === 0 ? 'Conversation not found.' : 'Only the owner can delete this conversation.',
    });
  });
  app.delete('/conversations/:inviteCode', deleteConversation);

  const removeConversationMember: RequestHandler = authenticated(pool, async (request, response) => {
    const routeUsername = routeParam(request, 'username');
    const targetUsername = routeUsername || request.authUser.username;
    if (targetUsername.toLowerCase() !== request.authUser.username.toLowerCase()) {
      response.status(403).json({ error: 'You can only remove your signed-in account.' });
      return;
    }

    const result = await leaveConversation(pool, routeParam(request, 'inviteCode'), request.authUser);
    if (result === 'not_found') {
      response.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    if (result === 'not_member') {
      response.status(409).json({ error: 'User is not a member of this conversation.' });
      return;
    }
    response.status(204).end();
  });
  app.delete('/conversations/:inviteCode/members', removeConversationMember);
  app.delete('/conversations/:inviteCode/members/:username', removeConversationMember);
  app.delete('/users/:username/:inviteCode', removeConversationMember);

  app.delete('/users/:username', authenticated(pool, async (request, response) => {
    if (routeParam(request, 'username').toLowerCase() !== request.authUser.username.toLowerCase()) {
      response.status(403).json({ error: 'You can only delete your signed-in account.' });
      return;
    }
    await deleteUserAccount(pool, request.authUser);
    response.status(204).end();
  }));

  registerChoreRoutes(app, pool);
}

const MAX_TITLE_LENGTH = 80;
const MAX_ITEM_LENGTH = 200;
const ITEM_ID_PATTERN = /^\d{1,18}$/;

export interface ChoreItem {
  id: string;
  text: string;
  isDone: boolean;
  doneBy: string | null;
  doneAt: string | null;
  createdAt: string;
}

export interface ChoreList {
  id: string;
  title: string;
  assignee: string | null;
  createdBy: string | null;
  createdAt: string;
  items: ChoreItem[];
}

const ITEM_COLUMNS = `
  ci.id::text AS id,
  ci.body AS text,
  ci.is_done AS "isDone",
  done_user.display_name AS "doneBy",
  ci.done_at AS "doneAt",
  ci.created_at AS "createdAt"`;

function toItem(row: Record<string, unknown>): ChoreItem {
  return {
    id: String(row.id),
    text: String(row.text),
    isDone: Boolean(row.isDone),
    doneBy: (row.doneBy as string | null) ?? null,
    doneAt: row.doneAt ? (row.doneAt as Date).toISOString() : null,
    createdAt: (row.createdAt as Date).toISOString(),
  };
}

function sendAccessError(
  response: Response,
  access: 'not_found' | 'not_member' | 'member'
): boolean {
  if (access === 'not_found') {
    response.status(404).json({ error: 'Conversation not found.' });
    return true;
  }
  if (access === 'not_member') {
    response.status(403).json({ error: 'User is not a member of this conversation.' });
    return true;
  }
  return false;
}

async function listAccess(pool: Pool, listId: string, userId: string) {
  if (!UUID_PATTERN.test(listId)) return 'not_found' as const;
  const result = await pool.query<{ isMember: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM household_members hm
       WHERE hm.household_id = cl.household_id AND hm.user_id = $2
     ) AS "isMember"
     FROM chore_lists cl WHERE cl.id = $1`,
    [listId, userId]
  );
  if (result.rows.length === 0) return 'not_found' as const;
  return result.rows[0].isMember ? ('member' as const) : ('not_member' as const);
}

async function itemAccess(pool: Pool, itemId: string, userId: string) {
  if (!ITEM_ID_PATTERN.test(itemId)) return 'not_found' as const;
  const result = await pool.query<{ isMember: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM household_members hm
       WHERE hm.household_id = cl.household_id AND hm.user_id = $2
     ) AS "isMember"
     FROM chore_items ci JOIN chore_lists cl ON cl.id = ci.list_id
     WHERE ci.id = $1`,
    [itemId, userId]
  );
  if (result.rows.length === 0) return 'not_found' as const;
  return result.rows[0].isMember ? ('member' as const) : ('not_member' as const);
}

function notFound(response: Response, what: string): void {
  response.status(404).json({ error: `${what} not found.` });
}

function forbidden(response: Response): void {
  response.status(403).json({ error: 'User is not a member of this conversation.' });
}

function registerChoreRoutes(app: Express, pool: Pool): void {
  app.get('/conversations/:inviteCode/chores', authenticated(pool, async (request, response) => {
    const inviteCode = routeParam(request, 'inviteCode');
    if (sendAccessError(response, await getConversationAccess(pool, inviteCode, request.authUser.id))) return;

    const lists = await pool.query(
      `SELECT cl.id, cl.title, assignee.display_name AS assignee,
              creator.display_name AS "createdBy", cl.created_at AS "createdAt"
       FROM chore_lists cl
       JOIN households h ON h.id = cl.household_id
       LEFT JOIN users assignee ON assignee.id = cl.assigned_to
       LEFT JOIN users creator ON creator.id = cl.created_by
       WHERE h.invite_code = $1
       ORDER BY cl.created_at, cl.id`,
      [inviteCode]
    );
    const items = await pool.query(
      `SELECT ci.list_id AS "listId", ${ITEM_COLUMNS}
       FROM chore_items ci
       JOIN chore_lists cl ON cl.id = ci.list_id
       JOIN households h ON h.id = cl.household_id
       LEFT JOIN users done_user ON done_user.id = ci.done_by
       WHERE h.invite_code = $1
       ORDER BY ci.created_at, ci.id`,
      [inviteCode]
    );

    const byList = new Map<string, ChoreItem[]>();
    for (const row of items.rows) {
      const listItems = byList.get(row.listId) ?? [];
      listItems.push(toItem(row));
      byList.set(row.listId, listItems);
    }
    const choreLists: ChoreList[] = lists.rows.map((row) => ({
      id: row.id,
      title: row.title,
      assignee: row.assignee,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      items: byList.get(row.id) ?? [],
    }));
    response.json({ choreLists });
  }));

  app.post('/conversations/:inviteCode/chores', authenticated(pool, async (request, response) => {
    const inviteCode = routeParam(request, 'inviteCode');
    if (sendAccessError(response, await getConversationAccess(pool, inviteCode, request.authUser.id))) return;

    const body: unknown = request.body ?? {};
    if (!isRecord(body)) {
      response.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      response.status(400).json({ error: 'title must be a string.' });
      return;
    }
    if (body.assignee !== undefined && body.assignee !== null && typeof body.assignee !== 'string') {
      response.status(400).json({ error: 'assignee must be a username or null.' });
      return;
    }

    let assigneeId: string | null = request.authUser.id;
    let assigneeName: string | null = request.authUser.username;
    if (body.assignee === null) {
      assigneeId = null;
      assigneeName = null;
    } else if (typeof body.assignee === 'string') {
      const member = await pool.query<{ id: string; username: string }>(
        `SELECT u.id, u.display_name AS username
         FROM households h
         JOIN household_members hm ON hm.household_id = h.id
         JOIN users u ON u.id = hm.user_id
         WHERE h.invite_code = $1 AND lower(u.display_name) = lower($2)`,
        [inviteCode, body.assignee.trim()]
      );
      if (member.rows.length === 0) {
        response.status(400).json({ error: 'assignee is not a member of this conversation.' });
        return;
      }
      assigneeId = member.rows[0].id;
      assigneeName = member.rows[0].username;
    }

    const title = typeof body.title === 'string' && body.title.trim()
      ? body.title.trim()
      : assigneeName ? `${assigneeName}'s chores` : 'House chores';
    if (title.length > MAX_TITLE_LENGTH) {
      response.status(400).json({ error: `title must be at most ${MAX_TITLE_LENGTH} characters.` });
      return;
    }

    const result = await pool.query<{ id: string; createdAt: Date }>(
      `INSERT INTO chore_lists (household_id, title, assigned_to, created_by)
       SELECT id, $2, $3, $4 FROM households WHERE invite_code = $1
       RETURNING id, created_at AS "createdAt"`,
      [inviteCode, title, assigneeId, request.authUser.id]
    );
    const choreList: ChoreList = {
      id: result.rows[0].id,
      title,
      assignee: assigneeName,
      createdBy: request.authUser.username,
      createdAt: result.rows[0].createdAt.toISOString(),
      items: [],
    };
    response.status(201).json({ choreList });
  }));

  app.delete('/chores/:listId', authenticated(pool, async (request, response) => {
    const listId = routeParam(request, 'listId');
    const access = await listAccess(pool, listId, request.authUser.id);
    if (access === 'not_found') return notFound(response, 'Chore list');
    if (access === 'not_member') return forbidden(response);

    await pool.query('DELETE FROM chore_lists WHERE id = $1', [listId]);
    response.status(204).end();
  }));

  app.post('/chores/:listId/items', authenticated(pool, async (request, response) => {
    const listId = routeParam(request, 'listId');
    const access = await listAccess(pool, listId, request.authUser.id);
    if (access === 'not_found') return notFound(response, 'Chore list');
    if (access === 'not_member') return forbidden(response);

    const body: unknown = request.body;
    const text = isRecord(body) && typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 1 || text.length > MAX_ITEM_LENGTH) {
      response.status(400).json({ error: `text must be between 1 and ${MAX_ITEM_LENGTH} characters.` });
      return;
    }

    const result = await pool.query(
      `INSERT INTO chore_items (list_id, body, created_by)
       VALUES ($1, $2, $3)
       RETURNING id::text AS id, body AS text, is_done AS "isDone",
                 NULL::text AS "doneBy", done_at AS "doneAt", created_at AS "createdAt"`,
      [listId, text, request.authUser.id]
    );
    response.status(201).json({ item: toItem(result.rows[0]) });
  }));

  app.patch('/chores/items/:itemId', authenticated(pool, async (request, response) => {
    const itemId = routeParam(request, 'itemId');
    const body: unknown = request.body;
    if (!isRecord(body) || typeof body.isDone !== 'boolean') {
      response.status(400).json({ error: 'isDone must be true or false.' });
      return;
    }

    const access = await itemAccess(pool, itemId, request.authUser.id);
    if (access === 'not_found') return notFound(response, 'Chore item');
    if (access === 'not_member') return forbidden(response);

    const result = await pool.query(
      `WITH updated AS (
         UPDATE chore_items
         SET is_done = $2,
             done_by = CASE WHEN $2 THEN $3::uuid END,
             done_at = CASE WHEN $2 THEN now() END
         WHERE id = $1
         RETURNING *
       )
       SELECT ${ITEM_COLUMNS.replaceAll('ci.', 'updated.')}
       FROM updated
       LEFT JOIN users done_user ON done_user.id = updated.done_by`,
      [itemId, body.isDone, request.authUser.id]
    );
    response.json({ item: toItem(result.rows[0]) });
  }));

  app.delete('/chores/items/:itemId', authenticated(pool, async (request: AuthenticatedRequest, response) => {
    const itemId = routeParam(request, 'itemId');
    const access = await itemAccess(pool, itemId, request.authUser.id);
    if (access === 'not_found') return notFound(response, 'Chore item');
    if (access === 'not_member') return forbidden(response);

    await pool.query('DELETE FROM chore_items WHERE id = $1', [itemId]);
    response.status(204).end();
  }));
}

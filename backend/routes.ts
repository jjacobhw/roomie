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

const SESSION_LIFETIME_DAYS = 30;
const MESSAGE_COOLDOWN_MS = 3000;
const PASSWORD_KEY_LENGTH = 64;

interface AuthUser {
  id: string;
  username: string;
}

interface AuthenticatedRequest extends Request {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function routeParam(request: Request, name: string): string {
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

function authenticated(
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

async function getConversationAccess(
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
    if (messageText.length < 1 || messageText.length > 2000) {
      response.status(400).json({ error: 'messageText must be between 1 and 2000 characters.' });
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

      const result = await client.query<{ messageText: string; timestamp: Date }>(
        `INSERT INTO posts (household_id, author_id, body)
         SELECT h.id, u.id, $3
         FROM households h
         JOIN household_members hm ON hm.household_id = h.id
         JOIN users u ON u.id = hm.user_id
         WHERE h.invite_code = $1 AND u.id = $2
         RETURNING body AS "messageText", created_at AS timestamp`,
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

      await client.query('COMMIT');
      response.status(201).json({
        message: {
          ...result.rows[0],
          username: request.authUser.username,
          attachments: [],
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
}

import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { registerRoutes, tokenHash } = await import('../backend/routes.ts');
const express = require('express');

export const INVITE_CODE = 'BEACH1';
export const users = {
  owner: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'olivia', token: 'olivia-session' },
  roommate: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'max', token: 'max-session' },
  outsider: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'otto', token: 'otto-session' },
};

function createDatabase({ signedIn = users.owner, failUpdate = false } = {}) {
  const accounts = new Map(
    Object.values(users).map(({ id, username }) => [id, { id, username }]),
  );
  const sessionByHash = new Map(
    Object.values(users).map(({ id, token }) => [tokenHash(token), id]),
  );
  const state = {
    accounts,
    sessionByHash,
    messages: [{ id: '1', authorId: users.owner.id, messageText: 'A message from Olivia' }],
    household: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', inviteCode: INVITE_CODE, name: 'Beach House' },
    members: [users.owner.id, users.roommate.id],
    updateCount: 0,
    sessionWriteCount: 0,
    activeUserId: signedIn?.id ?? null,
    failUpdate,
  };

  const query = async (sql, params = []) => {
    const text = sql.trim();

    if (/FROM user_sessions/i.test(text)) {
      const userId = state.sessionByHash.get(params[0]);
      state.activeUserId = userId ?? null;
      const account = userId ? accounts.get(userId) : undefined;
      return account
        ? { rows: [{ id: account.id, username: account.username }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (/^(INSERT INTO|DELETE FROM)\s+user_sessions/i.test(text)) {
      state.sessionWriteCount++;
      return { rows: [], rowCount: 1 };
    }

    if (/AS "exists"/.test(text)) {
      const [inviteCode, userId] = params;
      const exists = inviteCode === state.household.inviteCode;
      return { rows: [{ exists, isMember: exists && state.members.includes(userId) }], rowCount: 1 };
    }

    if (/FROM households h\s+LEFT JOIN household_members/i.test(text)) {
      if (params[0] !== state.household.inviteCode) return { rows: [], rowCount: 0 };
      return {
        rows: state.members.map((id) => ({
          id,
          username: accounts.get(id).username,
          role: id === users.owner.id ? 'owner' : 'member',
        })),
        rowCount: state.members.length,
      };
    }

    if (/^SELECT id FROM households WHERE invite_code/i.test(text)) {
      return params[0] === state.household.inviteCode
        ? { rows: [{ id: state.household.id }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (/FROM posts p\s+JOIN households h/i.test(text) && /JOIN users u ON u\.id = p\.author_id/i.test(text)) {
      if (params[0] !== state.household.inviteCode) return { rows: [], rowCount: 0 };
      return {
        rows: state.messages.map((message) => ({
          ...message,
          username: accounts.get(message.authorId).username,
          isAlert: false,
          seenBy: [],
          attachments: [],
          timestamp: new Date('2026-11-01T12:00:00.000Z'),
        })),
        rowCount: state.messages.length,
      };
    }

    if (/^SELECT\b/i.test(text) && /FROM users\b/i.test(text) && /lower\(display_name\)/i.test(text)) {
      const username = String(params.find((value) => typeof value === 'string') ?? '');
      const matching = [...accounts.values()]
        .filter((account) => account.username.toLowerCase() === username.trim().toLowerCase())
        .map((account) => ({ id: account.id, username: account.username }));
      return { rows: matching, rowCount: matching.length };
    }

    if (/^UPDATE users\b/i.test(text) && /display_name/i.test(text)) {
      if (state.failUpdate) throw new Error('injected database failure');
      const idPlaceholder = text.match(/WHERE\s+(?:u\.)?id\s*=\s*\$(\d+)/i)?.[1];
      const namePlaceholder = text.match(/SET\s+(?:u\.)?display_name\s*=\s*\$(\d+)/i)?.[1];
      if (!idPlaceholder || !namePlaceholder) throw new Error(`Unexpected username update: ${text}`);

      const id = params[Number(idPlaceholder) - 1];
      const username = params[Number(namePlaceholder) - 1];
      if (id !== state.activeUserId || !accounts.has(id)) return { rows: [], rowCount: 0 };
      if ([...accounts.values()].some(
        (account) => account.id !== id && account.username.toLowerCase() === String(username).toLowerCase(),
      )) {
        const error = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        throw error;
      }

      accounts.get(id).username = username;
      state.updateCount++;
      return { rows: [{ id, username }], rowCount: 1 };
    }

    throw new Error(`Unexpected query in username-change test: ${text}`);
  };

  return { state, pool: { query, async connect() { return { query, release() {} }; } } };
}

export async function withUsernameApi(run, scenario = {}) {
  const db = createDatabase(scenario);
  const app = express();
  app.use(express.json());
  registerRoutes(app, db.pool);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { token = users.owner.token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const bodyData = text && response.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(text)
      : null;
    return { status: response.status, body: bodyData };
  }

  try {
    await run({ state: db.state, call });
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

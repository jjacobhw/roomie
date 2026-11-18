// Test helpers for the alert banner tests (US-3-T-7).
// Runs the real backend routes against a small fake pg pool that keeps posts and alert_seen in memory,
// so no database is needed. The fake answers by matching the SQL the routes send; an unknown query throws.
import { once } from 'node:events';
import { createRequire, register } from 'node:module';

// The backend's own imports leave off ".ts" (tsc and tsx allow that, plain Node doesn't).
// This hook adds the extension so `node --experimental-strip-types --test` can load them.
register(
  'data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try {
        return await next(specifier, context);
      } catch (error) {
        const fromTs = context.parentURL && context.parentURL.endsWith('.ts');
        if (fromTs && /^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) {
          return next(specifier + '.ts', context);
        }
        throw error;
      }
    }
  `)
);

const { registerRoutes } = await import('../backend/routes.ts');

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');

export const INVITE_CODE = 'BEACH1';

export const users = {
  poster: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'olivia' },
  roommate: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'max' },
  outsider: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'otto' },
};
const nameOf = (id) => Object.values(users).find((u) => u.id === id).username;

// scenario.signedIn: the user making requests, or null for an invalid session.
export async function withAlertApi(run, scenario = {}) {
  let { signedIn = users.poster } = scenario;
  const members = new Set([users.poster.id, users.roommate.id]);
  const store = {
    posts: [], // { id, authorId, body, isAlert, createdAt }
    seen: [], // { postId, userId, seenAt }
  };
  let nextPostId = 1;
  let clock = 0; // strictly increasing, so "order seen" is deterministic

  const seenNames = (postId) =>
    store.seen
      .filter((s) => s.postId === postId)
      .sort((a, b) => a.seenAt - b.seenAt)
      .map((s) => nameOf(s.userId));

  const query = async (sql, params = []) => {
    if (/FROM user_sessions/i.test(sql)) {
      return signedIn ? { rows: [signedIn], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim()) || /pg_advisory_xact_lock/.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/AS "retryAfterMs"/.test(sql)) return { rows: [], rowCount: 0 }; // no recent message
    if (/AS "exists"/.test(sql)) {
      const [inviteCode, userId] = params;
      const exists = inviteCode === INVITE_CODE;
      return { rows: [{ exists, isMember: exists && members.has(userId) }], rowCount: 1 };
    }
    if (/^SELECT id FROM households WHERE invite_code/i.test(sql.trim())) {
      return params[0] === INVITE_CODE ? { rows: [{ id: 'household-1' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/INSERT INTO posts/i.test(sql)) {
      const [inviteCode, userId, body, isAlert] = params;
      if (inviteCode !== INVITE_CODE || !members.has(userId)) return { rows: [], rowCount: 0 };
      const post = { id: nextPostId++, authorId: userId, body, isAlert: Boolean(isAlert), createdAt: new Date(Date.UTC(2026, 10, 1, 12, 0, store.posts.length)) };
      store.posts.push(post);
      return { rows: [{ id: String(post.id), messageText: body, timestamp: post.createdAt }], rowCount: 1 };
    }
    if (/INSERT INTO alert_seen/i.test(sql)) {
      const [postId, userId] = params.map((p, i) => (i === 0 ? Number(p) : p));
      const duplicate = store.seen.some((s) => s.postId === postId && s.userId === userId);
      if (duplicate && !/ON CONFLICT DO NOTHING/i.test(sql)) throw new Error('duplicate key value violates unique constraint');
      if (!duplicate) store.seen.push({ postId, userId, seenAt: clock++ });
      return { rows: [], rowCount: duplicate ? 0 : 1 };
    }
    // POST /alerts/:id/seen: is this an alert, and is the caller in its household?
    if (/AS "isMember"/.test(sql) && /p\.is_alert/.test(sql)) {
      const post = store.posts.find((p) => p.id === Number(params[0]) && p.isAlert);
      return post
        ? { rows: [{ isMember: members.has(params[1]) }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/FROM alert_seen s\s+JOIN users u/.test(sql)) {
      return { rows: seenNames(Number(params[0])).map((username) => ({ username })), rowCount: 1 };
    }
    // GET /messages/:inviteCode
    if (/p\.is_alert AS "isAlert"/.test(sql) && /FROM posts p/.test(sql)) {
      const rows = store.posts.map((p) => ({
        id: String(p.id),
        username: nameOf(p.authorId),
        messageText: p.body,
        isAlert: p.isAlert,
        seenBy: seenNames(p.id),
        attachments: [],
        timestamp: p.createdAt,
      }));
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Unexpected query in test: ${sql}`);
  };
  const pool = { query, async connect() { return { query, release() {} }; } };

  const app = express();
  app.use(express.json());
  registerRoutes(app, pool);
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  async function call(method, path, body) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  const api = {
    store,
    // Switch which user the following requests are made as.
    signInAs(user) { signedIn = user; },
    // Pretend another household member already did something: add a seen row directly.
    markSeenDirectly(postId, userId) { store.seen.push({ postId, userId, seenAt: clock++ }); },
    send: (body, inviteCode = INVITE_CODE) => call('POST', `/messages/${inviteCode}`, body),
    acknowledge: (alertId) => call('POST', `/alerts/${alertId}/seen`),
    list: (inviteCode = INVITE_CODE) => call('GET', `/messages/${inviteCode}`),
  };

  try {
    await run(api);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

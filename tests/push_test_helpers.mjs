// Test helpers for the chore push notification tests (US-3-T-8).
// Runs the real chore routes against a fake pg pool and a fake Expo push service,
// so no database or network is needed.
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

const { registerChoreRoutes } = await import('../backend/chores.ts');

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
export const INVITE_CODE = 'BEACH1';
export const NEW_LIST_ID = '11111111-1111-4111-8111-111111111111';
export const FIXED_DATE = new Date('2026-11-17T12:00:00.000Z');

export const users = {
  alice: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'alice' },
  bob: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'bob' },
  cara: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'cara' },
};

export const tokenFor = (user, phone = 1) => `ExponentPushToken[${user.username}${phone}]`;

// Every member has one phone unless a test says otherwise.
function defaultTokens() {
  return Object.values(users).map((user) => ({ token: tokenFor(user), userId: user.id }));
}

// scenario:
//   signedIn: user making the request
//   lists:    existing chore lists [{ id, title, assignedTo }]
//   tokens:   stored push tokens [{ token, userId }]
//   expo:     async (messages) => Response, the fake Expo push service
//   failTokenLookup: make the push_tokens query throw
export async function withChoreApi(run, scenario = {}) {
  const {
    signedIn = users.alice,
    lists = [],
    tokens = defaultTokens(),
    expo = async (messages) => Response.json({ data: messages.map(() => ({ status: 'ok' })) }),
    failTokenLookup = false,
  } = scenario;

  const members = Object.values(users);
  const storedTokens = tokens.map((row) => ({ ...row }));
  const storedLists = lists.map((list) => ({ ...list }));
  const queries = [];
  const expoRequests = [];

  const query = async (sql, params = []) => {
    queries.push([sql, params]);
    if (/FROM user_sessions/i.test(sql)) {
      return { rows: [signedIn], rowCount: 1 };
    }
    if (/AS "exists"/.test(sql)) {
      return { rows: [{ exists: true, isMember: true }], rowCount: 1 };
    }
    if (/lower\(u\.display_name\) = lower\(\$2\)/.test(sql)) {
      const member = members.find((m) => m.username.toLowerCase() === String(params[1]).toLowerCase());
      return { rows: member ? [member] : [], rowCount: member ? 1 : 0 };
    }
    if (/INSERT INTO chore_lists/i.test(sql)) {
      storedLists.push({ id: NEW_LIST_ID, title: params[1], assignedTo: params[2] });
      return { rows: [{ id: NEW_LIST_ID, createdAt: FIXED_DATE }], rowCount: 1 };
    }
    if (/AS "isMember"\s+FROM chore_lists/i.test(sql)) {
      const found = storedLists.find((list) => list.id === params[0]);
      return { rows: found ? [{ isMember: true, assignedTo: found.assignedTo }] : [], rowCount: found ? 1 : 0 };
    }
    if (/FROM chore_items ci JOIN chore_lists cl/i.test(sql)) {
      const itemId = String(params[0]);
      const itemListId = itemId === '42' ? NEW_LIST_ID : null;
      const found = storedLists.find((list) => list.id === itemListId);
      return { rows: found ? [{ isMember: true, assignedTo: found.assignedTo }] : [], rowCount: found ? 1 : 0 };
    }
    if (/INSERT INTO chore_items/i.test(sql)) {
      const row = { id: '42', text: params[1], isDone: false, doneBy: null, doneAt: null, createdAt: FIXED_DATE };
      return { rows: [row], rowCount: 1 };
    }
    if (/FROM chore_lists WHERE id = \$1/i.test(sql)) {
      const list = storedLists.find((l) => l.id === params[0]);
      const rows = list ? [{ title: list.title, householdId: HOUSEHOLD_ID, assignedTo: list.assignedTo }] : [];
      return { rows, rowCount: rows.length };
    }
    if (/FROM household_members\s+WHERE household_id = \$1 AND user_id <> \$2/i.test(sql)) {
      const rows = members.filter((m) => m.id !== params[1]).map((m) => ({ userId: m.id }));
      return { rows, rowCount: rows.length };
    }
    if (/SELECT token FROM push_tokens/i.test(sql)) {
      if (failTokenLookup) throw new Error('database is down');
      const rows = storedTokens.filter((row) => params[0].includes(row.userId)).map(({ token }) => ({ token }));
      return { rows, rowCount: rows.length };
    }
    if (/DELETE FROM push_tokens/i.test(sql)) {
      const dead = params[0];
      for (let i = storedTokens.length - 1; i >= 0; i -= 1) {
        if (dead.includes(storedTokens[i].token)) storedTokens.splice(i, 1);
      }
      return { rows: [], rowCount: dead.length };
    }
    throw new Error(`Unexpected query in test: ${sql}`);
  };
  const pool = { query, async connect() { return { query, release() {} }; } };

  // Calls to Expo go to the fake; everything else (the test's own requests) goes through.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === EXPO_PUSH_URL) {
      const messages = JSON.parse(init.body);
      expoRequests.push({ headers: init.headers, messages });
      return expo(messages);
    }
    return realFetch(url, init);
  };

  // The notification code logs failures on purpose; keep test output readable.
  const realError = console.error;
  console.error = () => {};

  const app = express();
  app.use(express.json());
  registerChoreRoutes(app, pool);
  const server = app.listen(0);
  await once(server, 'listening');

  const { port } = server.address();
  const api = {
    async post(path, body) {
      const response = await realFetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    // Notifications are sent after the response, so wait until the queries stop.
    async settle() {
      let seen = -1;
      while (seen !== queries.length + expoRequests.length) {
        seen = queries.length + expoRequests.length;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    expoRequests,
    storedTokens,
    sentMessages: () => expoRequests.flatMap((request) => request.messages),
  };

  try {
    await run(api);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    server.close();
    await once(server, 'close');
  }
}

// Test helpers for the household info tests (US-3-T-13).
// Runs the real backend routes against a fake pg pool, so no database is needed.
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
  owner: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'olivia' },
  member: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'max' },
  outsider: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'otto' },
};

// scenario:
//   signedIn: user making the request, or null for an invalid session
//   name:     the household's current name
export async function withHouseholdApi(run, scenario = {}) {
  const { signedIn = users.owner, name = 'Beach House' } = scenario;
  const household = { inviteCode: INVITE_CODE, name };
  const roles = new Map([[users.owner.id, 'owner'], [users.member.id, 'member']]);
  const queries = [];

  const query = async (sql, params = []) => {
    queries.push([sql, params]);
    if (/FROM user_sessions/i.test(sql)) {
      return signedIn ? { rows: [signedIn], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/UPDATE households h\s+SET name = \$3/i.test(sql)) {
      const [inviteCode, userId, newName] = params;
      if (inviteCode !== household.inviteCode || roles.get(userId) !== 'owner') return { rows: [], rowCount: 0 };
      household.name = newName;
      return { rows: [{ inviteCode, name: newName }], rowCount: 1 };
    }
    if (/AS "exists"/.test(sql)) {
      const [inviteCode, userId] = params;
      const exists = inviteCode === household.inviteCode;
      return { rows: [{ exists, isMember: exists && roles.has(userId) }], rowCount: 1 };
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

  const api = {
    household,
    queries,
    async rename(body, { inviteCode = INVITE_CODE, auth = 'Bearer test-session' } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = auth;
      const response = await fetch(`http://127.0.0.1:${port}/conversations/${inviteCode}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };

  try {
    await run(api);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

// US-3: household expenses are linked to the database through the API routes.
//
// One round-trip test. It builds the whole app with registerRoutes (the same function server.ts
// uses), saves expenses through the routes, checks the rows that reach the database, and then
// reads them back through the routes as a roommate. It covers both expense route sets that
// registerRoutes mounts:
//   - POST/GET /conversations/:inviteCode/expenses        (routes.ts  -> expenses, expense_splits)
//   - POST /houseexpenses/..., GET /houseexpenses,
//     GET /roommateexpense/:roommateId                    (expenses.ts -> household_expenses, roommate_expenses)
//
// The database is a small in-memory fake of pg that keeps rows per table and answers by matching
// the SQL the routes send (an unknown query throws), so no live Postgres is needed. This file is
// self-contained: it needs no helper file.
//
// Run: node --experimental-strip-types --test tests/expense-database-link.test.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire, register } from 'node:module';
import test from 'node:test';

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

const INVITE_CODE = 'BEACH1';
const HOUSEHOLD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const users = {
  olivia: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'olivia', token: 'olivia-token' },
  max: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'max', token: 'max-token' },
  otto: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'otto', token: 'otto-token' }, // not in the household
};
const nameOf = (id) => Object.values(users).find((u) => u.id === id)?.username ?? null;

// ---- Fake database ----------------------------------------------------------------------------

function createFakeDatabase() {
  const tables = {
    household_members: [
      { household_id: HOUSEHOLD_ID, user_id: users.olivia.id, role: 'owner' },
      { household_id: HOUSEHOLD_ID, user_id: users.max.id, role: 'member' },
    ],
    expenses: [],
    expense_splits: [],
    household_expenses: [],
    roommate_expenses: [],
  };
  const isMember = (userId) => tables.household_members.some((m) => m.user_id === userId);
  let clock = Date.UTC(2026, 10, 18, 12, 0, 0);
  const now = () => new Date((clock += 1000));

  // Inserts made inside BEGIN ... COMMIT are only kept on COMMIT; ROLLBACK drops them, like Postgres.
  let pending = null;
  const insert = (table, row) => (pending ? pending.push([table, row]) : tables[table].push(row));

  async function query(sql, params = []) {
    const text = sql.trim();

    if (/FROM user_sessions/i.test(text)) {
      // The route looks the session up by token hash; the fake finds the user by trying each token.
      const { tokenHash } = await import('../backend/routes.ts');
      const user = Object.values(users).find((u) => tokenHash(u.token) === params[0]);
      return user ? { rows: [{ id: user.id, username: user.username }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/^BEGIN$/i.test(text)) { pending = []; return { rows: [], rowCount: 0 }; }
    if (/^COMMIT$/i.test(text)) {
      for (const [table, row] of pending ?? []) tables[table].push(row);
      pending = null;
      return { rows: [], rowCount: 0 };
    }
    if (/^ROLLBACK$/i.test(text)) { pending = null; return { rows: [], rowCount: 0 }; }

    // getConversationAccess
    if (/AS "exists"/.test(text)) {
      const [inviteCode, userId] = params;
      const exists = inviteCode === INVITE_CODE;
      return { rows: [{ exists, isMember: exists && isMember(userId) }], rowCount: 1 };
    }

    // ---- routes.ts: /conversations/:inviteCode/expenses ----
    if (/^SELECT h\.id\s+FROM households h\s+JOIN household_members hm/i.test(text)) {
      const [inviteCode, userId] = params;
      const ok = inviteCode === INVITE_CODE && isMember(userId);
      return ok ? { rows: [{ id: HOUSEHOLD_ID }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/^INSERT INTO expenses\b/i.test(text)) {
      const [household_id, paid_by, title, amount_cents] = params;
      const row = { id: randomUUID(), household_id, paid_by, title, amount_cents, created_at: now() };
      insert('expenses', row);
      return { rows: [{ id: row.id, createdAt: row.created_at }], rowCount: 1 };
    }
    if (/^INSERT INTO expense_splits\b/i.test(text)) {
      const [expense_id, user_id, amount_cents, is_paid] = params;
      insert('expense_splits', { id: randomUUID(), expense_id, user_id, amount_cents, is_paid });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM expenses e\s+JOIN households h/i.test(text)) {
      if (params[0] !== INVITE_CODE) return { rows: [], rowCount: 0 };
      const rows = tables.expenses
        .filter((e) => e.household_id === HOUSEHOLD_ID)
        .sort((a, b) => b.created_at - a.created_at)
        .map((e) => ({
          id: e.id,
          title: e.title,
          amountCents: e.amount_cents,
          createdAt: e.created_at,
          paidByUsername: nameOf(e.paid_by),
          splits: tables.expense_splits
            .filter((s) => s.expense_id === e.id)
            .map((s) => ({ userId: s.user_id, username: nameOf(s.user_id), amountCents: s.amount_cents, isPaid: s.is_paid })),
        }));
      return { rows, rowCount: rows.length };
    }

    // ---- expenses.ts: /houseexpenses and /roommateexpense ----
    if (/SELECT hm\.user_id AS "roommateId"/i.test(text)) {
      if (String(params[0]).toUpperCase() !== INVITE_CODE) return { rows: [], rowCount: 0 };
      const rows = tables.household_members
        .map((m) => ({ roommateId: m.user_id, role: m.role }))
        .sort((a, b) => a.roommateId.localeCompare(b.roommateId));
      return { rows, rowCount: rows.length };
    }
    if (/^INSERT INTO household_expenses\b/i.test(text)) {
      const [id, name, amount, due_date, created_at, paid, conversation_id] = params;
      insert('household_expenses', { id, name, amount, due_date, created_at, paid, conversation_id });
      return { rows: [], rowCount: 1 };
    }
    if (/^INSERT INTO roommate_expenses\b/i.test(text)) {
      const [id, name, amount, due_date, created_at, paid, roommate_id] = params;
      insert('roommate_expenses', { id, name, amount, due_date, created_at, paid, roommate_id });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM household_expenses\s+ORDER BY created_at DESC/i.test(text)) {
      const rows = [...tables.household_expenses]
        .sort((a, b) => b.created_at - a.created_at)
        .map((r) => ({ id: r.id, name: r.name, amount: r.amount, dueDate: r.due_date, createdAt: r.created_at, paid: r.paid, conversationId: r.conversation_id }));
      return { rows, rowCount: rows.length };
    }
    if (/FROM roommate_expenses\s+WHERE roommate_id = \$1/i.test(text)) {
      const rows = tables.roommate_expenses
        .filter((r) => r.roommate_id === params[0])
        .map((r) => ({ id: r.id, name: r.name, amount: r.amount, dueDate: r.due_date, createdAt: r.created_at, paid: r.paid, roommateId: r.roommate_id }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unexpected query in test: ${text}`);
  }

  return { tables, pool: { query, async connect() { return { query, release() {} }; } } };
}

// ---- The test -----------------------------------------------------------------------------------

test('US-3 expense routes save expenses to the database and read them back from it', async () => {
  const db = createFakeDatabase();
  const app = express();
  app.use(express.json());
  registerRoutes(app, db.pool);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { as, body } = {}) => {
    const headers = {};
    if (as) headers.Authorization = `Bearer ${as.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  try {
    // ---- 1. /conversations/:inviteCode/expenses (routes.ts) ----

    // Olivia paid $42.18 for groceries and splits it with Max.
    const created = await call('POST', `/conversations/${INVITE_CODE}/expenses`, {
      as: users.olivia,
      body: {
        title: '  Groceries  ',
        amountCents: 4218,
        splits: [
          { userId: users.olivia.id, amountCents: 2109 },
          { userId: users.max.id, amountCents: 2109 },
        ],
      },
    });
    assert.equal(created.status, 201);
    const expenseId = created.body.expense.id;

    // The expense and its splits reached the database, linked to the household, payer and each other.
    assert.equal(db.tables.expenses.length, 1);
    assert.deepEqual(
      (({ id, household_id, paid_by, title, amount_cents }) => ({ id, household_id, paid_by, title, amount_cents }))(db.tables.expenses[0]),
      { id: expenseId, household_id: HOUSEHOLD_ID, paid_by: users.olivia.id, title: 'Groceries', amount_cents: 4218 }
    );
    assert.deepEqual(
      db.tables.expense_splits.map(({ expense_id, user_id, amount_cents, is_paid }) => ({ expense_id, user_id, amount_cents, is_paid })),
      [
        { expense_id: expenseId, user_id: users.olivia.id, amount_cents: 2109, is_paid: true }, // the payer's share is already paid
        { expense_id: expenseId, user_id: users.max.id, amount_cents: 2109, is_paid: false },
      ]
    );

    // Max reads it back through the route: everything he sees comes from the stored rows.
    const listed = await call('GET', `/conversations/${INVITE_CODE}/expenses`, { as: users.max });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.expenses.length, 1);
    const [stored] = listed.body.expenses;
    assert.equal(stored.id, expenseId);
    assert.equal(stored.title, 'Groceries');
    assert.equal(stored.amountCents, 4218);
    assert.equal(stored.paidByUsername, 'olivia');
    assert.equal(new Date(stored.createdAt).getTime(), db.tables.expenses[0].created_at.getTime());
    assert.deepEqual(stored.splits, [
      { userId: users.olivia.id, username: 'olivia', amountCents: 2109, isPaid: true },
      { userId: users.max.id, username: 'max', amountCents: 2109, isPaid: false },
    ]);

    // A bad split rolls back the whole expense, so nothing half-written stays in the database.
    const badSplit = await call('POST', `/conversations/${INVITE_CODE}/expenses`, {
      as: users.olivia,
      body: { title: 'Pizza', amountCents: 3000, splits: [{ userId: users.max.id, amountCents: 1500 }, { userId: 'not-a-uuid', amountCents: 1500 }] },
    });
    assert.equal(badSplit.status, 400);
    assert.equal(db.tables.expenses.length, 1);
    assert.equal(db.tables.expense_splits.length, 2);

    // Someone outside the household can neither write nor read this household's expenses.
    const outsiderPost = await call('POST', `/conversations/${INVITE_CODE}/expenses`, {
      as: users.otto,
      body: { title: 'Sneaky', amountCents: 100, splits: [] },
    });
    assert.equal(outsiderPost.status, 403);
    assert.equal(db.tables.expenses.length, 1);
    assert.equal((await call('GET', `/conversations/${INVITE_CODE}/expenses`, { as: users.otto })).status, 403);
    assert.equal((await call('GET', `/conversations/${INVITE_CODE}/expenses`)).status, 401);

    // ---- 2. /houseexpenses and /roommateexpense (expenses.ts) ----

    // $30.01 internet bill, split between the two roommates.
    const house = await call('POST', `/houseexpenses/${INVITE_CODE}/Internet/30.01`);
    assert.equal(house.status, 201);
    const houseId = house.body.expense.id;

    assert.equal(db.tables.household_expenses.length, 1);
    assert.equal(db.tables.household_expenses[0].id, houseId);
    assert.equal(db.tables.household_expenses[0].name, 'Internet');
    assert.equal(db.tables.household_expenses[0].amount, 30.01);
    assert.equal(db.tables.household_expenses[0].conversation_id, INVITE_CODE);
    // Each roommate's share is stored under the household expense's id and adds up to the total.
    assert.deepEqual(
      db.tables.roommate_expenses.map(({ id, roommate_id, amount }) => ({ id, roommate_id, amount })),
      [
        { id: houseId, roommate_id: users.olivia.id, amount: 15.01 },
        { id: houseId, roommate_id: users.max.id, amount: 15 },
      ]
    );

    const houseList = await call('GET', '/houseexpenses');
    assert.equal(houseList.status, 200);
    assert.deepEqual(houseList.body.map(({ id, name, amount, conversationId }) => ({ id, name, amount, conversationId })), [
      { id: houseId, name: 'Internet', amount: 30.01, conversationId: INVITE_CODE },
    ]);

    const maxShare = await call('GET', `/roommateexpense/${users.max.id}`);
    assert.equal(maxShare.status, 200);
    assert.deepEqual(maxShare.body.map(({ id, name, amount, roommateId }) => ({ id, name, amount, roommateId })), [
      { id: houseId, name: 'Internet', amount: 15, roommateId: users.max.id },
    ]);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});

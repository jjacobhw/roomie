/**
 * Roomie Expenses Module
 * Provides functions to manage expenses in PostgreSQL.
 * All error messages are logged to the console.
 */

import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';

export interface HouseExpense {
  id: string;
  name: string;
  amount: number;
  dueDate: Date;
  createdAt: Date;
  paid: boolean;
  conversationId: string;
}

export interface RoommateExpense {
  id: string;
  name: string;
  amount: number;
  dueDate: Date;
  createdAt: Date;
  paid: boolean;
  roommateId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

class ExpenseInputError extends Error {}

function normalizeExpenseName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ExpenseInputError('Expense name is required.');
  }
  return trimmed;
}

function normalizeExpenseAmount(amount: number | string | undefined): number {
  const parsed = typeof amount === 'number'
    ? amount
    : typeof amount === 'string'
      ? Number.parseFloat(amount)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new ExpenseInputError('Expense amount must be a valid number.');
  }
  return parsed;
}

function safeExpenseError(error: unknown, defaultMessage: string): { status: number; message: string } {
  if (error instanceof ExpenseInputError) {
    return { status: 400, message: error.message };
  }
  console.error(defaultMessage, error);
  return { status: 500, message: defaultMessage };
}

function buildExpenseRecord(conversationId: string, name: string, amount: number): HouseExpense {
  const now = new Date();
  return {
    id: randomUUID(),
    name,
    amount,
    dueDate: now,
    createdAt: now,
    paid: false,
    conversationId,
  };
}

/**
 * Retrieves all household expenses.
 * @param pool The database pool.
 * @returns The house expenses.
 */
export async function getHouseExpenses(pool: Pool): Promise<HouseExpense[]> {
  try {
    const result = await pool.query<HouseExpense>(
      `SELECT id, name, amount, due_date AS "dueDate", created_at AS "createdAt", paid, conversation_id AS "conversationId"
       FROM household_expenses
       ORDER BY created_at DESC`
    );
    return result.rows.map((row) => ({
      ...row,
      dueDate: row.dueDate instanceof Date ? row.dueDate : new Date(row.dueDate),
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    }));
  } catch (error) {
    console.error('Unable to read household expenses.', error);
    return [];
  }
}

/**
 * Retrieves all expenses for a specific roommate.
 * @param pool The database pool.
 * @param roommateId The roommate to retrieve expenses for.
 * @returns The roommate's expenses.
 */
export async function getRoommateExpenses(pool: Pool, roommateId: string): Promise<RoommateExpense[]> {
  try {
    const result = await pool.query<RoommateExpense>(
      `SELECT id, name, amount, due_date AS "dueDate", created_at AS "createdAt", paid, roommate_id AS "roommateId"
       FROM roommate_expenses
       WHERE roommate_id = $1
       ORDER BY created_at DESC`,
      [roommateId]
    );
    return result.rows.map((row) => ({
      ...row,
      dueDate: row.dueDate instanceof Date ? row.dueDate : new Date(row.dueDate),
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    }));
  } catch (error) {
    console.error(`Unable to read roommate expenses for ${roommateId}.`, error);
    return [];
  }
}

/**
 * Creates a new household expense and splits it among roommates.
 * @param pool The database pool.
 * @param conversationId The conversation the expense refers to.
 * @param name The name of the expense.
 * @param amount The amount needed to pay the expense.
 * @returns The created expense.
 */
export async function createHouseExpense(
  pool: Pool,
  conversationId: string,
  name: string,
  amount: number | string = -1
): Promise<HouseExpense> {
  const normalizedName = normalizeExpenseName(name);
  const normalizedAmount = normalizeExpenseAmount(amount);
  const expense = buildExpenseRecord(conversationId, normalizedName, normalizedAmount);

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const members = await client.query<{ roommateId: string; role: string }>(
      `SELECT hm.user_id AS "roommateId", hm.role
       FROM households h
       JOIN household_members hm ON hm.household_id = h.id
       WHERE upper(h.invite_code) = upper($1)
       ORDER BY hm.user_id
       FOR UPDATE OF h, hm`,
      [conversationId]
    );
    const owner = members.rows.find((member) => member.role === 'owner');
    if (!owner) {
      throw new Error('Household owner not found.');
    }

    await client.query(
      `INSERT INTO household_expenses (id, name, amount, due_date, created_at, paid, conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        expense.id,
        expense.name,
        expense.amount,
        expense.dueDate,
        expense.createdAt,
        expense.paid,
        expense.conversationId,
      ]
    );
    // Rounding logic: Convert the normalized amount to cents, round it, and then split it among roommates. The owner gets any remainder.
    const totalCents = Math.round(normalizedAmount * 100);
    if (!Number.isSafeInteger(totalCents)) {
      throw new ExpenseInputError('Expense amount is too large to split into cents.');
    }
    const centsPerRoommate = Math.trunc(totalCents / members.rows.length);
    const ownerCents = totalCents - centsPerRoommate * (members.rows.length - 1);
    for (const member of members.rows) {
      const cents = member.roommateId === owner.roommateId ? ownerCents : centsPerRoommate;
      await client.query(
        `INSERT INTO roommate_expenses (id, name, amount, due_date, created_at, paid, roommate_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          expense.id,
          expense.name,
          cents / 100,
          expense.dueDate,
          expense.createdAt,
          expense.paid,
          member.roommateId,
        ]
      );
    }
    await client.query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Unable to roll back household expense creation.', rollbackError);
      }
    }
    console.error('Unable to create household expense.', error);
    throw error;
  } finally {
    client.release();
  }

  return expense;
}

/**
 * Updates a household expense.
 * @param pool The database pool.
 * @param id The ID of the expense to update.
 * @param expense Expense to update
 * @returns The updated expense.
 */
export async function updateHouseExpense(
  pool: Pool,
  id: string,
  expense: Partial<HouseExpense>
): Promise<HouseExpense> {
  const nextExpense = {
    id,
    name: expense.name ?? 'Expense',
    amount: normalizeExpenseAmount(expense.amount ?? -1),
    dueDate: expense.dueDate ?? new Date(),
    createdAt: expense.createdAt ?? new Date(),
    paid: expense.paid ?? false,
    conversationId: expense.conversationId ?? id,
  };

  try {
    await pool.query(
      `UPDATE household_expenses
       SET name = $2, amount = $3, due_date = $4, created_at = $5, paid = $6, conversation_id = $7
       WHERE id = $1`,
      [id, nextExpense.name, nextExpense.amount, nextExpense.dueDate, nextExpense.createdAt, nextExpense.paid, nextExpense.conversationId]
    );
  } catch (error) {
    console.error(`Unable to update household expense ${id}.`, error);
  }

  return nextExpense;
}

export async function updateHouseExpensePaid(
  pool: Pool,
  id: string,
  paid: boolean
): Promise<HouseExpense> {
  return updateHouseExpense(pool, id, { paid });
}

/**
 * Updates a roommate expense.
 * @param pool The database pool.
 * @param id The ID of the expense to update.
 * @param expense Expense to update
 * @returns The updated expense.
 */
export async function updateRoommateExpense(
  pool: Pool,
  id: string,
  expense: Partial<RoommateExpense>
): Promise<RoommateExpense> {
  const nextExpense = {
    id,
    name: expense.name ?? 'Roommate expense',
    amount: normalizeExpenseAmount(expense.amount ?? -1),
    dueDate: expense.dueDate ?? new Date(),
    createdAt: expense.createdAt ?? new Date(),
    paid: expense.paid ?? false,
    roommateId: expense.roommateId ?? id,
  };

  try {
    await pool.query(
      `UPDATE roommate_expenses
       SET name = $2, amount = $3, due_date = $4, created_at = $5, paid = $6, roommate_id = $7
       WHERE id = $1`,
      [id, nextExpense.name, nextExpense.amount, nextExpense.dueDate, nextExpense.createdAt, nextExpense.paid, nextExpense.roommateId]
    );
  } catch (error) {
    console.error(`Unable to update roommate expense ${id}.`, error);
  }

  return nextExpense;
}

export async function updateRoommateExpensePaid(
  pool: Pool,
  id: string,
  paid: boolean
): Promise<RoommateExpense> {
  return updateRoommateExpense(pool, id, { paid });
}

/**
 * Deleates a household expense and its associated roommate expenses.
 * @param pool The database pool.
 * @param id ID of the expense to delete.
 */
export async function deleteHouseExpense(pool: Pool, id: string): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM household_expenses WHERE id = $1`,
      [id]
    );
    await pool.query(
      `DELETE FROM roommate_expenses WHERE id = $1`,
      [id]
    );
  } catch (error) {
    console.error(`Unable to delete house expense ${id}.`, error);
  }
}

export function registerExpenseRoutes(app: Express, pool: Pool): void {
  app.get('/houseexpenses', async (_request: Request, response: Response) => {
    const expenses = await getHouseExpenses(pool);
    response.json(expenses);
  });

  app.get('/roommateexpense/:roommateId', async (request: Request, response: Response) => {
    const roommateId = pathValue(request.params.roommateId);
    const expenses = await getRoommateExpenses(pool, roommateId);
    response.json(expenses);
  });

  app.post('/houseexpenses/:conversationId/:name/:amount', async (request: Request, response: Response) => {
    try {
      const conversationId = pathValue(request.params.conversationId);
      const name = normalizeExpenseName(pathValue(request.params.name));
      const amount = normalizeExpenseAmount(pathValue(request.params.amount));
      const expense = await createHouseExpense(pool, conversationId, name, amount);
      response.status(201).json({ expense });
    } catch (error) {
      const result = safeExpenseError(error, 'Failed to create expense.');
      response.status(result.status).json({ error: result.message });
    }
  });

  app.post('/houseexpenses/:conversationId/:name', async (request: Request, response: Response) => {
    try {
      const conversationId = pathValue(request.params.conversationId);
      const name = normalizeExpenseName(pathValue(request.params.name));
      const expense = await createHouseExpense(pool, conversationId, name, -1);
      response.status(201).json({ expense });
    } catch (error) {
      const result = safeExpenseError(error, 'Failed to create expense.');
      response.status(result.status).json({ error: result.message });
    }
  });

  app.post('/houseexpenses/:conversationId', async (_request: Request, response: Response) => {
    response.status(400).json({ error: 'Expense name is required.' });
  });

  app.patch('/houseexpenses/:id', async (request: Request, response: Response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ error: 'Request body must be an object.' });
      return;
    }

    const update = request.body as Partial<HouseExpense>;
    const expense = await updateHouseExpense(pool, pathValue(request.params.id), update);
    response.json(expense);
  });

  app.patch('/roommateexpense/:id', async (request: Request, response: Response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ error: 'Request body must be an object.' });
      return;
    }

    const update = request.body as Partial<RoommateExpense>;
    const expense = await updateRoommateExpense(pool, pathValue(request.params.id), update);
    response.json(expense);
  });

  app.delete('/houseexpenses/:id', async (request: Request, response: Response) => {
    await deleteHouseExpense(pool, pathValue(request.params.id));
    response.status(204).end();
  });
}
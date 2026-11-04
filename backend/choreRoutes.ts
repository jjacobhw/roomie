/*
  Chores API (Sprint 2), backed by database/migrations/003_chores.sql.

  A household has chore lists; each list has items that roommates check off.
  A list can be assigned to one roommate ("Sam's chores") or to nobody (whole house).
  Every route needs a signed-in member of the household the list belongs to.

    GET    /conversations/:inviteCode/chores   all lists in the household, with their items
    POST   /conversations/:inviteCode/chores   create a list   { title?, assignee? }
    DELETE /chores/:listId                     delete a list and its items
    POST   /chores/:listId/items               add an item     { text }
    PATCH  /chores/items/:itemId               check/uncheck   { isDone }
    DELETE /chores/items/:itemId               delete an item
*/
import type { Express, Response } from 'express';
import type { Pool } from 'pg';
import {
  authenticated,
  getConversationAccess,
  isRecord,
  routeParam,
  type AuthenticatedRequest,
} from './routes';

const MAX_TITLE_LENGTH = 80;   // matches the CHECK on chore_lists.title
const MAX_ITEM_LENGTH = 200;   // matches the CHECK on chore_items.body
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_ID_PATTERN = /^\d{1,18}$/;

export interface ChoreItem {
  id: string;
  text: string;
  isDone: boolean;
  doneBy: string | null;     // username
  doneAt: string | null;     // ISO 8601
  createdAt: string;
}

export interface ChoreList {
  id: string;
  title: string;
  assignee: string | null;   // username, or null for the whole household
  createdBy: string | null;
  createdAt: string;
  items: ChoreItem[];
}

// Columns for one item, shared by every query that returns items.
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

function sendAccessError(response: Response, access: 'not_found' | 'not_member' | 'member'): boolean {
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

// The household a list belongs to, and whether the signed-in user is in it.
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

export function registerChoreRoutes(app: Express, pool: Pool): void {
  // All lists in the household, oldest first, each with its items oldest first.
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

  // Create a list. Defaults: assigned to the signed-in user, titled "<assignee>'s chores".
  // Pass assignee: null for a whole-house list, or another member's username.
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

    // Resolve the assignee to a member of this household.
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

  // Check or uncheck an item. Any household member can do it; we record who did.
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

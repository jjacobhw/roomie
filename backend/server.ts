import { config } from 'dotenv';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { Pool } from 'pg';
import { resolve } from 'node:path';
// CHANGED: getMessages is no longer imported from texting.ts (it's still there, just unused by
// the server). GET /messages/:inviteCode now uses listMessages from households.ts instead.
import { getConversations } from './texting';
// NEW: all the household logic (create, join, send, read) lives in households.ts.
import {
  createHousehold,
  HttpError,
  joinHousehold,
  listMessages,
  sendHouseholdMessage,
} from './households';

config({ path: resolve(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set in the environment or root .env file.');
}

const pool = new Pool({ connectionString: databaseUrl });
const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

const listConversations: RequestHandler = async (_request, response, next) => {
  try {
    response.json({ conversations: await getConversations(pool) });
  } catch (error) {
    next(error);
  }
};

app.get(['/convos', '/conversations'], listConversations);

// NEW: helper for the POST routes below.
// Pull a required, non-empty string field out of a JSON body or answer 400.
function requireString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `${field} is required`);
  }
  return value;
}

// CHANGED (route existed before): now calls listMessages from households.ts instead of getMessages.
//   - each message now has an `id` (the app needs one as a list key)
//   - invite codes are matched case-insensitively
//   - the `attachments` field is dropped (nothing uses it yet)
//   - unknown code -> 404 { error: "No household with code XXXXXX" } (via HttpError)
app.get('/messages/:inviteCode', async (request, response, next) => {
  try {
    response.json({ messages: await listMessages(pool, request.params.inviteCode) });
  } catch (error) {
    next(error);
  }
});

// NEW: create a household; the response carries its invite code.
// 201 { inviteCode } | 404 user not found | 409 user is already in a household
app.post('/households', async (request, response, next) => {
  try {
    const username = requireString(request.body, 'username');
    response.status(201).json({ inviteCode: await createHousehold(pool, username) });
  } catch (error) {
    next(error);
  }
});

// NEW: join the household that owns this invite code.
// 200 { ok: true } | 404 unknown user or code | 409 user is already in a different household
app.post('/households/join', async (request, response, next) => {
  try {
    const username = requireString(request.body, 'username');
    const inviteCode = requireString(request.body, 'inviteCode');
    await joinHousehold(pool, username, inviteCode);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// NEW: send a message to the household. Enforces the 3-second cooldown per sender.
// 201 { message } | 400 empty/too long | 403 not a member | 404 unknown user or code
// | 429 { error, retryAfterMs } when sending too fast
app.post('/households/:inviteCode/messages', async (request, response, next) => {
  try {
    const username = requireString(request.body, 'username');
    // Not requireString: whitespace-only text is the sender's mistake and gets a clear 400 below.
    const messageText = (request.body as { messageText?: unknown } | undefined)?.messageText;
    if (typeof messageText !== 'string') {
      throw new HttpError(400, 'messageText is required');
    }
    const message = await sendHouseholdMessage(pool, username, request.params.inviteCode, messageText);
    response.status(201).json({ message });
  } catch (error) {
    next(error);
  }
});

// CHANGED: handleError used to answer 500 for everything. Now it first checks for HttpError
// (thrown in households.ts for expected problems) and sends that status; anything else is
// still logged and answered with a 500 exactly as before.
const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
  // Expected problems (bad code, already in a household, too fast...) carry their own status.
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: error.message,
      ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
    });
    return;
  }

  console.error('API request failed:', error);
  response.status(500).json({ error: 'Internal server error.' });
};

app.use(handleError);

app.listen(port, () => {
  console.log(`Roomie API listening on port ${port}`);
});

import { config } from 'dotenv';
import express, { type ErrorRequestHandler } from 'express';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { registerRoutes } from './routes';

config({ path: resolve(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set in the environment or root .env file.');
}

const pool = new Pool({ connectionString: databaseUrl });
=======
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
// The Postgres pool (and .env loading) now lives in db.ts so scripts can share it.
import { checkDatabase, pool } from './db';
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

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());
registerRoutes(app, pool);

const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error('API request failed:', error);
  response.status(500).json({ error: 'Internal server error.' });
};

app.use(handleError);

app.listen(port, () => {
  console.log(`Roomie API listening on port ${port}`);
});

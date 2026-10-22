import { config } from 'dotenv';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { getConversations, getMessages } from './texting';

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

app.get('/messages/:inviteCode', async (request, response, next) => {
  try {
    const messages = await getMessages(pool, request.params.inviteCode);
    if (messages === null) {
      response.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    response.json({ messages });
  } catch (error) {
    next(error);
  }
});

const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error('API request failed:', error);
  response.status(500).json({ error: 'Internal server error.' });
};

app.use(handleError);

app.listen(port, () => {
  console.log(`Roomie API listening on port ${port}`);
});

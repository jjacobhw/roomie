import { config } from 'dotenv';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { createMessage, getConversations, getMessages } from './texting';

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

app.post('/messages/:inviteCode', async (request, response, next) => {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    response.status(400).json({ error: 'Request body must be a JSON object.' });
    return;
  }

  const { username, messageText } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof messageText !== 'string') {
    response.status(400).json({ error: 'username and messageText must be strings.' });
    return;
  }

  const normalizedUsername = username.trim();
  const normalizedMessage = messageText.trim();
  if (normalizedUsername.length < 1 || normalizedUsername.length > 50) {
    response.status(400).json({ error: 'username must be between 1 and 50 characters.' });
    return;
  }
  if (normalizedMessage.length < 1 || normalizedMessage.length > 2000) {
    response.status(400).json({ error: 'messageText must be between 1 and 2000 characters.' });
    return;
  }

  try {
    const result = await createMessage(
      pool,
      request.params.inviteCode,
      normalizedUsername,
      normalizedMessage
    );

    switch (result.status) {
      case 'created':
        response.status(201).json({ message: result.message });
        return;
      case 'conversation_not_found':
        response.status(404).json({ error: 'Conversation not found.' });
        return;
      case 'not_member':
        response.status(403).json({ error: 'User is not a member of this conversation.' });
        return;
      case 'ambiguous_user':
        response.status(409).json({ error: 'More than one member has this username.' });
        return;
    }
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

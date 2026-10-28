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

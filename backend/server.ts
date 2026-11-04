import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { pool } from './db';
import { registerRoutes } from './routes';

const app = express();
const port = Number(process.env.PORT) || 3000;

// Lets the web build (served from another domain) call this API.
// CORS_ORIGINS is a comma-separated list, e.g. https://roomie-web.onrender.com.
// When it's unset every origin is allowed, which is fine since auth uses bearer tokens, not cookies.
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));

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

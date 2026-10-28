import express, { type ErrorRequestHandler } from 'express';
import { pool } from './db';
import { registerRoutes } from './routes';

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

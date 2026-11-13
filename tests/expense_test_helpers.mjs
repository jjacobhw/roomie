import { once } from 'node:events';
import { createRequire } from 'node:module';

import { registerExpenseRoutes } from '../backend/expenses.ts';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');

export async function withExpenseApi(run) {
  const queries = [];
  const pool = {
    async query(...args) {
      queries.push(args);
      return { rows: [], rowCount: 1 };
    },
  };
  const app = express();
  registerExpenseRoutes(app, pool);
  const server = app.listen(0);
  await once(server, 'listening');

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`, queries);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

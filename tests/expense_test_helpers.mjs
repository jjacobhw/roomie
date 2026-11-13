import { once } from 'node:events';
import { createRequire } from 'node:module';

import { registerExpenseRoutes } from '../backend/expenses.ts';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');

export async function withExpenseApi(
  run,
  {
    rows = [],
    householdMembers = [{ roommateId: 'owner-1', role: 'owner' }],
  } = {}
) {
  const queries = [];
  const query = async (...args) => {
    queries.push(args);
    if (/SELECT hm\.user_id AS "roommateId"/i.test(args[0])) {
      return { rows: householdMembers, rowCount: householdMembers.length };
    }
    return { rows, rowCount: 1 };
  };
  const pool = {
    query,
    async connect() {
      return {
        query,
        release() {},
      };
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

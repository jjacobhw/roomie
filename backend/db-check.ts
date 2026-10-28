/*
  Connection test: `npm run db:check` (from backend/).
  Prints the server time and version, and which Roomie tables exist.
 */
import { checkDatabase, pool } from './db';

async function main() {
  const host = new URL(process.env.DATABASE_URL!).host;
  console.log(`Connecting to ${host} ...`);

  const info = await checkDatabase();
  console.log(`Connected to database "${info.database}" at ${info.now.toISOString()}`);
  console.log(info.version);

  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  const names = tables.rows.map((row) => row.table_name);
  console.log(`Tables: ${names.length ? names.join(', ') : '(none yet; run database/migrate.sh)'}`);
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('Database check FAILED:', error.message);
    await pool.end();
    process.exit(1);
  });

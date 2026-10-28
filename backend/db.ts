import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';

// Load the root .env before reading DATABASE_URL.
config({ path: resolve(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set in the environment or root .env file.');
}

export const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// An idle client can error (e.g. the database restarts); without a listener that crashes the process.
pool.on('error', (error) => {
  console.error('Unexpected error on idle PostgreSQL client:', error);
});

// Fail fast at startup if the database is unreachable.
export async function verifyDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}

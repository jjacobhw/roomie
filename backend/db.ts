/*
  Shared Postgres connection for the backend.

  Reads DATABASE_URL from the environment, or from the repo-root .env file.
  Works for both local Postgres and Neon (Neon URLs carry sslmode=require).
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

// The root .env is one level up when running with tsx (backend/),
// and two levels up when running the compiled build (backend/dist/).
const envFile = [resolve(__dirname, '../.env'), resolve(__dirname, '../../.env')].find(existsSync);
if (envFile) {
  config({ path: envFile });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set in the environment or root .env file.');
}

export const pool = new Pool({
  connectionString: databaseUrl,
  // Neon's URL asks for channel binding; node-postgres needs this flag to do it.
  enableChannelBinding: databaseUrl.includes('channel_binding=require'),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Neon closes idle connections; log it instead of crashing the server.
pool.on('error', (error) => {
  console.error('Postgres pool error:', error.message);
});

// Small query used by /health/db and the db:check script.
export async function checkDatabase() {
  const result = await pool.query<{ now: Date; version: string; database: string }>(
    'SELECT now() AS now, version() AS version, current_database() AS database'
  );
  return result.rows[0];
}

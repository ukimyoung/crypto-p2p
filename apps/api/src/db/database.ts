import { Pool, PoolClient, PoolConfig } from 'pg';

export type Db = Pool;
export type Tx = PoolClient;

/**
 * Pool settings from the URL plus two optional variables, read here so every
 * entry point (server and CLIs) connects the same way:
 * - DATABASE_SSL=require encrypts the connection without checking the
 *   certificate chain, which hosted Postgres such as Supabase needs.
 * - DATABASE_POOL_MAX caps connections (default 20); free hosted plans allow few.
 */
export function poolConfig(connectionString: string, env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const max = Number(env.DATABASE_POOL_MAX ?? 20);
  if (env.DATABASE_SSL !== 'require') return { connectionString, max };
  // An sslmode in the URL would override the ssl option below, so drop it.
  const url = parseUrl(connectionString);
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), max, ssl: { rejectUnauthorized: false } };
}

/** Never echoes the value: it holds the database password. */
function parseUrl(connectionString: string): URL {
  try {
    return new URL(connectionString.trim());
  } catch {
    throw new Error(
      'DATABASE_URL is not a valid postgres:// URL. Check for quotes or a "DATABASE_URL=" prefix, ' +
        'and percent-encode #, / or ? in the password (or use a password of letters and digits).',
    );
  }
}

export function createPool(connectionString: string): Pool {
  return new Pool(poolConfig(connectionString));
}

/**
 * Runs `fn` inside a transaction. Commits on success, rolls back on any error.
 */
export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

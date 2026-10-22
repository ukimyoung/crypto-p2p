import { Pool, PoolClient } from 'pg';

export type Db = Pool;
export type Tx = PoolClient;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 20 });
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

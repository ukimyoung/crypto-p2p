import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Db, withTransaction } from './database';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
// Arbitrary constant so concurrent deploys don't run migrations twice.
const MIGRATION_LOCK_ID = 727_001;

/** Applies every migration in `migrations/` that has not run yet, in file name order. */
export async function migrate(db: Db): Promise<string[]> {
  return withTransaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await tx.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      await tx.query(await readFile(join(MIGRATIONS_DIR, file), 'utf8'));
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      ran.push(file);
    }
    return ran;
  });
}

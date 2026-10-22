import { createPool, Db, withTransaction } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { LedgerService } from '../src/ledger/ledger.service';

export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/p2p_test';

/** Fresh schema for each test file. */
export async function setupDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL);
  await db.query('DROP SCHEMA IF EXISTS public CASCADE');
  await db.query('CREATE SCHEMA public');
  await migrate(db);
  return db;
}

export async function createUser(db: Db, kycLevel = 1): Promise<string> {
  const { rows } = await db.query<{ id: string }>('INSERT INTO users (kyc_level) VALUES ($1) RETURNING id', [kycLevel]);
  return rows[0]!.id;
}

let depositSeq = 0;

/** Simulates a confirmed on-chain deposit until the wallet module exists. */
export async function deposit(db: Db, ledger: LedgerService, userId: string, asset: string, amount: bigint) {
  await withTransaction(db, (tx) =>
    ledger.post(tx, {
      idempotencyKey: `test-deposit:${++depositSeq}:${userId}`,
      kind: 'deposit',
      postings: [
        { account: { system: 'custody', asset }, amount: -amount },
        { account: { userId, asset, kind: 'available' }, amount },
      ],
    }),
  );
}

export const BTC = 100_000_000n; // satoshi per BTC

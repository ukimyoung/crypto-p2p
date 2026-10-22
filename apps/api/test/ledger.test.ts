import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db, withTransaction } from '../src/db/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { BTC, createUser, deposit, setupDb } from './helpers';

describe('LedgerService', () => {
  let db: Db;
  const ledger = new LedgerService();

  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db.end();
  });

  it('credits a deposit against the custody account', async () => {
    const user = await createUser(db);
    await deposit(db, ledger, user, 'BTC', 2n * BTC);
    expect(await ledger.balance(db, { userId: user, asset: 'BTC', kind: 'available' })).toBe(2n * BTC);
  });

  it('rejects postings that do not balance', async () => {
    const user = await createUser(db);
    await expect(
      withTransaction(db, (tx) =>
        ledger.post(tx, {
          idempotencyKey: 'unbalanced',
          kind: 'test',
          postings: [
            { account: { system: 'custody', asset: 'BTC' }, amount: -5n },
            { account: { userId: user, asset: 'BTC', kind: 'available' }, amount: 4n },
          ],
        }),
      ),
    ).rejects.toThrow(/do not balance/);
  });

  it('refuses to overdraw a user account and rolls everything back', async () => {
    const user = await createUser(db);
    await deposit(db, ledger, user, 'BTC', 10n);
    await expect(
      withTransaction(db, (tx) =>
        ledger.post(tx, {
          idempotencyKey: 'overdraw',
          kind: 'test',
          postings: [
            { account: { userId: user, asset: 'BTC', kind: 'available' }, amount: -11n },
            { account: { userId: user, asset: 'BTC', kind: 'escrow' }, amount: 11n },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
    expect(await ledger.balance(db, { userId: user, asset: 'BTC', kind: 'available' })).toBe(10n);
    const { rowCount } = await db.query("SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'overdraw'");
    expect(rowCount).toBe(0);
  });

  it('applies the same idempotency key once', async () => {
    const user = await createUser(db);
    const req = {
      idempotencyKey: `dup:${user}`,
      kind: 'deposit',
      postings: [
        { account: { system: 'custody' as const, asset: 'ETH' }, amount: -7n },
        { account: { userId: user, asset: 'ETH', kind: 'available' as const }, amount: 7n },
      ],
    };
    const first = await withTransaction(db, (tx) => ledger.post(tx, req));
    const second = await withTransaction(db, (tx) => ledger.post(tx, req));
    expect(second).toEqual({ transactionId: first.transactionId, duplicate: true });
    expect(await ledger.balance(db, { userId: user, asset: 'ETH', kind: 'available' })).toBe(7n);
  });

  it('blocks an unbalanced transaction written around the service', async () => {
    const user = await createUser(db);
    await deposit(db, ledger, user, 'BTC', 1n);
    await expect(
      withTransaction(db, async (tx) => {
        const t = await tx.query<{ id: string }>(
          "INSERT INTO ledger_transactions (idempotency_key, kind) VALUES ('raw', 'raw') RETURNING id",
        );
        const a = await tx.query<{ id: string }>(
          "SELECT id FROM ledger_accounts WHERE user_id = $1 AND kind = 'available'",
          [user],
        );
        await tx.query('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES ($1, $2, 5)', [
          t.rows[0]!.id,
          a.rows[0]!.id,
        ]);
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it('keeps ledger entries append-only', async () => {
    await expect(db.query('UPDATE ledger_entries SET amount = amount * 2')).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM ledger_entries')).rejects.toThrow(/append-only/);
  });

  it('reconciles stored balances with entries', async () => {
    expect(await ledger.findMismatchedAccounts(db)).toEqual([]);
  });
});

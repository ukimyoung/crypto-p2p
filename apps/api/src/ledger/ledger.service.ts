import { DomainError } from '../common/errors';
import { Db, Tx } from '../db/database';

export type UserAccountKind = 'available' | 'escrow' | 'withdrawal_pending';
export type SystemAccountKind = 'custody' | 'fee_revenue';

export type AccountRef =
  | { userId: string; asset: string; kind: UserAccountKind }
  | { system: SystemAccountKind; asset: string };

export interface Posting {
  account: AccountRef;
  /** Signed amount in the asset's smallest unit. Positive credits the account. */
  amount: bigint;
}

export interface PostRequest {
  /** Same key posted twice is applied once; the second call returns the first result. */
  idempotencyKey: string;
  kind: string;
  ref?: { type: string; id: string };
  postings: Posting[];
}

export interface PostResult {
  transactionId: string;
  duplicate: boolean;
}

/**
 * Double-entry ledger. Every balance change in the system goes through `post`,
 * which writes balanced entries and updates account balances in the caller's
 * database transaction.
 */
export class LedgerService {
  async post(tx: Tx, req: PostRequest): Promise<PostResult> {
    assertBalanced(req.postings);

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO ledger_transactions (idempotency_key, kind, ref_type, ref_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [req.idempotencyKey, req.kind, req.ref?.type ?? null, req.ref?.id ?? null],
    );
    if (inserted.rows[0] === undefined) {
      const existing = await tx.query<{ id: string }>(
        'SELECT id FROM ledger_transactions WHERE idempotency_key = $1',
        [req.idempotencyKey],
      );
      return { transactionId: existing.rows[0]!.id, duplicate: true };
    }
    const transactionId = inserted.rows[0].id;

    const accountIds: string[] = [];
    for (const p of req.postings) accountIds.push(await this.ensureAccount(tx, p.account));

    // Lock in a stable order so concurrent postings over the same accounts cannot deadlock.
    await tx.query('SELECT id FROM ledger_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
      [...new Set(accountIds)],
    ]);

    for (const [i, p] of req.postings.entries()) {
      const accountId = accountIds[i]!;
      try {
        await tx.query('UPDATE ledger_accounts SET balance = balance + $2 WHERE id = $1', [
          accountId,
          p.amount.toString(),
        ]);
      } catch (err) {
        if (isCheckViolation(err)) {
          throw new DomainError('insufficient_balance', `Insufficient ${p.account.asset} balance`);
        }
        throw err;
      }
      await tx.query('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES ($1, $2, $3)', [
        transactionId,
        accountId,
        p.amount.toString(),
      ]);
    }

    return { transactionId, duplicate: false };
  }

  async balance(db: Db | Tx, account: AccountRef): Promise<bigint> {
    const { rows } =
      'userId' in account
        ? await db.query<{ balance: string }>(
            'SELECT balance FROM ledger_accounts WHERE user_id = $1 AND asset = $2 AND kind = $3',
            [account.userId, account.asset, account.kind],
          )
        : await db.query<{ balance: string }>(
            'SELECT balance FROM ledger_accounts WHERE user_id IS NULL AND asset = $1 AND kind = $2',
            [account.asset, account.system],
          );
    return rows[0] ? BigInt(rows[0].balance) : 0n;
  }

  /**
   * Daily reconciliation check: returns every account whose stored balance
   * differs from the sum of its entries. An empty result means the ledger is consistent.
   */
  async findMismatchedAccounts(db: Db): Promise<{ accountId: string; balance: bigint; entrySum: bigint }[]> {
    const { rows } = await db.query<{ id: string; balance: string; entry_sum: string }>(
      `SELECT a.id, a.balance, COALESCE(sum(e.amount), 0) AS entry_sum
       FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
       GROUP BY a.id
       HAVING a.balance <> COALESCE(sum(e.amount), 0)`,
    );
    return rows.map((r) => ({ accountId: r.id, balance: BigInt(r.balance), entrySum: BigInt(r.entry_sum) }));
  }

  private async ensureAccount(tx: Tx, ref: AccountRef): Promise<string> {
    if ('userId' in ref) {
      await tx.query(
        `INSERT INTO ledger_accounts (user_id, asset, kind) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, asset, kind) WHERE user_id IS NOT NULL DO NOTHING`,
        [ref.userId, ref.asset, ref.kind],
      );
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM ledger_accounts WHERE user_id = $1 AND asset = $2 AND kind = $3',
        [ref.userId, ref.asset, ref.kind],
      );
      return rows[0]!.id;
    }
    await tx.query(
      `INSERT INTO ledger_accounts (user_id, asset, kind) VALUES (NULL, $1, $2)
       ON CONFLICT (asset, kind) WHERE user_id IS NULL DO NOTHING`,
      [ref.asset, ref.system],
    );
    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM ledger_accounts WHERE user_id IS NULL AND asset = $1 AND kind = $2',
      [ref.asset, ref.system],
    );
    return rows[0]!.id;
  }
}

function assertBalanced(postings: Posting[]): void {
  if (postings.length < 2) throw new Error('A ledger transaction needs at least two postings');
  const sums = new Map<string, bigint>();
  for (const p of postings) {
    if (p.amount === 0n) throw new Error('Ledger postings must be non-zero');
    sums.set(p.account.asset, (sums.get(p.account.asset) ?? 0n) + p.amount);
  }
  for (const [asset, sum] of sums) {
    if (sum !== 0n) throw new Error(`Ledger postings do not balance for ${asset}: ${sum}`);
  }
}

function isCheckViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23514';
}

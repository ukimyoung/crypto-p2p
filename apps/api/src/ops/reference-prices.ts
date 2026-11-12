import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';

/** Markets whose price operators set by hand on the settings page. */
export const REFERENCE_PRICE_MARKETS = [{ asset: 'USDT', fiat: 'KRW' }] as const;

/** Sanity bound: no coin we list is worth a trillion won or dollars. */
export const MAX_REFERENCE_PRICE_MINOR = 10n ** 15n;

export interface ReferencePrice {
  id: string;
  asset: string;
  fiat: string;
  /** Fiat minor units per 1 whole coin (won for KRW). */
  priceMinor: bigint;
  reason: string;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: Date;
}

export interface ReferencePriceOverview {
  asset: string;
  fiat: string;
  /** Null until an operator sets one. */
  current: ReferencePrice | null;
  /** Latest first. */
  history: ReferencePrice[];
}

/** The price an operator last set for a market, or null. */
export async function currentReferencePrice(q: Db | Tx, asset: string, fiat: string): Promise<ReferencePrice | null> {
  const { rows } = await q.query(
    `SELECT p.*, o.email AS created_by_email FROM reference_prices p LEFT JOIN operators o ON o.id = p.created_by
     WHERE p.asset = $1 AND p.fiat = $2 ORDER BY p.id DESC LIMIT 1`,
    [asset, fiat],
  );
  return rows[0] ? toPrice(rows[0]) : null;
}

/** Each hand-set market with its price now and its last 50 changes. */
export async function referencePriceOverview(db: Db): Promise<ReferencePriceOverview[]> {
  return Promise.all(
    REFERENCE_PRICE_MARKETS.map(async ({ asset, fiat }) => {
      const { rows } = await db.query(
        `SELECT p.*, o.email AS created_by_email FROM reference_prices p LEFT JOIN operators o ON o.id = p.created_by
         WHERE p.asset = $1 AND p.fiat = $2 ORDER BY p.id DESC LIMIT 50`,
        [asset, fiat],
      );
      const history = rows.map(toPrice);
      return { asset, fiat, current: history[0] ?? null, history };
    }),
  );
}

export interface SetReferencePriceInput {
  asset: string;
  fiat: string;
  priceMinor: bigint;
  reason: string;
}

/** Records a new price for a market. The old price stays in the history and the audit log. */
export async function setReferencePrice(
  db: Db,
  input: SetReferencePriceInput,
  operatorId: string,
): Promise<ReferencePrice> {
  const reason = input.reason.trim();
  if (!reason) throw new DomainError('invalid_request', 'Give a reason');
  if (!REFERENCE_PRICE_MARKETS.some((m) => m.asset === input.asset && m.fiat === input.fiat)) {
    throw new DomainError('invalid_request', `${input.asset}/${input.fiat} has no hand-set price`);
  }
  if (input.priceMinor <= 0n || input.priceMinor > MAX_REFERENCE_PRICE_MINOR) {
    throw new DomainError('invalid_request', 'The price must be above zero');
  }
  return withTransaction(db, async (tx) => {
    // One change at a time per market, so "before" in the audit log is the real previous price.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`reference_price:${input.asset}/${input.fiat}`]);
    const before = await currentReferencePrice(tx, input.asset, input.fiat);
    const { rows } = await tx.query(
      `INSERT INTO reference_prices (asset, fiat, price_minor, reason, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *, NULL AS created_by_email`,
      [input.asset, input.fiat, input.priceMinor.toString(), reason, operatorId],
    );
    await writeAudit(
      tx,
      { type: 'operator', id: operatorId },
      'settings.reference_price',
      { type: 'market', id: `${input.asset}/${input.fiat}` },
      { priceMinor: before?.priceMinor ?? null },
      { priceMinor: input.priceMinor, reason },
    );
    return toPrice(rows[0]);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPrice(row: any): ReferencePrice {
  return {
    id: String(row.id),
    asset: row.asset,
    fiat: row.fiat,
    priceMinor: BigInt(row.price_minor),
    reason: row.reason,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email ?? null,
    createdAt: row.created_at,
  };
}

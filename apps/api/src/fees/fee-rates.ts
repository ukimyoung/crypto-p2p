import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';

/** Highest maker fee an operator can set: 10.00%. */
export const MAX_FEE_RATE_BP = 1000;

/**
 * Maker fee on `fiatMinor`, rounded up to the next minor unit.
 * Rates are in 0.01% units, so 25 is 0.25%.
 */
export function feeOn(fiatMinor: bigint, rateBp: number): bigint {
  return (fiatMinor * BigInt(rateBp) + 9_999n) / 10_000n;
}

/** The price shown on an ad: what the maker entered plus the fee. */
export function finalPrice(priceMinor: bigint, rateBp: number): bigint {
  return priceMinor + feeOn(priceMinor, rateBp);
}

/** The maker fee rate for a market at `at`: the market's own rate, or the default. */
export async function currentFeeRate(q: Db | Tx, asset: string, fiat: string, at: Date = new Date()): Promise<number> {
  const { rows } = await q.query<{ rate_bp: number | null }>(
    `SELECT rate_bp FROM fee_rates WHERE asset = $1 AND fiat = $2 AND effective_from <= $3
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [asset, fiat, at],
  );
  if (rows[0] && rows[0].rate_bp !== null) return rows[0].rate_bp;
  return defaultFeeRate(q, at);
}

async function defaultFeeRate(q: Db | Tx, at: Date): Promise<number> {
  const { rows } = await q.query<{ rate_bp: number }>(
    `SELECT rate_bp FROM fee_rates WHERE asset IS NULL AND effective_from <= $1
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [at],
  );
  return rows[0]?.rate_bp ?? 0;
}

export interface FeeRateChange {
  id: string;
  /** Null for the default rate. */
  asset: string | null;
  fiat: string | null;
  /** Null on a market row means "use the default". */
  rateBp: number | null;
  effectiveFrom: Date;
  reason: string;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: Date;
}

export interface MarketFeeRate {
  asset: string;
  fiat: string;
  /** The market's own rate, or null when it follows the default. */
  ownRateBp: number | null;
  rateBp: number;
}

export interface FeeRateOverview {
  defaultRateBp: number;
  markets: MarketFeeRate[];
  /** Changes that take effect later, soonest first. */
  scheduled: FeeRateChange[];
  /** Latest changes first, including scheduled ones. */
  history: FeeRateChange[];
}

/** Every market (coin × fiat) with the rate in force now, plus the change history. */
export async function feeRateOverview(db: Db, now: Date = new Date()): Promise<FeeRateOverview> {
  const defaultRateBp = await defaultFeeRate(db, now);
  const { rows } = await db.query<{ asset: string; fiat: string; own: number | null; has_row: boolean }>(
    `SELECT a.code AS asset, f.code AS fiat, latest.rate_bp AS own, latest.id IS NOT NULL AS has_row
     FROM assets a CROSS JOIN fiat_currencies f
     LEFT JOIN LATERAL (
       SELECT id, rate_bp FROM fee_rates r
       WHERE r.asset = a.code AND r.fiat = f.code AND r.effective_from <= $1
       ORDER BY effective_from DESC, id DESC LIMIT 1
     ) latest ON true
     ORDER BY a.code, f.code`,
    [now],
  );
  const markets = rows.map((r) => ({
    asset: r.asset,
    fiat: r.fiat,
    ownRateBp: r.own,
    rateBp: r.own ?? defaultRateBp,
  }));
  const history = await db.query(
    `SELECT r.*, o.email AS created_by_email FROM fee_rates r LEFT JOIN operators o ON o.id = r.created_by
     ORDER BY r.effective_from DESC, r.id DESC LIMIT 100`,
  );
  const changes = history.rows.map(toChange);
  return {
    defaultRateBp,
    markets,
    scheduled: changes.filter((c) => c.effectiveFrom > now).reverse(),
    history: changes,
  };
}

export interface SetFeeRateInput {
  /** Leave both out to change the default rate. */
  asset?: string;
  fiat?: string;
  /** Null on a market sends it back to the default rate. */
  rateBp: number | null;
  /** Defaults to now. */
  effectiveFrom?: Date;
  reason: string;
}

/**
 * Adds a rate change (FEE-4). Open orders keep the rate they were created with.
 * Nothing is overwritten: the history stays in `fee_rates`.
 */
export async function setFeeRate(
  db: Db,
  input: SetFeeRateInput,
  operatorId: string,
  now: Date = new Date(),
): Promise<FeeRateChange> {
  const reason = input.reason.trim();
  if (!reason) throw new DomainError('invalid_request', 'Give a reason');
  const market = input.asset !== undefined || input.fiat !== undefined;
  if (market && (!input.asset || !input.fiat)) {
    throw new DomainError('invalid_request', 'Name both the coin and the fiat currency of the market');
  }
  if (input.rateBp === null && !market) {
    throw new DomainError('invalid_request', 'The default rate needs a value');
  }
  if (input.rateBp !== null && (!Number.isInteger(input.rateBp) || input.rateBp < 0 || input.rateBp > MAX_FEE_RATE_BP)) {
    throw new DomainError('invalid_request', 'The rate must be between 0.00% and 10.00%');
  }
  const effectiveFrom = input.effectiveFrom ?? now;
  if (effectiveFrom.getTime() < now.getTime() - 60_000) {
    throw new DomainError('invalid_request', 'A rate change cannot start in the past');
  }

  return withTransaction(db, async (tx) => {
    if (market) {
      const { rows } = await tx.query(
        'SELECT 1 FROM assets a, fiat_currencies f WHERE a.code = $1 AND f.code = $2',
        [input.asset, input.fiat],
      );
      if (!rows[0]) throw new DomainError('not_found', 'Unknown market');
    }
    const before = market ? await currentFeeRate(tx, input.asset!, input.fiat!, now) : await defaultFeeRate(tx, now);
    const { rows } = await tx.query(
      `INSERT INTO fee_rates (asset, fiat, rate_bp, effective_from, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *, NULL AS created_by_email`,
      [input.asset ?? null, input.fiat ?? null, input.rateBp, effectiveFrom, reason, operatorId],
    );
    const change = toChange(rows[0]);
    await writeAudit(
      tx,
      { type: 'operator', id: operatorId },
      'settings.fee_rate',
      { type: 'market', id: market ? `${input.asset}/${input.fiat}` : 'default' },
      { rateBp: before },
      { rateBp: input.rateBp, effectiveFrom, reason },
    );
    return change;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toChange(row: any): FeeRateChange {
  return {
    id: String(row.id),
    asset: row.asset,
    fiat: row.fiat,
    rateBp: row.rate_bp,
    effectiveFrom: row.effective_from,
    reason: row.reason,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email ?? null,
    createdAt: row.created_at,
  };
}

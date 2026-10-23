import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';

export type AssetStatus = 'active' | 'ads_paused' | 'withdrawals_paused' | 'delisted';
export type MarketStatus = 'open' | 'paused' | 'closed';

export interface AssetRow {
  code: string;
  network: string;
  decimals: number;
  status: AssetStatus;
}

export interface MarketRow {
  asset: string;
  fiat: string;
  status: MarketStatus;
  updatedAt: Date;
  updatedBy: string | null;
  onlineAds: number;
  openOrders: number;
}

/** What may happen in a market right now. */
export async function marketState(
  q: Db | Tx,
  asset: string,
  fiat: string,
): Promise<{ market: MarketStatus; asset: AssetStatus } | null> {
  const { rows } = await q.query<{ market: MarketStatus; asset: AssetStatus }>(
    `SELECT m.status AS market, a.status AS asset FROM markets m JOIN assets a ON a.code = m.asset
     WHERE m.asset = $1 AND m.fiat = $2`,
    [asset, fiat],
  );
  return rows[0] ?? null;
}

/** New ads need an open market and a coin that takes new ads. */
export async function assertCanPostAd(q: Db | Tx, asset: string, fiat: string): Promise<void> {
  const s = await marketState(q, asset, fiat);
  if (!s) throw new DomainError('market_unavailable', `${asset}/${fiat} is not a market`);
  if (s.market !== 'open' || s.asset === 'ads_paused' || s.asset === 'delisted') {
    throw new DomainError('market_unavailable', `${asset}/${fiat} is not taking new ads`);
  }
}

/** New orders need an open market and a listed coin. */
export async function assertCanTrade(q: Db | Tx, asset: string, fiat: string): Promise<void> {
  const s = await marketState(q, asset, fiat);
  if (!s || s.market !== 'open' || s.asset === 'delisted') {
    throw new DomainError('market_unavailable', `${asset}/${fiat} is not open for trading`);
  }
}

/** SQL condition for "ad `alias` is in an open market with a listed coin". */
export const IN_OPEN_MARKET = (alias: string) =>
  `EXISTS (SELECT 1 FROM markets mk JOIN assets ac ON ac.code = mk.asset
           WHERE mk.asset = ${alias}.asset AND mk.fiat = ${alias}.fiat AND mk.status = 'open' AND ac.status <> 'delisted')`;

export async function listMarkets(db: Db): Promise<{ assets: AssetRow[]; markets: MarketRow[] }> {
  const assets = await db.query('SELECT code, network, decimals, status FROM assets ORDER BY code');
  const markets = await db.query(
    `SELECT m.*,
            (SELECT count(*)::int FROM ads WHERE ads.asset = m.asset AND ads.fiat = m.fiat AND ads.status = 'online') AS online_ads,
            (SELECT count(*)::int FROM orders o WHERE o.asset = m.asset AND o.fiat = m.fiat
               AND o.status IN ('pending_payment', 'paid', 'under_review')) AS open_orders
     FROM markets m ORDER BY m.asset, m.fiat`,
  );
  return {
    assets: assets.rows,
    markets: markets.rows.map((r) => ({
      asset: r.asset,
      fiat: r.fiat,
      status: r.status,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
      onlineAds: r.online_ads,
      openOrders: r.open_orders,
    })),
  };
}

export async function setAssetStatus(
  db: Db,
  code: string,
  status: AssetStatus,
  reason: string,
  operatorId: string,
): Promise<AssetRow> {
  const text = reason.trim();
  if (!text) throw new DomainError('invalid_request', 'Give a reason');
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query('SELECT code, network, decimals, status FROM assets WHERE code = $1 FOR UPDATE', [
      code,
    ]);
    if (!rows[0]) throw new DomainError('not_found', 'Unknown coin');
    const updated = await tx.query(
      'UPDATE assets SET status = $2 WHERE code = $1 RETURNING code, network, decimals, status',
      [code, status],
    );
    await writeAudit(
      tx,
      { type: 'operator', id: operatorId },
      'market.asset_status',
      { type: 'asset', id: code },
      { status: rows[0].status },
      { status, reason: text },
    );
    return updated.rows[0];
  });
}

export async function setMarketStatus(
  db: Db,
  asset: string,
  fiat: string,
  status: MarketStatus,
  reason: string,
  operatorId: string,
): Promise<void> {
  const text = reason.trim();
  if (!text) throw new DomainError('invalid_request', 'Give a reason');
  await withTransaction(db, async (tx) => {
    const { rows } = await tx.query('SELECT status FROM markets WHERE asset = $1 AND fiat = $2 FOR UPDATE', [
      asset,
      fiat,
    ]);
    if (!rows[0]) throw new DomainError('not_found', 'Unknown market');
    await tx.query(
      'UPDATE markets SET status = $3, updated_at = now(), updated_by = $4 WHERE asset = $1 AND fiat = $2',
      [asset, fiat, status, operatorId],
    );
    await writeAudit(
      tx,
      { type: 'operator', id: operatorId },
      'market.status',
      { type: 'market', id: `${asset}/${fiat}` },
      { status: rows[0].status },
      { status, reason: text },
    );
  });
}

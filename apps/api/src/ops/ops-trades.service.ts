import { toAd } from '../ads/ads.service';
import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { finalPrice } from '../fees/fee-rates';
import { notify } from '../notifications/notify';

export const AD_SORTS = ['created_at', 'price_minor', 'remaining_amount'] as const;
export type AdSort = (typeof AD_SORTS)[number];

export interface AdListFilter {
  asset?: string;
  fiat?: string;
  side?: 'buy' | 'sell';
  status?: 'online' | 'offline' | 'closed';
  makerId?: string;
  sort?: AdSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface OrderListFilter {
  status?: string;
  asset?: string;
  /** Buyer or seller. */
  userId?: string;
  /** Whole order number, or its leading digits (e.g. a day: 20261026). */
  orderNumber?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

const ORDER_COLUMNS = `o.id, o.order_number, o.ad_id, o.maker_id, o.buyer_id, o.seller_id, o.asset, o.fiat, o.price_minor, o.base_price_minor,
  o.amount, o.fiat_amount_minor, o.fee_rate_bp, o.fee_fiat_minor, o.escrow_amount, o.status, o.created_at,
  o.paid_at, o.completed_at, o.cancelled_at, o.cancel_reason, bu.email AS buyer_email, se.email AS seller_email`;

/** Ads and orders for the operations console (ADS-1 to ADS-3, ORD-1, ORD-2). */
export class OpsTradesService {
  constructor(private readonly db: Db) {}

  async listAds(filter: AdListFilter) {
    const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 100);
    const page = Math.max(filter.page ?? 1, 1);
    const sort = AD_SORTS.includes(filter.sort as AdSort) ? filter.sort! : 'created_at';
    const dir = filter.dir === 'asc' ? 'ASC' : 'DESC';
    const { rows } = await this.db.query(
      `SELECT a.*, u.email AS maker_email, count(*) OVER () AS total_count
       FROM ads a JOIN users u ON u.id = a.maker_id
       WHERE ($1::text IS NULL OR a.asset = $1) AND ($2::text IS NULL OR a.fiat = $2)
         AND ($3::text IS NULL OR a.side = $3) AND ($4::text IS NULL OR a.status = $4)
         AND ($5::uuid IS NULL OR a.maker_id = $5)
       ORDER BY a.${sort} ${dir}, a.created_at DESC, a.id
       LIMIT $6 OFFSET $7`,
      [
        filter.asset ?? null,
        filter.fiat ?? null,
        filter.side ?? null,
        filter.status ?? null,
        filter.makerId ?? null,
        pageSize,
        (page - 1) * pageSize,
      ],
    );
    return {
      ads: rows.map((r) => ({ ...toAd(r), makerEmail: r.maker_email, createdAt: r.created_at })),
      total: Number(rows[0]?.total_count ?? 0),
    };
  }

  /** An ad with its final price at the rate it was posted with, and the orders it produced. */
  async getAd(id: string) {
    const { rows } = await this.db.query(
      'SELECT a.*, u.email AS maker_email FROM ads a JOIN users u ON u.id = a.maker_id WHERE a.id = $1',
      [id],
    );
    if (!rows[0]) throw new DomainError('not_found', 'Ad not found');
    const ad = toAd(rows[0]);
    const orders = await this.db.query(
      `SELECT ${ORDER_COLUMNS} FROM orders o JOIN users bu ON bu.id = o.buyer_id JOIN users se ON se.id = o.seller_id
       WHERE o.ad_id = $1 ORDER BY o.created_at DESC LIMIT 100`,
      [id],
    );
    return {
      ad: {
        ...ad,
        makerEmail: rows[0].maker_email,
        createdAt: rows[0].created_at,
        finalPriceMinor: finalPrice(ad.priceMinor, ad.feeRateBp),
      },
      orders: orders.rows.map(toOrderRow),
    };
  }

  /**
   * Takes an ad off the market (ADS-3): `offline` hides it, `closed` ends it. Open orders
   * carry on. The maker is told the new status, not the operator's reason.
   */
  async setAdStatus(id: string, status: 'offline' | 'closed', reason: string, operatorId: string) {
    const text = reason.trim();
    if (!text) throw new DomainError('invalid_request', 'Give a reason');
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM ads WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw new DomainError('not_found', 'Ad not found');
      const before = toAd(rows[0]);
      if (before.status === 'closed') throw new DomainError('invalid_transition', 'The ad is already closed');
      if (before.status === status) return before;
      const updated = await tx.query('UPDATE ads SET status = $2 WHERE id = $1 RETURNING *', [id, status]);
      const after = toAd(updated.rows[0]);
      await writeAudit(
        tx,
        { type: 'operator', id: operatorId },
        'ad.set_status',
        { type: 'ad', id },
        { status: before.status },
        { status, reason: text },
      );
      await notify(tx, after.makerId, 'ad.status_changed', { adId: id, asset: after.asset, status });
      return after;
    });
  }

  async listOrders(filter: OrderListFilter) {
    const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 100);
    const page = Math.max(filter.page ?? 1, 1);
    const { rows } = await this.db.query(
      `SELECT ${ORDER_COLUMNS}, count(*) OVER () AS total_count
       FROM orders o JOIN users bu ON bu.id = o.buyer_id JOIN users se ON se.id = o.seller_id
       WHERE ($1::text IS NULL OR o.status = $1) AND ($2::text IS NULL OR o.asset = $2)
         AND ($3::uuid IS NULL OR o.buyer_id = $3 OR o.seller_id = $3)
         AND ($4::timestamptz IS NULL OR o.created_at >= $4) AND ($5::timestamptz IS NULL OR o.created_at < $5)
         AND ($8::text IS NULL OR o.order_number LIKE $8 || '%')
       ORDER BY o.created_at DESC, o.id
       LIMIT $6 OFFSET $7`,
      [
        filter.status ?? null,
        filter.asset ?? null,
        filter.userId ?? null,
        filter.from ?? null,
        filter.to ?? null,
        pageSize,
        (page - 1) * pageSize,
        filter.orderNumber ?? null,
      ],
    );
    return { orders: rows.map(toOrderRow), total: Number(rows[0]?.total_count ?? 0) };
  }

  /** Order detail (ORD-2): status history, chat, ledger entries and the fee. */
  async getOrder(id: string) {
    const { rows } = await this.db.query(
      `SELECT ${ORDER_COLUMNS}, o.fee_amount, o.payment_deadline, o.fee_invoice_id
       FROM orders o JOIN users bu ON bu.id = o.buyer_id JOIN users se ON se.id = o.seller_id WHERE o.id = $1`,
      [id],
    );
    if (!rows[0]) throw new DomainError('not_found', 'Order not found');
    const [history, messages, ledger] = await Promise.all([
      this.db.query(
        `SELECT id, actor_type, actor_id, action, after->>'status' AS status, created_at FROM audit_logs
         WHERE target_type = 'order' AND target_id = $1 ORDER BY id`,
        [id],
      ),
      this.db.query('SELECT id, sender_id, body, created_at FROM order_messages WHERE order_id = $1 ORDER BY id', [id]),
      this.db.query(
        `SELECT t.idempotency_key, t.kind, t.created_at, e.amount::text AS amount, a.kind AS account_kind,
                a.asset, a.user_id, u.email
         FROM ledger_transactions t
         JOIN ledger_entries e ON e.transaction_id = t.id
         JOIN ledger_accounts a ON a.id = e.account_id
         LEFT JOIN users u ON u.id = a.user_id
         WHERE t.ref_type = 'order' AND t.ref_id = $1
         ORDER BY t.created_at, e.id`,
        [id],
      ),
    ]);
    return {
      order: {
        ...toOrderRow(rows[0]),
        feeAmount: rows[0].fee_amount,
        paymentDeadline: rows[0].payment_deadline,
        feeInvoiceId: rows[0].fee_invoice_id,
      },
      history: history.rows.map((r) => ({
        id: String(r.id),
        actorType: r.actor_type,
        actorId: r.actor_id,
        action: r.action,
        status: r.status,
        createdAt: r.created_at,
      })),
      messages: messages.rows.map((r) => ({ id: String(r.id), senderId: r.sender_id, body: r.body, createdAt: r.created_at })),
      ledger: ledger.rows.map((r) => ({
        key: r.idempotency_key,
        kind: r.kind,
        account: r.account_kind,
        asset: r.asset,
        userId: r.user_id,
        userEmail: r.email,
        amount: r.amount,
        createdAt: r.created_at,
      })),
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOrderRow(r: any) {
  return {
    id: r.id,
    orderNumber: r.order_number,
    adId: r.ad_id,
    makerId: r.maker_id,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    buyerEmail: r.buyer_email,
    sellerEmail: r.seller_email,
    asset: r.asset,
    fiat: r.fiat,
    priceMinor: r.price_minor,
    basePriceMinor: r.base_price_minor,
    amount: r.amount,
    fiatAmountMinor: r.fiat_amount_minor,
    feeRateBp: r.fee_rate_bp,
    feeFiatMinor: r.fee_fiat_minor,
    escrowAmount: r.escrow_amount,
    status: r.status,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}

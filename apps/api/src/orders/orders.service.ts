import { Actor, writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { toAd } from '../ads/ads.service';
import { Db, Tx, withTransaction } from '../db/database';
import { LedgerService, Posting } from '../ledger/ledger.service';
import { PaymentDetails, PaymentMethodsService } from '../payments/payment-methods.service';
import { nextStatus, OrderEvent, OrderRole, OrderStatus } from './order-state';

export interface OrdersConfig {
  /** Maker (advertiser) fee in basis points, charged in the traded coin. */
  makerFeeBps: number;
}

export interface Order {
  id: string;
  adId: string;
  makerId: string;
  buyerId: string;
  sellerId: string;
  asset: string;
  fiat: string;
  priceMinor: bigint;
  amount: bigint;
  fiatAmountMinor: bigint;
  feeAmount: bigint;
  escrowAmount: bigint;
  status: OrderStatus;
  paymentDeadline: Date;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  cancelReason: string | null;
  sellerPaymentMethodId: string;
}

/**
 * Order lifecycle with platform escrow (PRD section 5):
 * the seller's coins are locked when the order is created and are released to
 * the buyer only after the seller confirms the fiat payment.
 */
export class OrdersService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentMethodsService,
    private readonly config: OrdersConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Taker opens an order against an ad for `amount` coins (smallest unit).
   * On a buy ad the taker is the seller and names the account that receives the fiat.
   */
  async create(takerId: string, adId: string, amount: bigint, takerPaymentMethodId?: string): Promise<Order> {
    if (amount <= 0n) throw new DomainError('invalid_amount', 'Amount must be positive');

    return withTransaction(this.db, async (tx) => {
      const adRes = await tx.query('SELECT * FROM ads WHERE id = $1 FOR UPDATE', [adId]);
      if (!adRes.rows[0]) throw new DomainError('not_found', 'Ad not found');
      const ad = toAd(adRes.rows[0]);

      if (ad.status !== 'online') throw new DomainError('ad_unavailable', 'Ad is not online');
      if (ad.makerId === takerId) throw new DomainError('self_trade', 'Cannot trade with your own ad');
      if (amount > ad.remainingAmount) throw new DomainError('insufficient_ad_amount', 'Ad has not enough left');

      const users = await tx.query<{ id: string; status: string; kyc_level: number }>(
        'SELECT id, status, kyc_level FROM users WHERE id = ANY($1::uuid[])',
        [[takerId, ad.makerId]],
      );
      const taker = users.rows.find((u) => u.id === takerId);
      const maker = users.rows.find((u) => u.id === ad.makerId);
      if (!taker || taker.status !== 'active') throw new DomainError('user_restricted', 'Taker cannot trade');
      if (!maker || maker.status !== 'active') throw new DomainError('ad_unavailable', 'Maker cannot trade');
      if (taker.kyc_level < ad.minTakerKycLevel) {
        throw new DomainError('kyc_required', `KYC level ${ad.minTakerKycLevel} is required for this ad`);
      }

      const decimals = await assetDecimals(tx, ad.asset);
      const fiatAmountMinor = (amount * ad.priceMinor) / 10n ** BigInt(decimals);
      if (fiatAmountMinor < ad.minOrderFiatMinor || fiatAmountMinor > ad.maxOrderFiatMinor) {
        throw new DomainError('outside_order_limits', 'Order amount is outside the ad limits');
      }

      const feeAmount = (amount * BigInt(this.config.makerFeeBps)) / 10_000n;
      const makerIsSeller = ad.side === 'sell';
      const sellerId = makerIsSeller ? ad.makerId : takerId;
      const buyerId = makerIsSeller ? takerId : ad.makerId;
      // A selling maker pays the fee on top of the amount; a buying maker receives amount minus fee.
      const escrowAmount = makerIsSeller ? amount + feeAmount : amount;
      const deadline = new Date(this.now().getTime() + ad.paymentWindowMinutes * 60_000);

      const sellerPaymentMethodId = makerIsSeller ? ad.paymentMethodId : takerPaymentMethodId;
      if (!sellerPaymentMethodId) {
        throw new DomainError('payment_method_required', 'Choose the bank account that receives the payment');
      }
      await this.payments.assertUsable(tx, sellerId, sellerPaymentMethodId, ad.fiat);

      const inserted = await tx.query(
        `INSERT INTO orders (ad_id, maker_id, buyer_id, seller_id, asset, fiat, price_minor, amount,
                             fiat_amount_minor, fee_amount, escrow_amount, status, payment_deadline, created_at,
                             seller_payment_method_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_payment', $12, $13, $14)
         RETURNING *`,
        [
          ad.id,
          ad.makerId,
          buyerId,
          sellerId,
          ad.asset,
          ad.fiat,
          ad.priceMinor.toString(),
          amount.toString(),
          fiatAmountMinor.toString(),
          feeAmount.toString(),
          escrowAmount.toString(),
          deadline,
          this.now(),
          sellerPaymentMethodId,
        ],
      );
      const order = toOrder(inserted.rows[0]);

      await tx.query('UPDATE ads SET remaining_amount = remaining_amount - $2 WHERE id = $1', [
        ad.id,
        amount.toString(),
      ]);

      await this.ledger.post(tx, {
        idempotencyKey: `order:${order.id}:lock`,
        kind: 'escrow_lock',
        ref: { type: 'order', id: order.id },
        postings: [
          { account: { userId: sellerId, asset: ad.asset, kind: 'available' }, amount: -escrowAmount },
          { account: { userId: sellerId, asset: ad.asset, kind: 'escrow' }, amount: escrowAmount },
        ],
      });

      await writeAudit(tx, { type: 'user', id: takerId }, 'order.create', { type: 'order', id: order.id }, null, order);
      return order;
    });
  }

  markPaid(orderId: string, userId: string): Promise<Order> {
    return this.apply(orderId, 'mark_paid', { type: 'user', id: userId });
  }

  release(orderId: string, userId: string): Promise<Order> {
    return this.apply(orderId, 'release', { type: 'user', id: userId });
  }

  cancel(orderId: string, userId: string): Promise<Order> {
    return this.apply(orderId, 'cancel', { type: 'user', id: userId });
  }

  escalate(orderId: string, userId: string): Promise<Order> {
    return this.apply(orderId, 'escalate', { type: 'user', id: userId });
  }

  /**
   * Operator decision on an order under review. Moving escrow needs two
   * different operators (PRD section 7): one proposes, the other approves.
   * Runs in the caller's transaction so the decision record commits with it.
   */
  resolve(
    tx: Tx,
    orderId: string,
    decision: 'release' | 'refund',
    operators: { requestedBy: string; approvedBy: string },
  ): Promise<Order> {
    if (operators.requestedBy === operators.approvedBy) {
      throw new DomainError('two_person_rule', 'Requester and approver must be different operators');
    }
    return this.applyIn(tx, orderId, decision === 'release' ? 'resolve_release' : 'resolve_refund', {
      type: 'operator',
      id: operators.approvedBy,
      requestedBy: operators.requestedBy,
    });
  }

  /** Cancels every order whose payment window has passed. Run by a scheduled worker. */
  async expireDue(): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM orders WHERE status = 'pending_payment' AND payment_deadline < $1 ORDER BY payment_deadline`,
      [this.now()],
    );
    const expired: string[] = [];
    for (const { id } of rows) {
      try {
        await this.apply(id, 'expire', { type: 'system' });
        expired.push(id);
      } catch (err) {
        // The buyer paid or cancelled in the meantime.
        if (err instanceof DomainError && err.code === 'invalid_transition') continue;
        throw err;
      }
    }
    return expired;
  }

  async listForUser(userId: string, limit = 50): Promise<Order[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM orders WHERE buyer_id = $1 OR seller_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(limit, 100)],
    );
    return rows.map(toOrder);
  }

  /**
   * The seller's full bank details, for the two parties while money can still move.
   * Returns null once the order is finished.
   */
  async paymentDetails(order: Order, viewerId: string): Promise<PaymentDetails | null> {
    if (viewerId !== order.buyerId && viewerId !== order.sellerId) {
      throw new DomainError('forbidden', 'Not a party to this order');
    }
    if (!['pending_payment', 'paid', 'under_review'].includes(order.status)) return null;
    return this.payments.details(order.sellerPaymentMethodId);
  }

  async get(orderId: string): Promise<Order | null> {
    const { rows } = await this.db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    return rows[0] ? toOrder(rows[0]) : null;
  }

  private apply(orderId: string, event: OrderEvent, actor: Actor): Promise<Order> {
    return withTransaction(this.db, (tx) => this.applyIn(tx, orderId, event, actor));
  }

  private async applyIn(
    tx: Tx,
    orderId: string,
    event: OrderEvent,
    actor: Actor | { type: 'operator'; id: string; requestedBy: string },
  ): Promise<Order> {
    const res = await tx.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!res.rows[0]) throw new DomainError('not_found', 'Order not found');
    const before = toOrder(res.rows[0]);

    const role = roleOf(before, actor);
    const status = nextStatus(before.status, event, role);
    const now = this.now();

    if (event === 'mark_paid' && now > before.paymentDeadline) {
      throw new DomainError('payment_window_closed', 'The payment window has closed');
    }
    if (event === 'expire' && now <= before.paymentDeadline) {
      throw new DomainError('invalid_transition', 'The payment window is still open');
    }

    if (status === 'completed') await this.settleToBuyer(tx, before);
    if (status === 'cancelled') await this.refundSeller(tx, before);

    const updated = await tx.query(
      `UPDATE orders SET
         status = $2,
         paid_at = CASE WHEN $2 = 'paid' THEN $3 ELSE paid_at END,
         completed_at = CASE WHEN $2 = 'completed' THEN $3 ELSE completed_at END,
         cancelled_at = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancelled_at END,
         cancel_reason = CASE WHEN $2 = 'cancelled' THEN $4 ELSE cancel_reason END
       WHERE id = $1
       RETURNING *`,
      [orderId, status, now, event],
    );
    const after = toOrder(updated.rows[0]);

    const auditActor: Actor = actor.type === 'system' ? actor : { type: actor.type, id: actor.id };
    const auditAfter = 'requestedBy' in actor ? { ...after, requestedBy: actor.requestedBy } : after;
    await writeAudit(tx, auditActor, `order.${event}`, { type: 'order', id: orderId }, before, auditAfter);
    return after;
  }

  private async settleToBuyer(tx: Tx, order: Order): Promise<void> {
    const makerIsBuyer = order.makerId === order.buyerId;
    const buyerReceives = makerIsBuyer ? order.amount - order.feeAmount : order.amount;
    const postings: Posting[] = [
      { account: { userId: order.sellerId, asset: order.asset, kind: 'escrow' }, amount: -order.escrowAmount },
      { account: { userId: order.buyerId, asset: order.asset, kind: 'available' }, amount: buyerReceives },
    ];
    if (order.feeAmount > 0n) {
      postings.push({ account: { system: 'fee_revenue', asset: order.asset }, amount: order.feeAmount });
    }
    // One settle key per order: an order can leave escrow once, in one direction.
    await this.ledger.post(tx, {
      idempotencyKey: `order:${order.id}:settle`,
      kind: 'escrow_release',
      ref: { type: 'order', id: order.id },
      postings,
    });
  }

  private async refundSeller(tx: Tx, order: Order): Promise<void> {
    // Put the coins back on the ad unless it was closed in the meantime. The ad
    // row is locked before the ledger accounts, the same order `create` uses.
    await tx.query(
      `UPDATE ads SET remaining_amount = LEAST(total_amount, remaining_amount + $2)
       WHERE id = $1 AND status <> 'closed'`,
      [order.adId, order.amount.toString()],
    );
    await this.ledger.post(tx, {
      idempotencyKey: `order:${order.id}:settle`,
      kind: 'escrow_refund',
      ref: { type: 'order', id: order.id },
      postings: [
        { account: { userId: order.sellerId, asset: order.asset, kind: 'escrow' }, amount: -order.escrowAmount },
        { account: { userId: order.sellerId, asset: order.asset, kind: 'available' }, amount: order.escrowAmount },
      ],
    });
  }
}

function roleOf(order: Order, actor: Actor): OrderRole {
  if (actor.type === 'system') return 'system';
  if (actor.type === 'operator') return 'operator';
  if (actor.id === order.buyerId) return 'buyer';
  if (actor.id === order.sellerId) return 'seller';
  throw new DomainError('forbidden', 'Not a party to this order');
}

async function assetDecimals(tx: Tx, asset: string): Promise<number> {
  const { rows } = await tx.query<{ decimals: number }>('SELECT decimals FROM assets WHERE code = $1', [asset]);
  return rows[0]!.decimals;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOrder(row: any): Order {
  return {
    id: row.id,
    adId: row.ad_id,
    makerId: row.maker_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    asset: row.asset,
    fiat: row.fiat,
    priceMinor: BigInt(row.price_minor),
    amount: BigInt(row.amount),
    fiatAmountMinor: BigInt(row.fiat_amount_minor),
    feeAmount: BigInt(row.fee_amount),
    escrowAmount: BigInt(row.escrow_amount),
    status: row.status,
    paymentDeadline: row.payment_deadline,
    paidAt: row.paid_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    cancelReason: row.cancel_reason,
    sellerPaymentMethodId: row.seller_payment_method_id,
  };
}

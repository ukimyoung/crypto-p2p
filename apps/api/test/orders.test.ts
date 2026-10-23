import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdsService, CreateAdInput } from '../src/ads/ads.service';
import { Db, withTransaction } from '../src/db/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { addBankAccount, BTC, createUser, deposit, setupDb, testSecretBox } from './helpers';

const PRICE = 100_000_000n; // 100,000,000 KRW per BTC
const CENTI = BTC / 100n; // 0.01 BTC = 1,000,000 KRW at PRICE
const FEE_BP = 25; // 0.25%, in 0.01% units
const FEE = 2_500n; // 0.25% of 1,000,000 KRW

describe('OrdersService', () => {
  let db: Db;
  let ads: AdsService;
  let orders: OrdersService;
  let payments: PaymentMethodsService;
  let clock: Date;
  const ledger = new LedgerService();

  const available = (userId: string) => ledger.balance(db, { userId, asset: 'BTC', kind: 'available' });
  const escrow = (userId: string) => ledger.balance(db, { userId, asset: 'BTC', kind: 'escrow' });
  const feeRevenue = () => ledger.balance(db, { system: 'fee_revenue', asset: 'BTC' });
  const remaining = async (adId: string) =>
    BigInt((await db.query('SELECT remaining_amount FROM ads WHERE id = $1', [adId])).rows[0].remaining_amount);
  const minutes = (n: number) => {
    clock = new Date(clock.getTime() + n * 60_000);
  };

  function adInput(makerId: string, overrides: Partial<CreateAdInput> = {}): CreateAdInput {
    return {
      makerId,
      side: 'sell',
      asset: 'BTC',
      fiat: 'KRW',
      priceMinor: PRICE,
      totalAmount: BTC,
      minOrderFiatMinor: 10_000n,
      maxOrderFiatMinor: 10_000_000n,
      paymentWindowMinutes: 15,
      ...overrides,
    };
  }

  /** A funded seller with a sell ad, and a buyer. */
  async function sellAdScenario(sellerBalance = 2n * BTC) {
    const seller = await createUser(db);
    const buyer = await createUser(db);
    await deposit(db, ledger, seller, 'BTC', sellerBalance);
    const paymentMethodId = await addBankAccount(db, payments, seller);
    const ad = await ads.create(adInput(seller, { paymentMethodId }));
    return { seller, buyer, ad };
  }

  beforeAll(async () => {
    db = await setupDb();
    payments = new PaymentMethodsService(db, testSecretBox(), { cooldownHours: 0 }, () => clock);
    ads = new AdsService(db, payments);
    orders = new OrdersService(db, ledger, payments, () => clock);
    await db.query(
      `INSERT INTO fee_rates (asset, fiat, rate_bp, effective_from, reason) VALUES ('BTC', 'KRW', $1, '2026-01-01', 'test')`,
      [FEE_BP],
    );
  });
  beforeEach(() => {
    clock = new Date('2026-10-22T00:00:00Z');
  });
  afterAll(async () => {
    expect(await ledger.findMismatchedAccounts(db)).toEqual([]);
    await db.end();
  });

  it('completes a sell-ad trade: escrow is locked, then released to the buyer', async () => {
    const { seller, buyer, ad } = await sellAdScenario();

    const order = await orders.create(buyer, ad.id, CENTI);
    // The fee is added to the price and paid in KRW; no coins are taken.
    expect(order).toMatchObject({
      status: 'pending_payment',
      buyerId: buyer,
      sellerId: seller,
      basePriceMinor: PRICE,
      priceMinor: 100_250_000n,
      feeRateBp: FEE_BP,
      feeFiatMinor: FEE,
      fiatAmountMinor: 1_000_000n + FEE,
      feeAmount: 0n,
      escrowAmount: CENTI,
    });
    expect(await escrow(seller)).toBe(CENTI);
    expect(await available(seller)).toBe(2n * BTC - CENTI);
    expect(await remaining(ad.id)).toBe(BTC - CENTI);

    minutes(5);
    expect((await orders.markPaid(order.id, buyer)).status).toBe('paid');
    const done = await orders.release(order.id, seller);

    expect(done.status).toBe('completed');
    expect(await available(buyer)).toBe(CENTI);
    expect(await escrow(seller)).toBe(0n);
    expect(await feeRevenue()).toBe(0n);
  });

  it('on a buy ad the taker sells, and the buying maker pays the fee in KRW', async () => {
    const maker = await createUser(db);
    const taker = await createUser(db);
    await deposit(db, ledger, taker, 'BTC', BTC);
    const ad = await ads.create(adInput(maker, { side: 'buy' }));
    const feeBefore = await feeRevenue();

    await expect(orders.create(taker, ad.id, CENTI)).rejects.toMatchObject({ code: 'payment_method_required' });
    const takerAccount = await addBankAccount(db, payments, taker);
    const order = await orders.create(taker, ad.id, CENTI, takerAccount);
    expect(order).toMatchObject({
      buyerId: maker,
      sellerId: taker,
      escrowAmount: CENTI,
      sellerPaymentMethodId: takerAccount,
      fiatAmountMinor: 1_000_000n + FEE,
      feeFiatMinor: FEE,
    });
    await orders.markPaid(order.id, maker);
    await orders.release(order.id, taker);

    expect(await available(maker)).toBe(CENTI);
    expect(await available(taker)).toBe(BTC - CENTI);
    expect((await feeRevenue()) - feeBefore).toBe(0n);
  });

  it('buyer cancel returns escrow to the seller and the amount to the ad', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);

    const cancelled = await orders.cancel(order.id, buyer);

    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'cancel' });
    expect(await available(seller)).toBe(2n * BTC);
    expect(await escrow(seller)).toBe(0n);
    expect(await remaining(ad.id)).toBe(BTC);
  });

  it('expires unpaid orders after the payment window', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);

    minutes(10);
    expect(await orders.expireDue()).not.toContain(order.id);

    minutes(6);
    await expect(orders.markPaid(order.id, buyer)).rejects.toMatchObject({ code: 'payment_window_closed' });
    expect(await orders.expireDue()).toContain(order.id);
    expect((await orders.get(order.id))?.status).toBe('cancelled');
    expect(await available(seller)).toBe(2n * BTC);
  });

  it('does not expire an order the buyer already marked paid', async () => {
    const { buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(order.id, buyer);

    minutes(60);
    expect(await orders.expireDue()).not.toContain(order.id);
    expect((await orders.get(order.id))?.status).toBe('paid');
  });

  it('only lets each party do their own steps', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const stranger = await createUser(db);
    const order = await orders.create(buyer, ad.id, CENTI);

    await expect(orders.release(order.id, buyer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(orders.cancel(order.id, seller)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(orders.markPaid(order.id, stranger)).rejects.toMatchObject({ code: 'forbidden' });

    await orders.markPaid(order.id, buyer);
    await expect(orders.cancel(order.id, buyer)).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('cannot release twice', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);
    await orders.release(order.id, seller);

    await expect(orders.release(order.id, seller)).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(await available(buyer)).toBe(CENTI);
  });

  it('lets one operator settle an escalated order', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const operator = await createUser(db);
    const order = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(order.id, buyer);
    expect((await orders.escalate(order.id, buyer)).status).toBe('under_review');

    await expect(orders.release(order.id, seller)).rejects.toMatchObject({ code: 'invalid_transition' });
    const resolved = await withTransaction(db, (tx) => orders.resolve(tx, order.id, 'release', operator));
    expect(resolved.status).toBe('completed');
    expect(await available(buyer)).toBe(CENTI);

    const audit = await db.query(
      "SELECT actor_type, actor_id FROM audit_logs WHERE target_id = $1 AND action = 'order.resolve_release'",
      [order.id],
    );
    expect(audit.rows).toEqual([{ actor_type: 'operator', actor_id: operator }]);
  });

  it('refunds the seller when operators decide against the buyer', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(order.id, buyer);
    await orders.escalate(order.id, seller);

    const operator = await createUser(db);
    await withTransaction(db, (tx) => orders.resolve(tx, order.id, 'refund', operator));

    expect(await available(seller)).toBe(2n * BTC);
    expect(await available(buyer)).toBe(0n);
  });

  it('enforces ad rules when opening an order', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const noKyc = await createUser(db, 0);

    await expect(orders.create(seller, ad.id, CENTI)).rejects.toMatchObject({ code: 'self_trade' });
    await expect(orders.create(noKyc, ad.id, CENTI)).rejects.toMatchObject({ code: 'kyc_required' });
    await expect(orders.create(buyer, ad.id, 1000n)).rejects.toMatchObject({ code: 'outside_order_limits' });
    await expect(orders.create(buyer, ad.id, 2n * BTC)).rejects.toMatchObject({ code: 'insufficient_ad_amount' });
  });

  it('rolls back the order when the seller cannot fund escrow', async () => {
    const { buyer, ad } = await sellAdScenario(CENTI / 2n);

    await expect(orders.create(buyer, ad.id, CENTI)).rejects.toMatchObject({ code: 'insufficient_balance' });
    expect(await remaining(ad.id)).toBe(BTC);
    const { rowCount } = await db.query('SELECT 1 FROM orders WHERE ad_id = $1', [ad.id]);
    expect(rowCount).toBe(0);
  });

  it('never oversells an ad or the seller balance under concurrent orders', async () => {
    // Seller can fund at most 5 orders of 0.01 BTC but the ad offers 1 BTC.
    const { seller, ad } = await sellAdScenario(5n * CENTI);
    const buyers = await Promise.all(Array.from({ length: 12 }, () => createUser(db)));

    const results = await Promise.allSettled(buyers.map((b) => orders.create(b, ad.id, CENTI)));

    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(5);
    expect(await available(seller)).toBe(0n);
    expect(await remaining(ad.id)).toBe(BTC - 5n * CENTI);
  });

  it('lets only one of a concurrent release and dispute-free cancel win', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);

    const [release, cancel] = await Promise.allSettled([
      orders.release(order.id, seller),
      orders.cancel(order.id, buyer),
    ]);

    expect([release.status, cancel.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
    const final = await orders.get(order.id);
    if (final?.status === 'completed') {
      expect(await available(buyer)).toBe(CENTI);
      expect(await available(seller)).toBe(2n * BTC - CENTI);
    } else {
      expect(final?.status).toBe('cancelled');
      expect(await available(buyer)).toBe(0n);
      expect(await available(seller)).toBe(2n * BTC);
    }
    expect(await escrow(seller)).toBe(0n);
  });

  it('records every order step in the audit log', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(order.id, buyer);
    await orders.release(order.id, seller);

    const { rows } = await db.query('SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY id', [order.id]);
    expect(rows.map((r) => r.action)).toEqual(['order.create', 'order.mark_paid', 'order.release']);
    await expect(db.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });

  it('sends a paid order to review when the seller does not release within 10 minutes', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const late = await orders.create(buyer, ad.id, CENTI);
    const onTime = await orders.create(buyer, ad.id, CENTI);
    const unpaid = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(late.id, buyer);
    await orders.markPaid(onTime.id, buyer);

    minutes(9);
    expect(await orders.autoReviewDue()).not.toContain(late.id);
    await orders.release(onTime.id, seller);
    minutes(1);
    const moved = await orders.autoReviewDue();
    expect(moved).toContain(late.id);
    expect(moved).not.toContain(onTime.id);
    expect(moved).not.toContain(unpaid.id);
    expect(await orders.get(late.id)).toMatchObject({ status: 'under_review', reviewSource: 'system', escalatedAt: clock });
    expect(await escrow(seller)).toBe(2n * CENTI); // late + unpaid stay locked

    const { rows } = await db.query(
      `SELECT user_id, data->>'reason' AS reason FROM notifications WHERE type = 'order.under_review' AND data->>'orderId' = $1`,
      [late.id],
    );
    expect(rows.map((r) => r.user_id).sort()).toEqual([buyer, seller].sort());
    expect(rows.every((r) => r.reason === 'auto_review')).toBe(true);
    const audit = await db.query(`SELECT actor_type FROM audit_logs WHERE target_id = $1 AND action = 'order.auto_review'`, [
      late.id,
    ]);
    expect(audit.rows).toEqual([{ actor_type: 'system' }]);
  });

  it('uses the wait set by operators and records who escalated', async () => {
    await db.query(`UPDATE ops_settings SET value = '30' WHERE key = 'orders.auto_review_minutes'`);
    const { buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(order.id, buyer);
    minutes(10);
    expect(await orders.autoReviewDue()).not.toContain(order.id);
    minutes(20);
    expect(await orders.autoReviewDue()).toContain(order.id);
    await db.query(`UPDATE ops_settings SET value = '10' WHERE key = 'orders.auto_review_minutes'`);

    const other = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(other.id, buyer);
    expect(await orders.escalate(other.id, buyer)).toMatchObject({ status: 'under_review', reviewSource: 'buyer' });
  });
});

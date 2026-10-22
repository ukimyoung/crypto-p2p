import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdsService, CreateAdInput } from '../src/ads/ads.service';
import { Db } from '../src/db/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { addBankAccount, BTC, createUser, deposit, setupDb, testSecretBox } from './helpers';

const PRICE = 100_000_000n; // 100,000,000 KRW per BTC
const CENTI = BTC / 100n; // 0.01 BTC = 1,000,000 KRW at PRICE
const FEE_BPS = 10; // 0.1%

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
    orders = new OrdersService(db, ledger, payments, { makerFeeBps: FEE_BPS }, () => clock);
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
    const fee = (CENTI * BigInt(FEE_BPS)) / 10_000n;
    expect(order).toMatchObject({
      status: 'pending_payment',
      buyerId: buyer,
      sellerId: seller,
      fiatAmountMinor: 1_000_000n,
      feeAmount: fee,
      escrowAmount: CENTI + fee,
    });
    expect(await escrow(seller)).toBe(CENTI + fee);
    expect(await available(seller)).toBe(2n * BTC - CENTI - fee);
    expect(await remaining(ad.id)).toBe(BTC - CENTI);

    minutes(5);
    expect((await orders.markPaid(order.id, buyer)).status).toBe('paid');
    const done = await orders.release(order.id, seller);

    expect(done.status).toBe('completed');
    expect(await available(buyer)).toBe(CENTI);
    expect(await escrow(seller)).toBe(0n);
    expect(await feeRevenue()).toBe(fee);
  });

  it('on a buy ad the taker sells, and the buying maker pays the fee', async () => {
    const maker = await createUser(db);
    const taker = await createUser(db);
    await deposit(db, ledger, taker, 'BTC', BTC);
    const ad = await ads.create(adInput(maker, { side: 'buy' }));
    const feeBefore = await feeRevenue();

    await expect(orders.create(taker, ad.id, CENTI)).rejects.toMatchObject({ code: 'payment_method_required' });
    const takerAccount = await addBankAccount(db, payments, taker);
    const order = await orders.create(taker, ad.id, CENTI, takerAccount);
    expect(order).toMatchObject({ buyerId: maker, sellerId: taker, escrowAmount: CENTI, sellerPaymentMethodId: takerAccount });
    await orders.markPaid(order.id, maker);
    await orders.release(order.id, taker);

    const fee = (CENTI * BigInt(FEE_BPS)) / 10_000n;
    expect(await available(maker)).toBe(CENTI - fee);
    expect(await available(taker)).toBe(BTC - CENTI);
    expect((await feeRevenue()) - feeBefore).toBe(fee);
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

  it('settles an escalated order only with two different operators', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const opA = await createUser(db);
    const opB = await createUser(db);
    const order = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(order.id, buyer);
    expect((await orders.escalate(order.id, buyer)).status).toBe('under_review');

    await expect(orders.release(order.id, seller)).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(() => orders.resolve(order.id, 'release', { requestedBy: opA, approvedBy: opA })).toThrow(
      /different operators/,
    );

    const resolved = await orders.resolve(order.id, 'release', { requestedBy: opA, approvedBy: opB });
    expect(resolved.status).toBe('completed');
    expect(await available(buyer)).toBe(CENTI);

    const audit = await db.query(
      "SELECT actor_type, actor_id, after->>'requestedBy' AS requested_by FROM audit_logs WHERE target_id = $1 AND action = 'order.resolve_release'",
      [order.id],
    );
    expect(audit.rows).toEqual([{ actor_type: 'operator', actor_id: opB, requested_by: opA }]);
  });

  it('refunds the seller when operators decide against the buyer', async () => {
    const { seller, buyer, ad } = await sellAdScenario();
    const order = await orders.create(buyer, ad.id, CENTI);
    await orders.markPaid(order.id, buyer);
    await orders.escalate(order.id, seller);

    await orders.resolve(order.id, 'refund', { requestedBy: await createUser(db), approvedBy: await createUser(db) });

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
    // Seller can fund at most 5 orders of 0.01 BTC (+fee) but the ad offers 1 BTC.
    const { seller, ad } = await sellAdScenario(5n * CENTI + 5n * ((CENTI * BigInt(FEE_BPS)) / 10_000n));
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
    const fee = (CENTI * BigInt(FEE_BPS)) / 10_000n;
    if (final?.status === 'completed') {
      expect(await available(buyer)).toBe(CENTI);
      expect(await available(seller)).toBe(2n * BTC - CENTI - fee);
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
});

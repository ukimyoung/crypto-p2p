import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdsService, CreateAdInput } from '../src/ads/ads.service';
import { Db } from '../src/db/database';
import { BillingService, onFeeHold } from '../src/fees/billing.service';
import { currentFeeRate, feeOn, feeRateOverview, finalPrice, setFeeRate } from '../src/fees/fee-rates';
import { LedgerService } from '../src/ledger/ledger.service';
import { updateSettings } from '../src/ops/ops-settings';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { addBankAccount, BTC, createUser, deposit, setupDb, testSecretBox } from './helpers';

const PRICE = 100_000_000n; // KRW per BTC
const TENTH = BTC / 10n; // 0.1 BTC = 10,000,000 KRW at PRICE
const OPERATOR = '00000000-0000-4000-8000-0000000000f1';

describe('maker fees and billing', () => {
  let db: Db;
  let ads: AdsService;
  let orders: OrdersService;
  let payments: PaymentMethodsService;
  let billing: BillingService;
  let clock: Date;
  const ledger = new LedgerService();
  const at = (iso: string) => {
    clock = new Date(iso);
  };
  const notifications = async (userId: string) =>
    (await db.query('SELECT type, data FROM notifications WHERE user_id = $1 ORDER BY created_at, id', [userId])).rows;

  function adInput(makerId: string, overrides: Partial<CreateAdInput> = {}): CreateAdInput {
    return {
      makerId,
      side: 'sell',
      asset: 'BTC',
      fiat: 'KRW',
      priceMinor: PRICE,
      totalAmount: BTC,
      minOrderFiatMinor: 10_000n,
      maxOrderFiatMinor: 50_000_000n,
      ...overrides,
    };
  }

  async function seller() {
    const maker = await createUser(db);
    await deposit(db, ledger, maker, 'BTC', 2n * BTC);
    const paymentMethodId = await addBankAccount(db, payments, maker);
    const ad = await ads.create(adInput(maker, { paymentMethodId }));
    return { maker, ad };
  }

  async function trade(adId: string, sellerId: string, amount = TENTH) {
    const buyer = await createUser(db);
    const order = await orders.create(buyer, adId, amount);
    await orders.markPaid(order.id, buyer);
    return orders.release(order.id, sellerId);
  }

  beforeAll(async () => {
    db = await setupDb();
    payments = new PaymentMethodsService(db, testSecretBox(), { cooldownHours: 0 }, () => clock);
    ads = new AdsService(db, payments);
    orders = new OrdersService(db, ledger, payments, () => clock);
    billing = new BillingService(db, () => clock);
    await db.query(
      `INSERT INTO operators (id, email, name, role, password_hash, otp_secret_enc)
       VALUES ($1, 'fees@ops.test', 'fees', 'reviewer', 'x', 'x')`,
      [OPERATOR],
    );
  });
  beforeEach(() => at('2026-10-22T00:00:00Z'));
  afterAll(async () => {
    expect(await ledger.findMismatchedAccounts(db)).toEqual([]);
    await db.end();
  });

  it('adds the fee to the price and rounds the KRW fee up', () => {
    expect(finalPrice(100_000_000n, 25)).toBe(100_250_000n);
    expect(feeOn(10_000_000n, 25)).toBe(25_000n);
    expect(feeOn(1_001n, 25)).toBe(3n); // 2.5025 -> 3
    expect(feeOn(1_000_000n, 0)).toBe(0n);
  });

  it('keeps rate history: default, market rate, scheduled change, back to default', async () => {
    const now = new Date();
    expect(await currentFeeRate(db, 'BTC', 'KRW', now)).toBe(0);
    await expect(setFeeRate(db, { rateBp: 1001, reason: 'x' }, OPERATOR, now)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(setFeeRate(db, { rateBp: 10, reason: ' ' }, OPERATOR, now)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(setFeeRate(db, { asset: 'BTC', rateBp: 10, reason: 'x' }, OPERATOR, now)).rejects.toMatchObject({
      code: 'invalid_request',
    });

    await setFeeRate(db, { rateBp: 10, reason: '기본 0.1%' }, OPERATOR, now);
    await setFeeRate(db, { asset: 'ETH', fiat: 'KRW', rateBp: 30, reason: 'ETH 0.3%' }, OPERATOR, now);
    const later = new Date(now.getTime() + 86_400_000);
    await setFeeRate(db, { asset: 'ETH', fiat: 'KRW', rateBp: null, effectiveFrom: later, reason: '기본으로' }, OPERATOR, now);

    expect(await currentFeeRate(db, 'BTC', 'KRW', now)).toBe(10);
    expect(await currentFeeRate(db, 'ETH', 'KRW', now)).toBe(30);
    expect(await currentFeeRate(db, 'ETH', 'KRW', new Date(later.getTime() + 1000))).toBe(10);

    const overview = await feeRateOverview(db, now);
    expect(overview.defaultRateBp).toBe(10);
    expect(overview.markets.find((m) => m.asset === 'ETH' && m.fiat === 'KRW')).toMatchObject({ ownRateBp: 30, rateBp: 30 });
    expect(overview.markets.find((m) => m.asset === 'BTC' && m.fiat === 'KRW')).toMatchObject({ ownRateBp: null, rateBp: 10 });
    expect(overview.scheduled).toHaveLength(1);
    expect(overview.scheduled[0]).toMatchObject({ asset: 'ETH', rateBp: null, createdByEmail: 'fees@ops.test' });

    const { rows } = await db.query(`SELECT * FROM audit_logs WHERE action = 'settings.fee_rate' AND target_id = 'ETH/KRW'`);
    expect(rows[0]).toMatchObject({ before: { rateBp: 10 }, after: { rateBp: 30, reason: 'ETH 0.3%' } });

    // BTC/KRW at 0.25% for the tests below, whose clock is set before today.
    await db.query(
      `INSERT INTO fee_rates (asset, fiat, rate_bp, effective_from, reason) VALUES ('BTC', 'KRW', 25, '2026-01-01', 'test')`,
    );
  });

  it('shows the final price on the market and fixes the rate on the order', async () => {
    const { maker, ad } = await seller();
    const listed = (await ads.list({ asset: 'BTC', fiat: 'KRW', side: 'sell' })).find((a) => a.id === ad.id);
    expect(listed).toMatchObject({ priceMinor: PRICE, feeRateBp: 25, finalPriceMinor: 100_250_000n });

    const buyer = await createUser(db);
    const order = await orders.create(buyer, ad.id, TENTH);
    expect(order).toMatchObject({ fiatAmountMinor: 10_025_000n, feeFiatMinor: 25_000n, feeRateBp: 25 });

    // A later rate change leaves the open order alone.
    await setFeeRate(db, { asset: 'BTC', fiat: 'KRW', rateBp: 50, reason: 'up' }, OPERATOR, new Date());
    await orders.markPaid(order.id, buyer);
    expect(await orders.release(order.id, maker)).toMatchObject({ status: 'completed', feeFiatMinor: 25_000n });
    await setFeeRate(db, { asset: 'BTC', fiat: 'KRW', rateBp: 25, reason: 'back' }, OPERATOR, new Date());
  });

  it('keeps the rate an ad was posted with when the rate changes', async () => {
    const { ad: before } = await seller();
    expect(before.feeRateBp).toBe(25);

    await setFeeRate(db, { asset: 'BTC', fiat: 'KRW', rateBp: 50, reason: 'up' }, OPERATOR, new Date());
    const { ad: after } = await seller();
    expect(after.feeRateBp).toBe(50);

    const listed = await ads.list({ asset: 'BTC', fiat: 'KRW', side: 'sell' });
    expect(listed.find((a) => a.id === before.id)).toMatchObject({ feeRateBp: 25, finalPriceMinor: 100_250_000n });
    expect(listed.find((a) => a.id === after.id)).toMatchObject({ feeRateBp: 50, finalPriceMinor: 100_500_000n });

    // An order on the older ad costs what the market showed for it.
    const order = await orders.create(await createUser(db), before.id, TENTH);
    expect(order).toMatchObject({ feeRateBp: 25, feeFiatMinor: 25_000n, priceMinor: 100_250_000n });
    await orders.cancel(order.id, order.buyerId);

    await setFeeRate(db, { asset: 'BTC', fiat: 'KRW', rateBp: 25, reason: 'back' }, OPERATOR, new Date());
    await db.query(`UPDATE ads SET status = 'closed' WHERE id = ANY($1::uuid[])`, [[before.id, after.id]]);
  });

  it('bills each maker once a month ends, reminds, marks overdue and lifts the hold on payment', async () => {
    const a = await seller();
    const b = await seller();
    await trade(a.ad.id, a.maker); // 25,000
    await trade(a.ad.id, a.maker, BTC / 100n); // 1,000,000 KRW -> 2,500
    await trade(b.ad.id, b.maker); // 25,000
    // A cancelled order has no fee.
    const buyer = await createUser(db);
    const cancelled = await orders.create(buyer, a.ad.id, TENTH);
    await orders.cancel(cancelled.id, buyer);

    // 23:00 on 31 October in Korea: the month has not ended yet.
    at('2026-10-31T14:00:00Z');
    expect(await billing.issueInvoices()).toBe(0);

    // Midnight on 1 November in Korea.
    at('2026-10-31T15:00:00Z');
    expect((await billing.run()).issued).toBeGreaterThanOrEqual(2);
    expect(await billing.issueInvoices()).toBe(0); // nothing billed twice

    const mine = await billing.forMaker(a.maker);
    expect(mine.unbilled).toEqual([]);
    expect(mine.invoices).toHaveLength(1);
    const invoice = mine.invoices[0]!;
    expect(invoice).toMatchObject({
      fiat: 'KRW',
      totalMinor: 27_500n,
      paidMinor: 0n,
      status: 'issued',
      periodStart: new Date('2026-09-30T15:00:00Z'),
      periodEnd: new Date('2026-10-31T15:00:00Z'),
      // Due date 8 November (7 days after issue), so due at its end in Korea time.
      dueAt: new Date('2026-11-08T15:00:00Z'),
    });
    const detail = await billing.get(invoice.id);
    expect(detail!.orders.map((o) => o.feeFiatMinor).sort()).toEqual([2_500n, 25_000n]);
    expect((await notifications(a.maker)).map((n) => n.type)).toContain('fee.invoice_issued');

    // Reminders the day before and on the due date, once each.
    at('2026-11-06T16:00:00Z');
    await billing.run();
    at('2026-11-07T16:00:00Z');
    await billing.run();
    await billing.run();
    const reminders = (await notifications(a.maker)).filter((n) => n.type === 'fee.invoice_due_soon');
    expect(reminders.map((n) => n.data.when)).toEqual(['tomorrow', 'today']);

    // A partial payment before the due date.
    const partial = await billing.recordPayment(
      invoice.id,
      { amountMinor: 7_500n, paidAt: clock, memo: '1차 입금' },
      OPERATOR,
    );
    expect(partial.invoice).toMatchObject({ status: 'partially_paid', paidMinor: 7_500n });
    await expect(
      billing.recordPayment(invoice.id, { amountMinor: 20_001n, paidAt: clock, memo: '' }, OPERATOR),
    ).rejects.toMatchObject({ code: 'invalid_amount' });

    // Past the due date: overdue, ads hidden, no new ads or orders.
    at('2026-11-08T15:00:00Z');
    expect((await billing.run()).overdue).toBeGreaterThanOrEqual(1);
    expect((await billing.get(invoice.id))!.invoice.status).toBe('overdue');
    expect(await onFeeHold(db, a.maker)).toBe(true);
    expect((await ads.list({ asset: 'BTC', fiat: 'KRW', side: 'sell' })).some((ad) => ad.makerId === a.maker)).toBe(false);
    await expect(orders.create(await createUser(db), a.ad.id, TENTH)).rejects.toMatchObject({ code: 'ad_unavailable' });
    await expect(ads.create(adInput(a.maker, { side: 'buy' }))).rejects.toMatchObject({ code: 'fee_overdue' });

    const summary = await billing.summary(new Date('2026-10-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'));
    expect(summary.makers.find((m) => m.makerId === a.maker)).toMatchObject({ outstandingMinor: 20_000n, overdueMinor: 20_000n });

    // Another partial payment keeps it overdue; paying the rest lifts the hold.
    expect(
      (await billing.recordPayment(invoice.id, { amountMinor: 10_000n, paidAt: clock, memo: '' }, OPERATOR)).invoice.status,
    ).toBe('overdue');
    const paid = await billing.recordPayment(invoice.id, { amountMinor: 10_000n, paidAt: clock, memo: '완납' }, OPERATOR);
    expect(paid.invoice).toMatchObject({ status: 'paid', paidMinor: 27_500n });
    expect(paid.payments.map((p) => p.amountMinor)).toEqual([7_500n, 10_000n, 10_000n]);
    expect(await onFeeHold(db, a.maker)).toBe(false);
    expect((await ads.list({ asset: 'BTC', fiat: 'KRW', side: 'sell' })).some((ad) => ad.makerId === a.maker)).toBe(true);
    await expect(
      billing.recordPayment(invoice.id, { amountMinor: 1n, paidAt: clock, memo: '' }, OPERATOR),
    ).rejects.toMatchObject({ code: 'invalid_transition' });

    const { rows } = await db.query(
      `SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY id`,
      [invoice.id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'fee.invoice_issue',
      'fee.payment_record',
      'fee.invoice_overdue',
      'fee.payment_record',
      'fee.payment_record',
    ]);
  });

  it('bills daily when the cycle is set to daily', async () => {
    await updateSettings(db, { 'billing.cycle': 'daily', 'billing.due_days': 3 }, OPERATOR, '일 청구로 변경');
    await expect(updateSettings(db, { 'billing.due_days': 0 }, OPERATOR, 'x')).rejects.toMatchObject({
      code: 'invalid_request',
    });

    at('2026-12-01T03:00:00Z'); // 12:00 on 1 December in Korea
    const { maker, ad } = await seller();
    await trade(ad.id, maker);

    at('2026-12-01T14:59:00Z');
    expect(await billing.issueInvoices()).toBe(0);
    at('2026-12-01T15:00:00Z'); // midnight, 2 December
    expect(await billing.issueInvoices()).toBe(1);
    const [invoice] = (await billing.forMaker(maker)).invoices;
    expect(invoice).toMatchObject({
      totalMinor: 25_000n,
      periodStart: new Date('2026-11-30T15:00:00Z'),
      periodEnd: new Date('2026-12-01T15:00:00Z'),
      dueAt: new Date('2026-12-05T15:00:00Z'), // due 5 December
    });
    await updateSettings(db, { 'billing.cycle': 'monthly', 'billing.due_days': 7 }, OPERATOR, '원복');
  });
});

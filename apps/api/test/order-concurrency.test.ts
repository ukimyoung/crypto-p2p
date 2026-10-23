import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdsService, CreateAdInput } from '../src/ads/ads.service';
import { Db } from '../src/db/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { Order, OrdersService } from '../src/orders/orders.service';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { addBankAccount, BTC, createUser, deposit, setupDb, TEST_DATABASE_URL, testSecretBox } from './helpers';

const PRICE = 100_000_000n; // 100,000,000 KRW per BTC
const CENTI = BTC / 100n; // 0.01 BTC = 1,000,000 KRW at PRICE

/** Order states that still hold (or have consumed) part of the ad. */
const RESERVING = ['pending_payment', 'paid', 'under_review', 'completed'];

/**
 * An ad's remaining amount is the one thing every taker races for. These tests
 * make the ad, not the seller's balance, the binding limit, and line up real
 * Postgres transactions on the ad row before letting them go, so the guard in
 * OrdersService.create is exercised under true contention.
 */
describe('Concurrent orders against one ad', () => {
  let db: Db;
  let ads: AdsService;
  let orders: OrdersService;
  let payments: PaymentMethodsService;
  const ledger = new LedgerService();
  const clock = new Date('2026-10-22T00:00:00Z');

  const remaining = async (adId: string) =>
    BigInt((await db.query('SELECT remaining_amount FROM ads WHERE id = $1', [adId])).rows[0].remaining_amount);
  const escrow = (userId: string) => ledger.balance(db, { userId, asset: 'BTC', kind: 'escrow' });

  /** Sum of order amounts that still count against the ad. */
  async function reserved(adId: string): Promise<bigint> {
    const { rows } = await db.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM orders WHERE ad_id = $1 AND status = ANY($2::text[])',
      [adId, RESERVING],
    );
    return BigInt(rows[0].total);
  }

  function adInput(makerId: string, overrides: Partial<CreateAdInput>): CreateAdInput {
    return {
      makerId,
      side: 'sell',
      asset: 'BTC',
      fiat: 'KRW',
      priceMinor: PRICE,
      totalAmount: BTC,
      minOrderFiatMinor: 10_000n,
      maxOrderFiatMinor: 100_000_000n,
      paymentWindowMinutes: 15,
      ...overrides,
    };
  }

  /** A sell ad of `total` from a seller who could fund far more than that. */
  async function sellAd(total: bigint) {
    const seller = await createUser(db);
    await deposit(db, ledger, seller, 'BTC', 10n * BTC);
    const paymentMethodId = await addBankAccount(db, payments, seller);
    const ad = await ads.create(adInput(seller, { totalAmount: total, paymentMethodId }));
    return { seller, ad };
  }

  /**
   * Holds the ad row lock on a separate connection, starts `run`, waits until
   * `expectedWaiters` transactions are queued behind the lock, then lets them
   * all go at once. Without the wait, the "concurrent" calls could just as well
   * run one after another and prove nothing.
   */
  async function contend<T>(adId: string, expectedWaiters: number, run: () => Promise<T>): Promise<T> {
    const gate = new Client({ connectionString: TEST_DATABASE_URL });
    await gate.connect();
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT 1 FROM ads WHERE id = $1 FOR UPDATE', [adId]);
      const pending = run();
      await waitForLockWaiters(gate, expectedWaiters);
      await gate.query('COMMIT');
      return await pending;
    } finally {
      await gate.end();
    }
  }

  async function waitForLockWaiters(client: Client, n: number) {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if (rows[0].n >= n) return;
      if (Date.now() > deadline) throw new Error(`Only ${rows[0].n} of ${n} transactions queued on the ad`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  function split(results: PromiseSettledResult<Order>[]) {
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
    return { ok, failed };
  }

  beforeAll(async () => {
    db = await setupDb();
    payments = new PaymentMethodsService(db, testSecretBox(), { cooldownHours: 0 }, () => clock);
    ads = new AdsService(db, payments);
    orders = new OrdersService(db, ledger, payments, () => clock);
  });
  afterAll(async () => {
    expect(await ledger.findMismatchedAccounts(db)).toEqual([]);
    await db.end();
  });

  it('fills an ad exactly once when more takers arrive than it can serve', async () => {
    const { seller, ad } = await sellAd(5n * CENTI);
    const buyers = await Promise.all(Array.from({ length: 15 }, () => createUser(db)));

    const results = await contend(ad.id, buyers.length, () =>
      Promise.allSettled(buyers.map((b) => orders.create(b, ad.id, CENTI))),
    );

    const { ok, failed } = split(results);
    expect(ok).toHaveLength(5);
    // Losers get the domain error, not a raw constraint violation from the database.
    expect(failed).toHaveLength(10);
    for (const err of failed) expect(err).toMatchObject({ code: 'insufficient_ad_amount' });
    expect(await remaining(ad.id)).toBe(0n);
    expect(await reserved(ad.id)).toBe(5n * CENTI);
    expect(await escrow(seller)).toBe(5n * CENTI);
  });

  it('never reserves more than the ad holds with uneven order sizes', async () => {
    const total = 10n * CENTI;
    const { seller, ad } = await sellAd(total);
    const amounts = Array.from({ length: 15 }, (_, i) => BigInt((i % 4) + 1) * CENTI); // 1..4 CENTI, 37 in all
    const buyers = await Promise.all(amounts.map(() => createUser(db)));

    const results = await contend(ad.id, buyers.length, () =>
      Promise.allSettled(buyers.map((b, i) => orders.create(b, ad.id, amounts[i]!))),
    );

    const { ok, failed } = split(results);
    const filled = ok.reduce((sum, o) => sum + o.amount, 0n);
    const left = await remaining(ad.id);
    expect(filled).toBeLessThanOrEqual(total);
    expect(left).toBe(total - filled);
    expect(await reserved(ad.id)).toBe(filled);
    expect(await escrow(seller)).toBe(ok.reduce((sum, o) => sum + o.escrowAmount, 0n));
    for (const err of failed) expect(err).toMatchObject({ code: 'insufficient_ad_amount' });
    // Nothing was turned away that would still have fit.
    results.forEach((r, i) => {
      if (r.status === 'rejected') expect(amounts[i]!).toBeGreaterThan(left);
    });
  });

  it('fills a buy ad once when many sellers race to take it', async () => {
    const maker = await createUser(db);
    const ad = await ads.create(adInput(maker, { side: 'buy', totalAmount: 3n * CENTI }));
    const sellers = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const id = await createUser(db);
        await deposit(db, ledger, id, 'BTC', BTC);
        return { id, account: await addBankAccount(db, payments, id) };
      }),
    );

    const results = await contend(ad.id, sellers.length, () =>
      Promise.allSettled(sellers.map((s) => orders.create(s.id, ad.id, CENTI, s.account))),
    );

    const { ok, failed } = split(results);
    expect(ok).toHaveLength(3);
    for (const err of failed) expect(err).toMatchObject({ code: 'insufficient_ad_amount' });
    expect(await remaining(ad.id)).toBe(0n);
    // Only the three winners have coins locked.
    const locked = await Promise.all(sellers.map((s) => escrow(s.id)));
    expect(locked.filter((b) => b > 0n)).toHaveLength(3);
  });

  it('keeps remaining + reserved equal to the total while orders are cancelled and created at once', async () => {
    const total = 5n * CENTI;
    const { ad } = await sellAd(total);
    const open = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const buyer = await createUser(db);
        return orders.create(buyer, ad.id, CENTI);
      }),
    );
    expect(await remaining(ad.id)).toBe(0n);

    for (let round = 0; round < 5; round++) {
      // Cancel two live orders while ten new buyers try to take their place.
      const toCancel = open.splice(0, 2);
      const room = (await remaining(ad.id)) / CENTI + BigInt(toCancel.length);
      const newcomers = await Promise.all(Array.from({ length: 10 }, () => createUser(db)));
      const [cancels, creates] = await Promise.all([
        Promise.allSettled(toCancel.map((o) => orders.cancel(o.id, o.buyerId))),
        Promise.allSettled(newcomers.map((b) => orders.create(b, ad.id, CENTI))),
      ]);

      expect(cancels.every((r) => r.status === 'fulfilled')).toBe(true);
      const { ok, failed } = split(creates);
      for (const err of failed) expect(err).toMatchObject({ code: 'insufficient_ad_amount' });
      expect(BigInt(ok.length)).toBeLessThanOrEqual(room);
      open.push(...ok);

      const left = await remaining(ad.id);
      expect(left).toBeGreaterThanOrEqual(0n);
      expect(left + (await reserved(ad.id))).toBe(total);
    }
  });

  it('rejects a negative remaining amount in the database as a last line of defence', async () => {
    const { ad } = await sellAd(CENTI);
    await expect(
      db.query('UPDATE ads SET remaining_amount = remaining_amount - $2 WHERE id = $1', [ad.id, (2n * CENTI).toString()]),
    ).rejects.toThrow(/check constraint/);
  });
});

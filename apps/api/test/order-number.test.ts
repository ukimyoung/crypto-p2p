import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdsService } from '../src/ads/ads.service';
import { Db, withTransaction } from '../src/db/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { addBankAccount, BTC, createUser, deposit, setupDb, testSecretBox } from './helpers';

const CENTI = BTC / 100n;

describe('Order numbers', () => {
  let db: Db;
  let ads: AdsService;
  let orders: OrdersService;
  let payments: PaymentMethodsService;
  let clock: Date;
  const ledger = new LedgerService();

  /** A buyer and a seller with a sell ad of their own, so orders don't wait on one ad row. */
  async function scenario() {
    const seller = await createUser(db);
    const buyer = await createUser(db);
    await deposit(db, ledger, seller, 'BTC', BTC);
    const paymentMethodId = await addBankAccount(db, payments, seller);
    const ad = await ads.create({
      makerId: seller,
      side: 'sell',
      asset: 'BTC',
      fiat: 'KRW',
      priceMinor: 100_000_000n,
      totalAmount: BTC,
      minOrderFiatMinor: 10_000n,
      maxOrderFiatMinor: 100_000_000n,
      paymentWindowMinutes: 15,
      paymentMethodId,
    });
    return { buyer, ad };
  }

  const order = async () => {
    const { buyer, ad } = await scenario();
    return orders.create(buyer, ad.id, CENTI);
  };

  beforeAll(async () => {
    db = await setupDb();
    payments = new PaymentMethodsService(db, testSecretBox(), { cooldownHours: 0 }, () => clock);
    ads = new AdsService(db, payments);
    orders = new OrdersService(db, ledger, payments, () => clock);
  });
  afterAll(async () => {
    await db.end();
  });

  it('numbers orders by their Korea-time date and starts again at 0001 each day', async () => {
    clock = new Date('2026-10-25T14:59:00Z'); // 23:59 on the 25th in Korea
    expect((await order()).orderNumber).toBe('202610250001');
    expect((await order()).orderNumber).toBe('202610250002');

    clock = new Date('2026-10-25T15:00:00Z'); // midnight on the 26th in Korea
    expect((await order()).orderNumber).toBe('202610260001');
    expect((await order()).orderNumber).toBe('202610260002');

    const created = await order();
    expect((await orders.get(created.id))?.orderNumber).toBe('202610260003');
  });

  it('gives orders placed at the same moment different numbers, with no gaps', async () => {
    clock = new Date('2026-10-27T03:00:00Z');
    const setups = await Promise.all(Array.from({ length: 12 }, scenario));
    const created = await Promise.all(setups.map(({ buyer, ad }) => orders.create(buyer, ad.id, CENTI)));
    const numbers = created.map((o) => o.orderNumber).sort();
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => `20261027${String(i + 1).padStart(4, '0')}`));
  });

  it('gives back the number of an order that failed', async () => {
    clock = new Date('2026-10-28T03:00:00Z');
    await expect(
      withTransaction(db, async (tx) => {
        await tx.query('SELECT next_order_number($1)', [clock]);
        throw new Error('order failed after taking a number');
      }),
    ).rejects.toThrow();
    expect((await order()).orderNumber).toBe('202610280001');
  });

  it('grows to five digits after the 9,999th order of a day', async () => {
    clock = new Date('2026-10-29T03:00:00Z');
    await db.query(`INSERT INTO order_number_counters (day, last) VALUES ('2026-10-29', 9998)`);
    expect((await order()).orderNumber).toBe('202610299999');
    expect((await order()).orderNumber).toBe('2026102910000');
  });
});

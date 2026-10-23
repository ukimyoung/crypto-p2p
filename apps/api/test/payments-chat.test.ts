import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdsService } from '../src/ads/ads.service';
import { AppConfig } from '../src/config';
import { Db } from '../src/db/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { OrderExpiryWorker } from '../src/orders/expiry.worker';
import { OrderChatService } from '../src/orders/order-chat.service';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { addBankAccount, BTC, createUser, deposit, setupDb, testSecretBox } from './helpers';

const COOLDOWN_HOURS = 24;

describe('payment methods, order chat and expiry', () => {
  let db: Db;
  let clock: Date;
  let payments: PaymentMethodsService;
  let ads: AdsService;
  let orders: OrdersService;
  let chat: OrderChatService;
  const ledger = new LedgerService();
  const hours = (n: number) => {
    clock = new Date(clock.getTime() + n * 3_600_000);
  };

  async function openOrder() {
    const seller = await createUser(db);
    const buyer = await createUser(db);
    await deposit(db, ledger, seller, 'BTC', BTC);
    const paymentMethodId = await addBankAccount(db, payments, seller);
    hours(COOLDOWN_HOURS);
    const ad = await ads.create({
      makerId: seller,
      side: 'sell',
      asset: 'BTC',
      fiat: 'KRW',
      priceMinor: 100_000_000n,
      totalAmount: BTC,
      minOrderFiatMinor: 10_000n,
      maxOrderFiatMinor: 10_000_000n,
      paymentMethodId,
    });
    const order = await orders.create(buyer, ad.id, BTC / 100n);
    return { seller, buyer, ad, order };
  }

  beforeAll(async () => {
    db = await setupDb();
    const now = () => clock;
    payments = new PaymentMethodsService(db, testSecretBox(), { cooldownHours: COOLDOWN_HOURS }, now);
    ads = new AdsService(db, payments);
    orders = new OrdersService(db, ledger, payments, now);
    chat = new OrderChatService(db, now);
  });
  beforeEach(() => {
    clock = new Date('2026-10-22T00:00:00Z');
  });
  afterAll(async () => {
    await db.end();
  });

  describe('bank accounts', () => {
    it('requires KYC and an account in the user’s own name', async () => {
      const user = await createUser(db);
      const input = { fiat: 'KRW', bankCode: '004', accountHolder: '김철수', accountNumber: '123-456-789012' };
      await expect(payments.addBankAccount(user, input)).rejects.toMatchObject({ code: 'kyc_required' });

      await db.query("UPDATE users SET legal_name = '홍길동' WHERE id = $1", [user]);
      await expect(payments.addBankAccount(user, input)).rejects.toMatchObject({ code: 'holder_name_mismatch' });

      const added = await payments.addBankAccount(user, { ...input, accountHolder: ' 홍 길동 ' });
      expect(added).toMatchObject({ accountHolder: '홍길동', accountMasked: '****9012', bankCode: '004' });
    });

    it('validates bank code and account number', async () => {
      const user = await createUser(db);
      await db.query("UPDATE users SET legal_name = 'Jane Doe' WHERE id = $1", [user]);
      const base = { fiat: 'KRW', bankCode: '004', accountHolder: 'JANE DOE', accountNumber: '12345678' };
      await expect(payments.addBankAccount(user, { ...base, bankCode: 'KB' })).rejects.toMatchObject({
        code: 'invalid_bank',
      });
      await expect(payments.addBankAccount(user, { ...base, accountNumber: '12ab' })).rejects.toMatchObject({
        code: 'invalid_account',
      });
      await expect(payments.addBankAccount(user, base)).resolves.toMatchObject({ accountHolder: 'Jane Doe' });
    });

    it('stores the account number encrypted', async () => {
      const user = await createUser(db);
      const id = await addBankAccount(db, payments, user);
      const { rows } = await db.query('SELECT account_number_enc FROM payment_methods WHERE id = $1', [id]);
      expect(rows[0].account_number_enc).toMatch(/^v1\./);
      expect((await payments.details(id)).accountNumber).toMatch(/^1002\d{8}$/);
    });

    it('cannot receive payments during the cooldown or after removal', async () => {
      const seller = await createUser(db);
      const paymentMethodId = await addBankAccount(db, payments, seller);
      const ad = {
        makerId: seller,
        side: 'sell' as const,
        asset: 'BTC',
        fiat: 'KRW',
        priceMinor: 100_000_000n,
        totalAmount: BTC,
        minOrderFiatMinor: 10_000n,
        maxOrderFiatMinor: 10_000_000n,
        paymentMethodId,
      };
      await expect(ads.create(ad)).rejects.toMatchObject({ code: 'payment_method_cooldown' });
      hours(COOLDOWN_HOURS);
      await expect(ads.create(ad)).resolves.toMatchObject({ paymentMethodId });

      await payments.remove(seller, paymentMethodId);
      expect(await payments.list(seller)).toEqual([]);
      await expect(ads.create(ad)).rejects.toMatchObject({ code: 'payment_method_invalid' });
    });

    it('rejects someone else’s account on an ad', async () => {
      const owner = await createUser(db);
      const other = await createUser(db);
      const paymentMethodId = await addBankAccount(db, payments, owner);
      hours(COOLDOWN_HOURS);
      await expect(
        ads.create({
          makerId: other,
          side: 'sell',
          asset: 'BTC',
          fiat: 'KRW',
          priceMinor: 1n,
          totalAmount: 1n,
          minOrderFiatMinor: 1n,
          maxOrderFiatMinor: 1n,
          paymentMethodId,
        }),
      ).rejects.toMatchObject({ code: 'payment_method_invalid' });
    });
  });

  describe('order payment details', () => {
    it('shows the seller’s account to the parties only while the order is open', async () => {
      const { seller, buyer, order } = await openOrder();
      const stranger = await createUser(db);

      const details = await orders.paymentDetails(order, buyer);
      expect(details).toMatchObject({ bankCode: '004', accountHolder: '홍길동' });
      await expect(orders.paymentDetails(order, stranger)).rejects.toMatchObject({ code: 'forbidden' });

      const done = await orders.release(order.id, seller);
      expect(await orders.paymentDetails(done, buyer)).toBeNull();
    });
  });

  describe('order chat', () => {
    it('lets only the parties talk and read', async () => {
      const { seller, buyer, order } = await openOrder();
      const stranger = await createUser(db);

      const first = await chat.post(order.id, buyer, '  입금했습니다  ');
      await chat.post(order.id, seller, '확인 중입니다');
      expect(first.body).toBe('입금했습니다');

      const all = await chat.list(order.id, seller);
      expect(all.map((m) => m.body)).toEqual(['입금했습니다', '확인 중입니다']);
      expect((await chat.list(order.id, buyer, first.id)).map((m) => m.body)).toEqual(['확인 중입니다']);

      await expect(chat.post(order.id, stranger, 'hi')).rejects.toMatchObject({ code: 'not_found' });
      await expect(chat.list(order.id, stranger)).rejects.toMatchObject({ code: 'not_found' });
      await expect(chat.post(order.id, buyer, '   ')).rejects.toMatchObject({ code: 'invalid_message' });
      await expect(db.query('DELETE FROM order_messages')).rejects.toThrow(/append-only/);
    });
  });

  describe('expiry worker', () => {
    it('cancels unpaid orders past the deadline on each tick', async () => {
      const { seller, order } = await openOrder();
      const worker = new OrderExpiryWorker(orders, { orderExpiryIntervalSeconds: 0 } as AppConfig);

      await worker.tick();
      expect((await orders.get(order.id))?.status).toBe('pending_payment');

      clock = new Date(clock.getTime() + 16 * 60_000);
      await worker.tick();
      expect((await orders.get(order.id))?.status).toBe('cancelled');
      expect(await ledger.balance(db, { userId: seller, asset: 'BTC', kind: 'available' })).toBe(BTC);
    });
  });
});

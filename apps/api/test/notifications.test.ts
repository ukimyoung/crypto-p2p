import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdsService } from '../src/ads/ads.service';
import { AppConfig } from '../src/config';
import { Db } from '../src/db/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { EmailSender, EmailWorker } from '../src/notifications/email.worker';
import { NotificationsService } from '../src/notifications/notifications.service';
import { OrderChatService } from '../src/orders/order-chat.service';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { DEFAULT_WALLET_CONFIG } from '../src/wallet/wallet-config';
import { WalletService } from '../src/wallet/wallet.service';
import { addBankAccount, BTC, deposit, setupDb, testSecretBox } from './helpers';

const OPERATOR = '00000000-0000-4000-8000-0000000000aa';

describe('notifications', () => {
  let db: Db;
  let clock: Date;
  let payments: PaymentMethodsService;
  let ads: AdsService;
  let orders: OrdersService;
  let chat: OrderChatService;
  let wallet: WalletService;
  let notifications: NotificationsService;
  const ledger = new LedgerService();
  let seq = 0;

  async function user(locale: 'ko' | 'en' = 'ko', email: string | null = `u${++seq}@example.com`) {
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO users (email, kyc_level, locale) VALUES ($1, 1, $2) RETURNING id',
      [email, locale],
    );
    return rows[0]!.id;
  }

  const types = async (userId: string) =>
    (await notifications.list(userId)).notifications.map((n) => n.type).reverse();
  const emails = async (userId: string) =>
    (
      await db.query(
        `SELECT e.subject, e.body FROM email_outbox e JOIN notifications n ON n.id = e.notification_id
         WHERE n.user_id = $1 ORDER BY e.id`,
        [userId],
      )
    ).rows;

  async function openOrder(sellerLocale: 'ko' | 'en' = 'ko') {
    const seller = await user(sellerLocale);
    const buyer = await user();
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
      maxOrderFiatMinor: 10_000_000n,
      paymentMethodId,
    });
    const order = await orders.create(buyer, ad.id, BTC / 100n);
    return { seller, buyer, ad, order };
  }

  beforeAll(async () => {
    db = await setupDb();
    const now = () => clock;
    payments = new PaymentMethodsService(db, testSecretBox(), { cooldownHours: 0 }, now);
    ads = new AdsService(db, payments);
    orders = new OrdersService(db, ledger, payments, now);
    chat = new OrderChatService(db, now);
    wallet = new WalletService(db, ledger, { ...DEFAULT_WALLET_CONFIG, addressCooldownHours: 0 }, now);
    notifications = new NotificationsService(db, now);
  });
  beforeEach(() => {
    clock = new Date('2026-10-22T00:00:00Z');
  });
  afterAll(async () => {
    await db.end();
  });

  describe('orders', () => {
    it('tells each party what the other did, not what they did themselves', async () => {
      const { seller, buyer, order } = await openOrder('en');
      expect(await types(seller)).toEqual(['order.created']);
      expect(await types(buyer)).toEqual([]);

      await chat.post(order.id, buyer, '송금했습니다');
      await orders.markPaid(order.id, buyer);
      await orders.release(order.id, seller);

      expect(await types(seller)).toEqual(['order.created', 'order.message', 'order.paid']);
      expect(await types(buyer)).toEqual(['order.completed']);
      const [created] = (await notifications.list(seller)).notifications.reverse();
      expect(created!.data).toMatchObject({ orderId: order.id, asset: 'BTC', amount: '1000000', fiatAmountMinor: '1000000' });

      // Emails go out in each user's language; chat messages stay in the app.
      expect(await emails(seller)).toEqual([
        {
          subject: `[P2P] New order on your ad (${order.orderNumber})`,
          body: expect.stringContaining('0.01 BTC'),
        },
        { subject: expect.stringContaining('marked the order as paid'), body: expect.any(String) },
      ]);
      expect(await emails(buyer)).toEqual([
        { subject: `[P2P] 거래가 완료되었습니다 (${order.orderNumber})`, body: '0.01 BTC 거래가 완료되었습니다.' },
      ]);
    });

    it('tells both parties when the system cancels an order', async () => {
      const { seller, buyer } = await openOrder();
      clock = new Date(clock.getTime() + 16 * 60_000);
      await orders.expireDue();
      expect(await types(seller)).toEqual(['order.created', 'order.cancelled']);
      expect(await types(buyer)).toEqual(['order.cancelled']);
      const [cancelled] = (await notifications.list(buyer)).notifications;
      expect(cancelled!.data.reason).toBe('expire');
    });

    it('writes nothing when the change itself fails', async () => {
      const { seller, buyer, ad } = await openOrder();
      await expect(orders.create(buyer, ad.id, 2n * BTC)).rejects.toMatchObject({ code: 'insufficient_ad_amount' });
      expect(await types(seller)).toEqual(['order.created']);
    });
  });

  describe('withdrawals and accounts', () => {
    it('reports review outcomes and sends, but not automatic approval', async () => {
      const userId = await user();
      await deposit(db, ledger, userId, 'BTC', BTC);
      const address = await wallet.setAddress(userId, { asset: 'BTC', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' });
      const small = await wallet.requestWithdrawal(userId, address.id, BTC / 100n);
      expect(await types(userId)).toEqual([]);

      await wallet.markSent(small.id, 'f00d');
      const big = await wallet.requestWithdrawal(userId, address.id, BTC / 2n);
      await wallet.reject(big.id, OPERATOR, '자금 출처 소명 필요');
      expect(await types(userId)).toEqual(['withdrawal.sent', 'withdrawal.rejected']);

      const mail = await emails(userId);
      expect(mail[0].body).toBe(
        '0.01 BTC을(를) bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq 주소로 보냈습니다. 거래 해시: f00d',
      );
      expect(mail[1].body).toContain('사유: 자금 출처 소명 필요');
    });

    it('skips the email for users without an address', async () => {
      const userId = await user('ko', null);
      await deposit(db, ledger, userId, 'BTC', BTC);
      const address = await wallet.setAddress(userId, { asset: 'BTC', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' });
      const w = await wallet.requestWithdrawal(userId, address.id, BTC / 100n);
      await wallet.markFailed(w.id, 'node down');
      expect(await types(userId)).toEqual(['withdrawal.failed']);
      expect(await emails(userId)).toEqual([]);
    });
  });

  describe('reading', () => {
    it('counts unread and marks read up to an id, per user', async () => {
      const { seller, buyer, order } = await openOrder();
      await chat.post(order.id, buyer, 'a');
      await chat.post(order.id, buyer, 'b');
      expect(await notifications.unreadCount(seller)).toBe(3);

      const [newest, middle] = (await notifications.list(seller)).notifications;
      await notifications.markRead(seller, middle!.id);
      expect(await notifications.unreadCount(seller)).toBe(1);
      await notifications.markRead(buyer, newest!.id); // someone else's ids do nothing
      expect(await notifications.unreadCount(seller)).toBe(1);
      await notifications.markRead(seller, newest!.id);
      expect((await notifications.list(seller)).unread).toBe(0);
    });
  });

  // Outbox rows are stamped by the database clock, so the worker runs on real time here.
  describe('email worker', () => {
    const config = { emailIntervalSeconds: 0 } as AppConfig;

    it('sends pending emails once', async () => {
      await db.query("UPDATE email_outbox SET status = 'sent'");
      await openOrder();
      const sent: string[] = [];
      const sender: EmailSender = { send: async (m) => void sent.push(m.to) };
      const worker = new EmailWorker(db, sender, config);
      expect(await worker.tick(new Date())).toBe(1);
      expect(await worker.tick(new Date())).toBe(0);
      expect(sent).toHaveLength(1);
      const { rows } = await db.query("SELECT count(*)::int AS n FROM email_outbox WHERE status = 'pending'");
      expect(rows[0].n).toBe(0);
    });

    it('retries with backoff and gives up after five tries', async () => {
      await db.query("UPDATE email_outbox SET status = 'sent'");
      await openOrder();
      const worker = new EmailWorker(db, { send: async () => Promise.reject(new Error('smtp down')) }, config);
      let t = Date.now();
      for (let i = 0; i < 5; i++) {
        await worker.tick(new Date(t));
        t += 16 * 60_000;
      }
      const { rows } = await db.query(
        "SELECT status, attempts, last_error FROM email_outbox WHERE status <> 'sent' ORDER BY id DESC LIMIT 1",
      );
      expect(rows[0]).toEqual({ status: 'failed', attempts: 5, last_error: 'Error: smtp down' });

      // Between tries the email is left alone.
      await db.query("UPDATE email_outbox SET status = 'pending', attempts = 1, next_attempt_at = $1", [
        new Date(Date.now() + 60_000),
      ]);
      const ok = new EmailWorker(db, { send: async () => {} }, config);
      expect(await ok.tick(new Date())).toBe(0);
    });
  });
});

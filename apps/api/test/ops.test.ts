import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdsService } from '../src/ads/ads.service';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { codeAt, counterAt } from '../src/auth/totp';
import { Db } from '../src/db/database';
import { configureApp } from '../src/http/configure';
import { LedgerService } from '../src/ledger/ledger.service';
import { OperatorAuthService, OperatorRole } from '../src/ops/operator-auth.service';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { WalletService } from '../src/wallet/wallet.service';
import { addBankAccount, BTC, createUser, deposit, setupDb, TEST_DATABASE_URL } from './helpers';

const PASSWORD = 'operator password 1';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('operations console', () => {
  let app: INestApplication;
  let db: Db;
  const ledger = new LedgerService();
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  let reviewerA: string;
  let reviewerAId: string;
  let reviewerB: string;
  let support: string;

  async function operator(email: string, role: OperatorRole): Promise<{ id: string; token: string }> {
    const name = email.split('@')[0]!;
    const created = await app.get(OperatorAuthService).create({ email, name, role, password: PASSWORD });
    const res = await http()
      .post('/ops/auth/login')
      .send({ email, password: PASSWORD, otp: codeAt(created.otpSecret, counterAt(new Date())) })
      .expect(200);
    return { id: created.operator.id, token: res.body.token };
  }

  /** A customer holding 1 BTC with a whitelisted address. */
  async function customer(): Promise<{ id: string; addressId: string }> {
    const id = await createUser(db);
    await deposit(db, ledger, id, 'BTC', BTC);
    const address = await app.get(WalletService).addAddress(id, { asset: 'BTC', address: ADDRESS });
    return { id, addressId: address.id };
  }

  /** An order the buyer marked paid and escalated. */
  async function dispute() {
    const seller = await createUser(db);
    const buyer = await createUser(db);
    await deposit(db, ledger, seller, 'BTC', BTC);
    const paymentMethodId = await addBankAccount(db, app.get(PaymentMethodsService), seller);
    const ad = await app.get(AdsService).create({
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
    const orders = app.get(OrdersService);
    const order = await orders.create(buyer, ad.id, BTC / 100n);
    await orders.markPaid(order.id, buyer);
    await orders.escalate(order.id, buyer);
    return { seller, buyer, orderId: order.id };
  }

  beforeAll(async () => {
    db = await setupDb();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.OTP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.MAKER_FEE_BPS = '0';
    process.env.PAYMENT_METHOD_COOLDOWN_HOURS = '0';
    process.env.ORDER_EXPIRY_INTERVAL_SECONDS = '0';
    process.env.ADDRESS_COOLDOWN_HOURS = '0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    const a = await operator('alice@ops.test', 'reviewer');
    reviewerA = a.token;
    reviewerAId = a.id;
    reviewerB = (await operator('bob@ops.test', 'reviewer')).token;
    support = (await operator('sam@ops.test', 'support')).token;
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  describe('login', () => {
    it('always needs a fresh OTP code and keeps staff and customer sessions apart', async () => {
      const created = await app.get(OperatorAuthService).create({
        email: 'otp@ops.test',
        name: 'otp',
        role: 'support',
        password: PASSWORD,
      });
      const noOtp = await http()
        .post('/ops/auth/login')
        .send({ email: 'otp@ops.test', password: PASSWORD })
        .expect(400);
      expect(noOtp.body.error.code).toBe('invalid_request');
      const wrong = await http()
        .post('/ops/auth/login')
        .send({ email: 'otp@ops.test', password: PASSWORD, otp: '000000' })
        .expect(401);
      expect(wrong.body.error.code).toBe('invalid_credentials');

      const code = codeAt(created.otpSecret, counterAt(new Date()));
      const ok = await http().post('/ops/auth/login').send({ email: 'otp@ops.test', password: PASSWORD, otp: code });
      expect(ok.status).toBe(200);
      // The same code cannot be used twice.
      await http().post('/ops/auth/login').send({ email: 'otp@ops.test', password: PASSWORD, otp: code }).expect(401);

      const me = await http().get('/ops/me').set(bearer(ok.body.token)).expect(200);
      expect(me.body.operator).toMatchObject({ email: 'otp@ops.test', role: 'support' });
      expect(me.body.operator).not.toHaveProperty('password_hash');

      // An operator token is not a customer session, and the other way round.
      await http().get('/me').set(bearer(ok.body.token)).expect(401);
      const user = await app.get(AuthService).signUp('customer@example.com', 'customer password 1');
      const userToken = await app.get(AuthService).login(user.email, 'customer password 1', undefined, {});
      await http().get('/ops/me').set(bearer(userToken)).expect(401);

      await http().post('/ops/auth/logout').set(bearer(ok.body.token)).expect(204);
      await http().get('/ops/me').set(bearer(ok.body.token)).expect(401);
    });
  });

  describe('withdrawal review', () => {
    it('lets reviewers approve or reject, but not support staff', async () => {
      const { id, addressId } = await customer();
      const wallet = app.get(WalletService);
      const first = await wallet.requestWithdrawal(id, addressId, BTC / 2n);
      const second = await wallet.requestWithdrawal(id, addressId, BTC / 4n);

      const queue = await http().get('/ops/withdrawals').set(bearer(support)).expect(200);
      expect(queue.body.withdrawals.map((w: { id: string }) => w.id)).toEqual(
        expect.arrayContaining([first.id, second.id]),
      );
      const summary = await http().get('/ops/summary').set(bearer(support)).expect(200);
      expect(summary.body.pendingWithdrawals).toBeGreaterThanOrEqual(2);

      const denied = await http().post(`/ops/withdrawals/${first.id}/approve`).set(bearer(support)).expect(403);
      expect(denied.body.error.code).toBe('forbidden');

      const approved = await http().post(`/ops/withdrawals/${first.id}/approve`).set(bearer(reviewerA)).expect(200);
      expect(approved.body.withdrawal.status).toBe('approved');

      await http().post(`/ops/withdrawals/${second.id}/reject`).set(bearer(reviewerA)).send({}).expect(400);
      const rejected = await http()
        .post(`/ops/withdrawals/${second.id}/reject`)
        .set(bearer(reviewerA))
        .send({ note: '출처 확인 필요' })
        .expect(200);
      expect(rejected.body.withdrawal).toMatchObject({ status: 'rejected', reviewNote: '출처 확인 필요' });
      expect(await ledger.balance(db, { userId: id, asset: 'BTC', kind: 'available' })).toBe(
        BTC - BTC / 2n - first.fee,
      );
    });
  });

  describe('disputes', () => {
    it('moves escrow only after a second operator approves', async () => {
      const { buyer, orderId } = await dispute();

      const list = await http().get('/ops/disputes').set(bearer(support)).expect(200);
      expect(list.body.disputes.map((d: { order: { id: string } }) => d.order.id)).toContain(orderId);

      await http()
        .post(`/ops/disputes/${orderId}/proposals`)
        .set(bearer(support))
        .send({ decision: 'release', reason: '입금 확인' })
        .expect(403);
      const proposed = await http()
        .post(`/ops/disputes/${orderId}/proposals`)
        .set(bearer(reviewerA))
        .send({ decision: 'release', reason: '은행 거래내역으로 입금 확인' })
        .expect(201);
      const proposalId = proposed.body.resolution.id;

      const again = await http()
        .post(`/ops/disputes/${orderId}/proposals`)
        .set(bearer(reviewerB))
        .send({ decision: 'refund', reason: '반대 의견' })
        .expect(409);
      expect(again.body.error.code).toBe('proposal_pending');

      const self = await http().post(`/ops/proposals/${proposalId}/approve`).set(bearer(reviewerA)).expect(409);
      expect(self.body.error.code).toBe('two_person_rule');
      expect(await ledger.balance(db, { userId: buyer, asset: 'BTC', kind: 'available' })).toBe(0n);

      const approved = await http().post(`/ops/proposals/${proposalId}/approve`).set(bearer(reviewerB)).expect(200);
      expect(approved.body.order.status).toBe('completed');
      expect(approved.body.resolution.status).toBe('approved');
      expect(await ledger.balance(db, { userId: buyer, asset: 'BTC', kind: 'available' })).toBe(BTC / 100n);

      const view = await http().get(`/ops/disputes/${orderId}`).set(bearer(support)).expect(200);
      expect(view.body.resolutions).toHaveLength(1);
      expect(view.body.operatorNames[reviewerAId]).toBe('alice');
      expect(view.body.buyer.id).toBe(buyer);

      const audit = await http().get('/ops/audit').query({ targetId: orderId }).set(bearer(support)).expect(200);
      const actions = audit.body.entries.map((e: { action: string }) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['dispute.propose', 'order.resolve_release', 'dispute.approve']));
    });

    it('lets a proposal be declined and replaced', async () => {
      const { seller, orderId } = await dispute();
      const first = await http()
        .post(`/ops/disputes/${orderId}/proposals`)
        .set(bearer(reviewerA))
        .send({ decision: 'release', reason: '증빙 부족' })
        .expect(201);
      await http().post(`/ops/proposals/${first.body.resolution.id}/decline`).set(bearer(reviewerA)).expect(200);
      await http().post(`/ops/proposals/${first.body.resolution.id}/approve`).set(bearer(reviewerB)).expect(409);

      const second = await http()
        .post(`/ops/disputes/${orderId}/proposals`)
        .set(bearer(reviewerB))
        .send({ decision: 'refund', reason: '구매자 입금 내역 없음' })
        .expect(201);
      const done = await http()
        .post(`/ops/proposals/${second.body.resolution.id}/approve`)
        .set(bearer(reviewerA))
        .expect(200);
      expect(done.body.order.status).toBe('cancelled');
      expect(await ledger.balance(db, { userId: seller, asset: 'BTC', kind: 'available' })).toBe(BTC);
    });
  });

  describe('customer accounts', () => {
    it('finds customers and restricts them with a reason', async () => {
      const auth = app.get(AuthService);
      const user = await auth.signUp('held@example.com', 'customer password 1');
      const token = await auth.login(user.email, 'customer password 1', undefined, {});
      await db.query('UPDATE users SET kyc_level = 1 WHERE id = $1', [user.id]);

      const found = await http().get('/ops/users').query({ q: 'held@' }).set(bearer(support)).expect(200);
      expect(found.body.users.map((u: { id: string }) => u.id)).toEqual([user.id]);
      const byId = await http().get('/ops/users').query({ q: user.id }).set(bearer(support)).expect(200);
      expect(byId.body.users).toHaveLength(1);
      await http().get('/ops/users').query({ q: '%' }).set(bearer(support)).expect(200, { users: [] });

      const detail = await http().get(`/ops/users/${user.id}`).set(bearer(support)).expect(200);
      expect(detail.body).toMatchObject({ user: { email: 'held@example.com', status: 'active' }, orders: [] });
      expect(detail.body.balances).toHaveLength(3);

      await http()
        .post(`/ops/users/${user.id}/status`)
        .set(bearer(support))
        .send({ status: 'withdraw_held', reason: '보이스피싱 신고' })
        .expect(403);
      const held = await http()
        .post(`/ops/users/${user.id}/status`)
        .set(bearer(reviewerA))
        .send({ status: 'withdraw_held', reason: '보이스피싱 신고' })
        .expect(200);
      expect(held.body.user).toMatchObject({ status: 'withdraw_held', statusReason: '보이스피싱 신고' });

      await deposit(db, ledger, user.id, 'BTC', BTC);
      const address = await app.get(WalletService).addAddress(user.id, { asset: 'BTC', address: ADDRESS });
      await expect(app.get(WalletService).requestWithdrawal(user.id, address.id, BTC / 100n)).rejects.toMatchObject({
        code: 'user_restricted',
      });

      await http()
        .post(`/ops/users/${user.id}/status`)
        .set(bearer(reviewerA))
        .send({ status: 'closed', reason: '명의 도용 확인' })
        .expect(200);
      await http().get('/me').set(bearer(token)).expect(401);

      const audit = await http().get('/ops/audit').query({ targetId: user.id }).set(bearer(support)).expect(200);
      expect(audit.body.entries[0]).toMatchObject({
        actorType: 'operator',
        actorId: reviewerAId,
        action: 'user.set_status',
        after: { status: 'closed', reason: '명의 도용 확인' },
      });
      expect(audit.body.operatorNames).toEqual({ [reviewerAId]: 'alice' });
    });
  });
});

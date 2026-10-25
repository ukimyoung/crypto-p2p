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
import { addBankAccount, BTC, createUser, deposit, nextNickname, nextPhoneInput, setupDb, TEST_DATABASE_URL } from './helpers';

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
  let admin: string;

  async function operator(email: string, role: OperatorRole): Promise<{ id: string; token: string; otpSecret: string }> {
    const name = email.split('@')[0]!;
    const created = await app.get(OperatorAuthService).create({ email, name, role, password: PASSWORD });
    const res = await http()
      .post('/ops/auth/login')
      .send({ email, password: PASSWORD, otp: codeAt(created.otpSecret, counterAt(new Date())) })
      .expect(200);
    return { id: created.operator.id, token: res.body.token, otpSecret: created.otpSecret };
  }

  /** Unlocks sensitive actions with the next OTP code (the login used the current one). */
  async function stepUp(op: { token: string; otpSecret: string }) {
    await http()
      .post('/ops/auth/step-up')
      .set(bearer(op.token))
      .send({ otp: codeAt(op.otpSecret, counterAt(new Date()) + 1) })
      .expect(200);
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
    process.env.PAYMENT_METHOD_COOLDOWN_HOURS = '0';
    process.env.ORDER_EXPIRY_INTERVAL_SECONDS = '0';
    process.env.ADDRESS_COOLDOWN_HOURS = '0';
    process.env.EMAIL_INTERVAL_SECONDS = '0';
    process.env.BILLING_INTERVAL_SECONDS = '0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    const a = await operator('alice@ops.test', 'reviewer');
    reviewerA = a.token;
    reviewerAId = a.id;
    await stepUp(a);
    reviewerB = (await operator('bob@ops.test', 'reviewer')).token;
    admin = (await operator('sam@ops.test', 'admin')).token;
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
        role: 'reviewer',
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
      expect(me.body.operator).toMatchObject({ email: 'otp@ops.test', role: 'reviewer', stepUpUntil: null });
      expect(me.body.operator).not.toHaveProperty('password_hash');

      // An operator token is not a customer session, and the other way round.
      await http().get('/me').set(bearer(ok.body.token)).expect(401);
      const user = await app.get(AuthService).signUp('customer@example.com', 'customer password 1', nextPhoneInput(), nextNickname());
      const userToken = await app.get(AuthService).login(user.email, 'customer password 1', undefined, {});
      await http().get('/ops/me').set(bearer(userToken)).expect(401);

      await http().post('/ops/auth/logout').set(bearer(ok.body.token)).expect(204);
      await http().get('/ops/me').set(bearer(ok.body.token)).expect(401);
    });
  });

  describe('withdrawal review', () => {
    it('lets reviewers approve after a fresh OTP code, or reject', async () => {
      const { id, addressId } = await customer();
      const wallet = app.get(WalletService);
      const first = await wallet.requestWithdrawal(id, addressId, BTC / 2n);
      const second = await wallet.requestWithdrawal(id, addressId, BTC / 4n);

      const queue = await http().get('/ops/withdrawals').set(bearer(reviewerB)).expect(200);
      expect(queue.body.withdrawals.map((w: { id: string }) => w.id)).toEqual(
        expect.arrayContaining([first.id, second.id]),
      );
      const summary = await http().get('/ops/summary').set(bearer(reviewerB)).expect(200);
      expect(summary.body.pendingWithdrawals).toBeGreaterThanOrEqual(2);

      // Bob has not entered an OTP code since logging in.
      const denied = await http().post(`/ops/withdrawals/${first.id}/approve`).set(bearer(reviewerB)).expect(403);
      expect(denied.body.error.code).toBe('step_up_required');

      const approved = await http().post(`/ops/withdrawals/${first.id}/approve`).set(bearer(reviewerA)).expect(200);
      expect(approved.body.withdrawal.status).toBe('approved');

      await http().post(`/ops/withdrawals/${second.id}/reject`).set(bearer(reviewerB)).send({}).expect(400);
      const rejected = await http()
        .post(`/ops/withdrawals/${second.id}/reject`)
        .set(bearer(reviewerB))
        .send({ note: '출처 확인 필요' })
        .expect(200);
      expect(rejected.body.withdrawal).toMatchObject({ status: 'rejected', reviewNote: '출처 확인 필요' });
      expect(await ledger.balance(db, { userId: id, asset: 'BTC', kind: 'available' })).toBe(
        BTC - BTC / 2n - first.fee,
      );
    });
  });

  describe('step-up', () => {
    it('needs a code that has not been used and expires after five minutes', async () => {
      const op = await operator('step@ops.test', 'reviewer');
      const loginCode = codeAt(op.otpSecret, counterAt(new Date()));
      const reused = await http().post('/ops/auth/step-up').set(bearer(op.token)).send({ otp: loginCode }).expect(400);
      expect(reused.body.error.code).toBe('invalid_otp');

      await stepUp(op);
      const me = await http().get('/ops/me').set(bearer(op.token)).expect(200);
      const until = new Date(me.body.operator.stepUpUntil).getTime();
      expect(until - Date.now()).toBeGreaterThan(4 * 60_000);
      expect(until - Date.now()).toBeLessThanOrEqual(5 * 60_000);

      await db.query("UPDATE operator_sessions SET step_up_until = now() - interval '1 second' WHERE operator_id = $1", [
        op.id,
      ]);
      const { addressId, id } = await customer();
      const w = await app.get(WalletService).requestWithdrawal(id, addressId, BTC / 2n);
      await http().post(`/ops/withdrawals/${w.id}/approve`).set(bearer(op.token)).expect(403);
    });
  });

  describe('disputes', () => {
    it('lets one reviewer release the escrow with a reason', async () => {
      const { buyer, orderId } = await dispute();

      const list = await http().get('/ops/disputes').set(bearer(reviewerB)).expect(200);
      expect(list.body.disputes.map((d: { order: { id: string } }) => d.order.id)).toContain(orderId);

      const noOtp = await http()
        .post(`/ops/disputes/${orderId}/resolve`)
        .set(bearer(reviewerB))
        .send({ decision: 'release', reason: '입금 확인' })
        .expect(403);
      expect(noOtp.body.error.code).toBe('step_up_required');
      await http()
        .post(`/ops/disputes/${orderId}/resolve`)
        .set(bearer(reviewerA))
        .send({ decision: 'release', reason: ' ' })
        .expect(400);

      const resolved = await http()
        .post(`/ops/disputes/${orderId}/resolve`)
        .set(bearer(reviewerA))
        .send({ decision: 'release', reason: '은행 거래내역으로 입금 확인' })
        .expect(200);
      expect(resolved.body.order.status).toBe('completed');
      expect(resolved.body.resolution).toMatchObject({ status: 'approved', proposedBy: reviewerAId, decidedBy: reviewerAId });
      expect(await ledger.balance(db, { userId: buyer, asset: 'BTC', kind: 'available' })).toBe(BTC / 100n);

      const twice = await http()
        .post(`/ops/disputes/${orderId}/resolve`)
        .set(bearer(reviewerA))
        .send({ decision: 'refund', reason: '다시' })
        .expect(409);
      expect(twice.body.error.code).toBe('invalid_transition');

      const view = await http().get(`/ops/disputes/${orderId}`).set(bearer(reviewerB)).expect(200);
      expect(view.body.resolutions).toHaveLength(1);
      expect(view.body.operatorNames[reviewerAId]).toBe('alice');
      expect(view.body.buyer.id).toBe(buyer);

      const audit = await http().get('/ops/audit').query({ targetId: orderId }).set(bearer(reviewerB)).expect(200);
      const actions = audit.body.entries.map((e: { action: string }) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['order.resolve_release', 'dispute.resolve']));
    });

    it('refunds the seller', async () => {
      const { seller, orderId } = await dispute();
      const done = await http()
        .post(`/ops/disputes/${orderId}/resolve`)
        .set(bearer(reviewerA))
        .send({ decision: 'refund', reason: '구매자 입금 내역 없음' })
        .expect(200);
      expect(done.body.order.status).toBe('cancelled');
      expect(await ledger.balance(db, { userId: seller, asset: 'BTC', kind: 'available' })).toBe(BTC);
    });
  });

  describe('withdrawal rules', () => {
    it('lets a reviewer change a coin rule after a fresh OTP code', async () => {
      const list = await http().get('/ops/settings/withdrawal-rules').set(bearer(reviewerB)).expect(200);
      const btc = list.body.rules.find((r: { asset: string }) => r.asset === 'BTC');
      expect(btc).toMatchObject({ fee: '20000', minAmount: '50000', dailyLimitByKycLevel: { 1: '100000000' } });

      const body = {
        fee: '30000',
        minAmount: '50000',
        autoApproveMax: '0',
        dailyLimits: { 1: '200000000' },
        reason: '수수료 인상',
      };
      await http().put('/ops/settings/withdrawal-rules/BTC').set(bearer(reviewerB)).send(body).expect(403);
      await http()
        .put('/ops/settings/withdrawal-rules/BTC')
        .set(bearer(reviewerA))
        .send({ ...body, fee: '-1' })
        .expect(400);
      await http()
        .put('/ops/settings/withdrawal-rules/DOGE')
        .set(bearer(reviewerA))
        .send(body)
        .expect(404);
      const saved = await http().put('/ops/settings/withdrawal-rules/BTC').set(bearer(reviewerA)).send(body).expect(200);
      expect(saved.body.rules).toMatchObject({ fee: '30000', autoApproveMax: '0', dailyLimitByKycLevel: { 1: '200000000' } });

      const { id, addressId } = await customer();
      const w = await app.get(WalletService).requestWithdrawal(id, addressId, BTC / 100n);
      expect(w).toMatchObject({ fee: 30_000n, status: 'requested' });

      const audit = await http().get('/ops/audit').query({ targetId: 'BTC' }).set(bearer(admin)).expect(200);
      expect(audit.body.entries[0]).toMatchObject({
        action: 'settings.withdrawal_rules',
        actorId: reviewerAId,
        before: { fee: '20000' },
        after: { fee: '30000', reason: '수수료 인상' },
      });

      await http()
        .put('/ops/settings/withdrawal-rules/BTC')
        .set(bearer(reviewerA))
        .send({ fee: '20000', minAmount: '50000', autoApproveMax: '10000000', dailyLimits: { 1: '100000000' }, reason: '원복' })
        .expect(200);
    });
  });

  describe('fees and billing', () => {
    it('sets fee rates and billing terms, bills a maker and records the payment', async () => {
      const rateBody = { asset: 'BTC', fiat: 'KRW', rateBp: 25, reason: 'BTC 0.25%' };
      const noStepUp = await http().post('/ops/settings/fee-rates').set(bearer(reviewerB)).send(rateBody).expect(403);
      expect(noStepUp.body.error.code).toBe('step_up_required');
      await http()
        .post('/ops/settings/fee-rates')
        .set(bearer(reviewerA))
        .send({ ...rateBody, rateBp: 1001 })
        .expect(400);
      await http().post('/ops/settings/fee-rates').set(bearer(reviewerA)).send(rateBody).expect(201);
      const rates = await http().get('/ops/settings/fee-rates').set(bearer(reviewerB)).expect(200);
      expect(rates.body.defaultRateBp).toBe(0);
      expect(rates.body.markets).toContainEqual({ asset: 'BTC', fiat: 'KRW', ownRateBp: 25, rateBp: 25 });
      await http().get('/ads/fee-rate').query({ asset: 'BTC', fiat: 'KRW' }).expect(200, {
        asset: 'BTC',
        fiat: 'KRW',
        feeRateBp: 25,
      });

      await http()
        .put('/ops/settings/billing')
        .set(bearer(reviewerA))
        .send({ cycle: 'weekly', dueDays: 7, reason: 'x' })
        .expect(400);
      const billing = await http()
        .put('/ops/settings/billing')
        .set(bearer(reviewerA))
        .send({ cycle: 'monthly', dueDays: 5, reason: '납부 기한 5일' })
        .expect(200);
      expect(billing.body.billing).toEqual({ cycle: 'monthly', dueDays: 5 });

      // A trade at 0.25%, completed last month.
      const auth = app.get(AuthService);
      const user = await auth.signUp('maker@example.com', 'customer password 1', nextPhoneInput(), nextNickname());
      const makerToken = await auth.login(user.email, 'customer password 1', undefined, {});
      await deposit(db, ledger, user.id, 'BTC', BTC);
      const paymentMethodId = await addBankAccount(db, app.get(PaymentMethodsService), user.id);
      const ad = await app.get(AdsService).create({
        makerId: user.id,
        side: 'sell',
        asset: 'BTC',
        fiat: 'KRW',
        priceMinor: 100_000_000n,
        totalAmount: BTC,
        minOrderFiatMinor: 10_000n,
        maxOrderFiatMinor: 50_000_000n,
        paymentMethodId,
      });
      const market = await http().get('/ads').query({ asset: 'BTC', fiat: 'KRW', side: 'sell' }).expect(200);
      expect(market.body.ads.find((a: { id: string }) => a.id === ad.id)).toMatchObject({
        priceMinor: '100000000',
        finalPriceMinor: '100250000',
        feeRateBp: 25,
      });
      const buyer = await createUser(db);
      const orders = app.get(OrdersService);
      const order = await orders.create(buyer, ad.id, BTC / 10n);
      expect(order).toMatchObject({ fiatAmountMinor: 10_025_000n, feeFiatMinor: 25_000n });
      await orders.markPaid(order.id, buyer);
      await orders.release(order.id, user.id);
      await db.query(`UPDATE orders SET completed_at = completed_at - interval '40 days' WHERE id = $1`, [order.id]);

      await http().post('/ops/fees/run-billing').set(bearer(reviewerA)).expect(403);
      const run = await http().post('/ops/fees/run-billing').set(bearer(admin)).expect(200);
      expect(run.body.issued).toBe(1);

      const list = await http().get('/ops/fee-invoices').query({ status: 'issued' }).set(bearer(reviewerB)).expect(200);
      expect(list.body).toMatchObject({ total: 1, page: 1 });
      const invoice = list.body.invoices[0];
      expect(invoice).toMatchObject({ makerEmail: 'maker@example.com', totalMinor: '25000', status: 'issued' });

      const mine = await http().get('/fees/invoices').set(bearer(makerToken)).expect(200);
      expect(mine.body.invoices.map((i: { id: string }) => i.id)).toEqual([invoice.id]);

      const payment = { amountMinor: '25000', paidAt: new Date().toISOString(), memo: '국민은행 입금 확인' };
      await http().post(`/ops/fee-invoices/${invoice.id}/payments`).set(bearer(reviewerB)).send(payment).expect(403);
      const paid = await http()
        .post(`/ops/fee-invoices/${invoice.id}/payments`)
        .set(bearer(reviewerA))
        .send(payment)
        .expect(201);
      expect(paid.body.invoice).toMatchObject({ status: 'paid', paidMinor: '25000' });
      expect(paid.body.orders).toHaveLength(1);
      expect(paid.body.payments[0]).toMatchObject({ memo: '국민은행 입금 확인', operatorEmail: 'alice@ops.test' });

      const summary = await http()
        .get('/ops/fees/summary')
        .query({ from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' })
        .set(bearer(reviewerB))
        .expect(200);
      expect(summary.body.totals.find((t: { fiat: string }) => t.fiat === 'KRW')).toMatchObject({
        earnedMinor: '25000',
        paidMinor: '25000',
        outstandingMinor: '0',
      });

      await http()
        .put('/ops/settings/billing')
        .set(bearer(reviewerA))
        .send({ cycle: 'monthly', dueDays: 7, reason: '원복' })
        .expect(200);
    });
  });

  describe('customer accounts', () => {
    it('finds customers and restricts them with a reason', async () => {
      const auth = app.get(AuthService);
      const user = await auth.signUp('held@example.com', 'customer password 1', nextPhoneInput(), nextNickname());
      const token = await auth.login(user.email, 'customer password 1', undefined, {});
      await db.query('UPDATE users SET kyc_level = 1 WHERE id = $1', [user.id]);

      const found = await http().get('/ops/users').query({ q: 'held@' }).set(bearer(reviewerB)).expect(200);
      expect(found.body.users.map((u: { id: string }) => u.id)).toEqual([user.id]);
      const byId = await http().get('/ops/users').query({ q: user.id }).set(bearer(reviewerB)).expect(200);
      expect(byId.body.users).toHaveLength(1);
      const none = await http().get('/ops/users').query({ q: '%' }).set(bearer(reviewerB)).expect(200);
      expect(none.body).toMatchObject({ users: [], total: 0 });

      const detail = await http().get(`/ops/users/${user.id}`).set(bearer(reviewerB)).expect(200);
      expect(detail.body).toMatchObject({ user: { email: 'held@example.com', status: 'active' }, orders: [] });
      expect(detail.body.balances).toHaveLength(3);

      // Closing an account needs a fresh OTP code; holding it does not.
      const noOtp = await http()
        .post(`/ops/users/${user.id}/status`)
        .set(bearer(reviewerB))
        .send({ status: 'closed', reason: '명의 도용' })
        .expect(403);
      expect(noOtp.body.error.code).toBe('step_up_required');
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

      const audit = await http().get('/ops/audit').query({ targetId: user.id }).set(bearer(reviewerB)).expect(200);
      expect(audit.body.entries[0]).toMatchObject({
        actorType: 'operator',
        actorId: reviewerAId,
        action: 'user.set_status',
        after: { status: 'closed', reason: '명의 도용 확인' },
      });
      expect(audit.body.operatorNames).toEqual({ [reviewerAId]: 'alice' });
    });

    it('lists every member a page at a time, masks personal details and audits a reveal', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { rows } = await db.query(
          `INSERT INTO users (email, phone, legal_name, kyc_level, created_at)
           VALUES ($1, $2, $3, 0, now() + make_interval(secs => $4)) RETURNING id`,
          [`grid${i}@example.com`, `010-1234-567${i}`, '홍길동', 60 + i],
        );
        ids.push(rows[0].id);
      }
      const all = await http().get('/ops/users').query({ pageSize: 20 }).set(bearer(reviewerB)).expect(200);
      expect(all.body.total).toBeGreaterThanOrEqual(3);
      // Newest first by default.
      expect(all.body.users.slice(0, 3).map((u: { id: string }) => u.id)).toEqual([...ids].reverse());
      expect(all.body.users[0]).toMatchObject({ phone: '010-****-5672', legalName: '홍*동', openOrders: 0 });

      const paged = await http()
        .get('/ops/users')
        .query({ q: 'grid', kycLevel: 0, sort: 'email', dir: 'asc', pageSize: 20, page: 1 })
        .set(bearer(reviewerB))
        .expect(200);
      expect(paged.body.users.map((u: { email: string }) => u.email)).toEqual([
        'grid0@example.com',
        'grid1@example.com',
        'grid2@example.com',
      ]);
      await http().get('/ops/users').query({ pageSize: 30 }).set(bearer(reviewerB)).expect(400);
      const byPhone = await http().get('/ops/users').query({ q: '01012345671' }).set(bearer(reviewerB)).expect(200);
      expect(byPhone.body.users.map((u: { id: string }) => u.id)).toEqual([ids[1]]);

      // Showing personal details needs a fresh OTP code and a reason.
      const noStepUp = await http()
        .post(`/ops/users/${ids[0]}/reveal`)
        .set(bearer(reviewerB))
        .send({ reason: '본인 확인 전화' })
        .expect(403);
      expect(noStepUp.body.error.code).toBe('step_up_required');
      await http().post(`/ops/users/${ids[0]}/reveal`).set(bearer(reviewerA)).send({ reason: ' ' }).expect(400);
      const revealed = await http()
        .post(`/ops/users/${ids[0]}/reveal`)
        .set(bearer(reviewerA))
        .send({ reason: '본인 확인 전화' })
        .expect(200);
      expect(revealed.body.pii).toEqual({ email: 'grid0@example.com', phone: '010-1234-5670', legalName: '홍길동' });

      // Numbers saved with a country show the calling code, and the local form finds them.
      const { rows: intl } = await db.query(
        `INSERT INTO users (email, phone, phone_country, kyc_level) VALUES ('intl@example.com', '+821077778888', 'KR', 0)
         RETURNING id`,
      );
      const byLocal = await http().get('/ops/users').query({ q: '010-7777-8888' }).set(bearer(reviewerB)).expect(200);
      expect(byLocal.body.users).toMatchObject([{ id: intl[0].id, phone: '+82 10-****-8888' }]);
      const intlUser = await http().get(`/ops/users/${intl[0].id}`).set(bearer(reviewerB)).expect(200);
      expect(intlUser.body.user.phone).toBe('+82 10-****-8888');

      const kyc = await http()
        .post(`/ops/users/${ids[0]}/kyc-level`)
        .set(bearer(reviewerB))
        .send({ level: 1, reason: '서류 재확인 필요' })
        .expect(200);
      expect(kyc.body.user.kycLevel).toBe(1);

      const detail = await http().get(`/ops/users/${ids[0]}`).set(bearer(reviewerB)).expect(200);
      expect(detail.body.user.legalName).toBe('홍*동');
      expect(detail.body.history.map((h: { action: string }) => h.action)).toEqual(['user.set_kyc_level', 'user.reveal_pii']);
      expect(detail.body).toMatchObject({ logins: [], addresses: [], ads: [] });
    });
  });

  describe('automatic review', () => {
    it('lets a reviewer set the wait and counts automatic reviews on the dashboard', async () => {
      const current = await http().get('/ops/settings/orders').set(bearer(reviewerB)).expect(200);
      expect(current.body.orders).toEqual({ autoReviewMinutes: 10 });
      await http().put('/ops/settings/orders').set(bearer(reviewerB)).send({ autoReviewMinutes: 15, reason: 'x' }).expect(403);
      await http().put('/ops/settings/orders').set(bearer(reviewerA)).send({ autoReviewMinutes: 0, reason: 'x' }).expect(400);
      const saved = await http()
        .put('/ops/settings/orders')
        .set(bearer(reviewerA))
        .send({ autoReviewMinutes: 15, reason: '야간 응답 지연 고려' })
        .expect(200);
      expect(saved.body.orders).toEqual({ autoReviewMinutes: 15 });

      const before = (await http().get('/ops/summary').set(bearer(reviewerB)).expect(200)).body;
      const { orderId } = await dispute();
      await db.query(`UPDATE orders SET status = 'paid', review_source = NULL WHERE id = $1`, [orderId]);
      await db.query(`UPDATE orders SET paid_at = now() - interval '16 minutes' WHERE id = $1`, [orderId]);
      expect(await app.get(OrdersService).autoReviewDue()).toContain(orderId);
      const after = (await http().get('/ops/summary').set(bearer(reviewerB)).expect(200)).body;
      expect(after.autoReviewDisputes).toBe(before.autoReviewDisputes + 1);
      const list = await http().get('/ops/disputes').set(bearer(reviewerB)).expect(200);
      expect(list.body.disputes.find((d: { order: { id: string } }) => d.order.id === orderId).order.reviewSource).toBe('system');

      await http().put('/ops/settings/orders').set(bearer(reviewerA)).send({ autoReviewMinutes: 10, reason: '원복' }).expect(200);
    });
  });

  describe('ads, orders and markets', () => {
    it('lists ads and orders, takes an ad down and tells the maker', async () => {
      const { seller, orderId } = await dispute();
      const ads = await http().get('/ops/ads').query({ makerId: seller }).set(bearer(reviewerB)).expect(200);
      expect(ads.body.total).toBe(1);
      const adId = ads.body.ads[0].id;

      const detail = await http().get(`/ops/ads/${adId}`).set(bearer(reviewerB)).expect(200);
      expect(detail.body.ad).toMatchObject({ status: 'online', priceMinor: '100000000' });
      expect(detail.body.orders.map((o: { id: string }) => o.id)).toEqual([orderId]);

      const off = await http()
        .post(`/ops/ads/${adId}/status`)
        .set(bearer(reviewerB))
        .send({ status: 'closed', reason: '허위 광고 신고' })
        .expect(200);
      expect(off.body.ad.status).toBe('closed');
      await http().post(`/ops/ads/${adId}/status`).set(bearer(reviewerB)).send({ status: 'offline', reason: 'x' }).expect(409);
      const { rows } = await db.query(`SELECT data FROM notifications WHERE user_id = $1 AND type = 'ad.status_changed'`, [
        seller,
      ]);
      // The maker learns the new status, not the operator's reason.
      expect(rows[0].data).toEqual({ adId, asset: 'BTC', status: 'closed' });
      // The open order carries on.
      expect((await app.get(OrdersService).get(orderId))!.status).toBe('under_review');

      const orders = await http().get('/ops/orders').query({ userId: seller, status: 'under_review' }).set(bearer(reviewerB)).expect(200);
      expect(orders.body.orders.map((o: { id: string }) => o.id)).toEqual([orderId]);
      const order = await http().get(`/ops/orders/${orderId}`).set(bearer(reviewerB)).expect(200);
      expect(order.body.history.map((h: { action: string }) => h.action)).toEqual([
        'order.create',
        'order.mark_paid',
        'order.escalate',
      ]);
      expect(order.body.ledger.map((l: { account: string }) => l.account).sort()).toEqual(['available', 'escrow']);
    });

    it('pauses markets and coins (admin only) and blocks new ads, orders and withdrawals', async () => {
      await http().put('/ops/markets/BTC/KRW').set(bearer(reviewerB)).send({ status: 'paused', reason: 'x' }).expect(403);
      const paused = await http()
        .put('/ops/markets/BTC/KRW')
        .set(bearer(admin))
        .send({ status: 'paused', reason: '시스템 점검' })
        .expect(200);
      expect(paused.body.markets.find((m: { asset: string; fiat: string }) => m.asset === 'BTC' && m.fiat === 'KRW')).toMatchObject({
        status: 'paused',
      });

      const maker = await createUser(db);
      const adInput = {
        makerId: maker,
        side: 'buy' as const,
        asset: 'BTC',
        fiat: 'KRW',
        priceMinor: 100_000_000n,
        totalAmount: BTC,
        minOrderFiatMinor: 10_000n,
        maxOrderFiatMinor: 10_000_000n,
      };
      await expect(app.get(AdsService).create(adInput)).rejects.toMatchObject({ code: 'market_unavailable' });
      await http().put('/ops/markets/BTC/KRW').set(bearer(admin)).send({ status: 'open', reason: '점검 끝' }).expect(200);
      const ad = await app.get(AdsService).create(adInput);

      await http().put('/ops/markets/BTC/KRW').set(bearer(admin)).send({ status: 'paused', reason: '점검' }).expect(200);
      const market = await http().get('/ads').query({ asset: 'BTC', fiat: 'KRW', side: 'buy' }).expect(200);
      expect(market.body.ads).toEqual([]);
      const taker = await createUser(db);
      await deposit(db, ledger, taker, 'BTC', BTC);
      const takerAccount = await addBankAccount(db, app.get(PaymentMethodsService), taker);
      await expect(app.get(OrdersService).create(taker, ad.id, BTC / 100n, takerAccount)).rejects.toMatchObject({
        code: 'market_unavailable',
      });
      await http().put('/ops/markets/BTC/KRW').set(bearer(admin)).send({ status: 'open', reason: '재개' }).expect(200);

      await http()
        .put('/ops/markets/assets/BTC')
        .set(bearer(admin))
        .send({ status: 'withdrawals_paused', reason: '노드 장애' })
        .expect(200);
      const { id, addressId } = await customer();
      await expect(app.get(WalletService).requestWithdrawal(id, addressId, BTC / 100n)).rejects.toMatchObject({
        code: 'withdrawals_paused',
      });
      // Trading carries on while withdrawals are paused.
      await app.get(OrdersService).create(taker, ad.id, BTC / 100n, takerAccount);
      await http().put('/ops/markets/assets/BTC').set(bearer(admin)).send({ status: 'active', reason: '복구' }).expect(200);

      const audit = await http().get('/ops/audit').query({ targetId: 'BTC/KRW' }).set(bearer(admin)).expect(200);
      expect(audit.body.entries[0]).toMatchObject({ action: 'market.status', after: { status: 'open', reason: '재개' } });
    });
  });
});

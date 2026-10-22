import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { codeAt, counterAt } from '../src/auth/totp';
import { Db } from '../src/db/database';
import { configureApp } from '../src/http/configure';
import { LedgerService } from '../src/ledger/ledger.service';
import { BTC, deposit, setupDb, TEST_DATABASE_URL } from './helpers';

const PASSWORD = 'test password 123';

describe('HTTP API', () => {
  let app: INestApplication;
  let db: Db;
  const ledger = new LedgerService();
  const http = () => request(app.getHttpServer());

  interface TestUser {
    id: string;
    email: string;
    token: string;
    otpSecret?: string;
  }

  async function signUpAndLogin(email: string): Promise<TestUser> {
    const signUp = await http().post('/auth/signup').send({ email, password: PASSWORD }).expect(201);
    const login = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id: signUp.body.user.id, email, token: login.body.token };
  }

  async function enableOtp(user: TestUser): Promise<void> {
    const setup = await http().post('/auth/otp/setup').set(auth(user)).expect(200);
    user.otpSecret = setup.body.secret;
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    await http()
      .post('/auth/otp/enable')
      .set(auth(user))
      .send({ code: codeAt(user.otpSecret!, counterAt(new Date())) })
      .expect(204);
  }

  /** A trader who passed KYC level 1 (set directly until the KYC flow exists) with OTP on. */
  async function trader(email: string): Promise<TestUser> {
    const user = await signUpAndLogin(email);
    await db.query('UPDATE users SET kyc_level = 1 WHERE id = $1', [user.id]);
    await enableOtp(user);
    return user;
  }

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

  beforeAll(async () => {
    db = await setupDb();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.OTP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.MAKER_FEE_BPS = '0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  it('reports health', async () => {
    await http().get('/health').expect(200, { status: 'ok' });
  });

  describe('auth', () => {
    it('validates sign-up input and rejects duplicate emails', async () => {
      const weak = await http().post('/auth/signup').send({ email: 'weak@example.com', password: 'short' }).expect(400);
      expect(weak.body.error.code).toBe('weak_password');
      await http().post('/auth/signup').send({ email: 'Dup@Example.com', password: PASSWORD }).expect(201);
      const dup = await http().post('/auth/signup').send({ email: 'dup@example.com', password: PASSWORD }).expect(409);
      expect(dup.body.error.code).toBe('email_taken');
    });

    it('logs in, returns the profile, and logs out', async () => {
      const user = await signUpAndLogin('alice@example.com');
      const me = await http().get('/me').set(auth(user)).expect(200);
      expect(me.body.user).toMatchObject({ email: 'alice@example.com', kycLevel: 0, otpEnabled: false });
      expect(me.body.user).not.toHaveProperty('password_hash');

      await http().post('/auth/logout').set(auth(user)).expect(204);
      await http().get('/me').set(auth(user)).expect(401);
    });

    it('records login attempts and locks out after repeated failures', async () => {
      await signUpAndLogin('bob@example.com');
      for (let i = 0; i < 5; i++) {
        await http().post('/auth/login').send({ email: 'bob@example.com', password: 'wrong password 1' }).expect(401);
      }
      const locked = await http().post('/auth/login').send({ email: 'bob@example.com', password: PASSWORD }).expect(429);
      expect(locked.body.error.code).toBe('too_many_attempts');

      const { rows } = await db.query(
        "SELECT success, reason FROM login_attempts WHERE email = 'bob@example.com' ORDER BY id",
      );
      expect(rows[0]).toEqual({ success: true, reason: null });
      expect(rows.at(-1)).toEqual({ success: false, reason: 'locked' });
    });

    it('requires an OTP code at login once OTP is on', async () => {
      const user = await signUpAndLogin('carol@example.com');
      await enableOtp(user);

      const missing = await http().post('/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);
      expect(missing.body.error.code).toBe('otp_required');
      // The code used to enable OTP cannot be replayed; the next step's code works.
      const next = codeAt(user.otpSecret!, counterAt(new Date()) + 1);
      await http().post('/auth/login').send({ email: user.email, password: PASSWORD, otp: next }).expect(200);
      await http().post('/auth/login').send({ email: user.email, password: PASSWORD, otp: next }).expect(400);
    });

    it('rejects requests without a valid token', async () => {
      await http().get('/me').expect(401);
      await http().get('/me').set({ Authorization: 'Bearer nope' }).expect(401);
    });
  });

  describe('trading', () => {
    it('runs a full order over HTTP', async () => {
      const seller = await trader('seller@example.com');
      const buyer = await trader('buyer@example.com');
      const stranger = await trader('stranger@example.com');
      await deposit(db, ledger, seller.id, 'BTC', BTC);

      const adRes = await http()
        .post('/ads')
        .set(auth(seller))
        .send({
          side: 'sell',
          asset: 'BTC',
          fiat: 'KRW',
          priceMinor: '100000000',
          totalAmount: String(BTC / 2n),
          minOrderFiatMinor: '10000',
          maxOrderFiatMinor: '5000000',
        })
        .expect(201);
      const adId = adRes.body.ad.id;
      expect(adRes.body.ad.priceMinor).toBe('100000000');

      const market = await http().get('/ads').query({ asset: 'BTC', fiat: 'KRW', side: 'sell' }).expect(200);
      expect(market.body.ads.map((a: { id: string }) => a.id)).toContain(adId);

      const orderRes = await http()
        .post('/orders')
        .set(auth(buyer))
        .send({ adId, amount: String(BTC / 100n) })
        .expect(201);
      const order = orderRes.body.order;
      expect(order).toMatchObject({ status: 'pending_payment', fiatAmountMinor: '1000000', sellerId: seller.id });

      await http().get(`/orders/${order.id}`).set(auth(stranger)).expect(404);
      await http().post(`/orders/${order.id}/release`).set(auth(buyer)).send({ otp: '000000' }).expect(400);

      await http().post(`/orders/${order.id}/paid`).set(auth(buyer)).expect(200);

      const noOtp = await http().post(`/orders/${order.id}/release`).set(auth(seller)).send({}).expect(400);
      expect(noOtp.body.error.code).toBe('invalid_request');
      const reused = codeAt(seller.otpSecret!, counterAt(new Date()) - 1);
      await http().post(`/orders/${order.id}/release`).set(auth(seller)).send({ otp: reused }).expect(400);

      const released = await http()
        .post(`/orders/${order.id}/release`)
        .set(auth(seller))
        .send({ otp: codeAt(seller.otpSecret!, counterAt(new Date()) + 1) })
        .expect(200);
      expect(released.body.order.status).toBe('completed');

      const mine = await http().get('/orders').set(auth(buyer)).expect(200);
      expect(mine.body.orders[0]).toMatchObject({ id: order.id, status: 'completed' });
      expect(await ledger.balance(db, { userId: buyer.id, asset: 'BTC', kind: 'available' })).toBe(BTC / 100n);
    });

    it('requires OTP to post ads or open orders', async () => {
      const user = await signUpAndLogin('nootp@example.com');
      const res = await http()
        .post('/orders')
        .set(auth(user))
        .send({ adId: '00000000-0000-4000-8000-000000000000', amount: '1' })
        .expect(403);
      expect(res.body.error.code).toBe('otp_not_enabled');
    });

    it('rejects malformed amounts', async () => {
      const user = await trader('badinput@example.com');
      const res = await http()
        .post('/orders')
        .set(auth(user))
        .send({ adId: '00000000-0000-4000-8000-000000000000', amount: '1.5' })
        .expect(400);
      expect(res.body.error.code).toBe('invalid_request');
    });
  });
});

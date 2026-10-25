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
import { PaymentMethodsService } from '../src/payments/payment-methods.service';
import { EMAIL_SENDER } from '../src/tokens';
import { addBankAccount, BTC, deposit, MemoryEmailSender, nextNickname, nextPhone, setupDb, TEST_DATABASE_URL } from './helpers';

const PASSWORD = 'test password 123';

describe('HTTP API', () => {
  let app: INestApplication;
  let db: Db;
  const ledger = new LedgerService();
  const mail = new MemoryEmailSender();
  const http = () => request(app.getHttpServer());

  interface TestUser {
    id: string;
    email: string;
    token: string;
    otpSecret?: string;
  }

  /** Opens the link in the signup email sent to `email`. */
  const confirm = (email: string) => http().post('/auth/signup/verify').send({ token: mail.signupToken(email) });

  async function signUpAndLogin(email: string): Promise<TestUser> {
    await http().post('/auth/signup').send({ email, password: PASSWORD, ...nextPhone(), nickname: nextNickname() }).expect(202);
    const verified = await confirm(email).expect(200);
    const login = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id: verified.body.user.id, email, token: login.body.token };
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
    process.env.PAYMENT_METHOD_COOLDOWN_HOURS = '0';
    process.env.ORDER_EXPIRY_INTERVAL_SECONDS = '0';
    process.env.ADDRESS_COOLDOWN_HOURS = '0';
    process.env.EMAIL_INTERVAL_SECONDS = '0';
    process.env.BILLING_INTERVAL_SECONDS = '0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(mail)
      .compile();
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
      const weak = await http().post('/auth/signup').send({ email: 'weak@example.com', password: 'short', ...nextPhone(), nickname: nextNickname() }).expect(400);
      expect(weak.body.error.code).toBe('weak_password');
      await http().post('/auth/signup').send({ email: 'Dup@Example.com', password: PASSWORD, ...nextPhone(), nickname: nextNickname() }).expect(202);
      await confirm('dup@example.com').expect(200);
      const dup = await http()
        .post('/auth/signup')
        .send({ email: 'dup@example.com', password: PASSWORD, ...nextPhone(), nickname: nextNickname() })
        .expect(409);
      expect(dup.body.error.code).toBe('email_taken');
    });

    it('creates the account only when the emailed link is opened', async () => {
      const email = 'confirm@example.com';
      const body = { email: 'Confirm@Example.com', password: PASSWORD, ...nextPhone(), nickname: nextNickname(), locale: 'en' };
      const res = await http().post('/auth/signup').send(body).expect(202);
      expect(res.body).toEqual({ email });
      const sent = mail.sent.at(-1)!;
      expect(sent.to).toBe(email);
      expect(sent.subject).toMatch(/Confirm your email/);
      expect(sent.html).toContain('/signup/verify?token=');

      // Nothing exists yet: no account, no login.
      expect((await db.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount).toBe(0);
      await http().post('/auth/login').send({ email, password: PASSWORD }).expect(401);

      // Asking again within a minute is refused; the resend endpoint stays quiet about it.
      const again = await http().post('/auth/signup').send(body).expect(429);
      expect(again.body.error.code).toBe('signup_email_recent');
      await http().post('/auth/signup/resend').send({ email }).expect(204);
      await http().post('/auth/signup/resend').send({ email: 'nobody@example.com' }).expect(204);
      const count = mail.sent.length;

      // A minute later a new link replaces the old one.
      const token = mail.signupToken(email);
      await db.query("UPDATE signup_requests SET sent_at = sent_at - interval '2 minutes' WHERE email = $1", [email]);
      await http().post('/auth/signup/resend').send({ email }).expect(204);
      expect(mail.sent.length).toBe(count + 1);
      const stale = await http().post('/auth/signup/verify').send({ token }).expect(400);
      expect(stale.body.error.code).toBe('invalid_signup_link');

      const verified = await confirm(email).expect(200);
      expect(verified.body.token).toEqual(expect.any(String));
      expect(verified.body.user).toMatchObject({ email, locale: 'en' });
      const me = await http().get('/me').set({ Authorization: `Bearer ${verified.body.token}` }).expect(200);
      expect(me.body.user.id).toBe(verified.body.user.id);
      const { rows } = await db.query('SELECT email_verified_at FROM users WHERE email = $1', [email]);
      expect(rows[0].email_verified_at).toBeInstanceOf(Date);
      await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);

      // The link works once.
      const reused = await confirm(email).expect(400);
      expect(reused.body.error.code).toBe('invalid_signup_link');
    });

    it('rejects expired links and details taken while the link waited', async () => {
      await http().post('/auth/signup').send({ email: 'late@example.com', password: PASSWORD, ...nextPhone(), nickname: nextNickname() }).expect(202);
      await db.query("UPDATE signup_requests SET expires_at = now() - interval '1 second' WHERE email = 'late@example.com'");
      const expired = await confirm('late@example.com').expect(410);
      expect(expired.body.error.code).toBe('signup_link_expired');

      // Two people pick the same nickname; whoever confirms first gets it.
      await http().post('/auth/signup').send({ email: 'first@example.com', password: PASSWORD, ...nextPhone(), nickname: 'samename' }).expect(202);
      await http().post('/auth/signup').send({ email: 'second@example.com', password: PASSWORD, ...nextPhone(), nickname: 'samename' }).expect(202);
      await confirm('second@example.com').expect(200);
      const lost = await confirm('first@example.com').expect(409);
      expect(lost.body.error.code).toBe('nickname_taken');
      // The failed request is gone, so signing up again with another nickname works at once.
      await http().post('/auth/signup').send({ email: 'first@example.com', password: PASSWORD, ...nextPhone(), nickname: 'othername' }).expect(202);
    });

    it('reports a mail failure and lets the member try again', async () => {
      mail.fail = true;
      const body = { email: 'nomail@example.com', password: PASSWORD, ...nextPhone(), nickname: nextNickname() };
      try {
        const res = await http().post('/auth/signup').send(body).expect(503);
        expect(res.body.error.code).toBe('email_unavailable');
      } finally {
        mail.fail = false;
      }
      await http().post('/auth/signup').send(body).expect(202);
    });

    it('requires a phone number with its country at sign-up', async () => {
      const body = { email: 'phone@example.com', password: PASSWORD, nickname: nextNickname() };
      const missing = await http().post('/auth/signup').send(body).expect(400);
      expect(missing.body.error.code).toBe('invalid_request');
      for (const bad of [
        { phoneCountry: 'XX', phoneNumber: '010-1234-5678' },
        { phoneCountry: 'KR', phoneNumber: '010-12' },
        { phoneCountry: 'KR', phoneNumber: '+82 10 1234 5678' },
      ]) {
        const res = await http()
          .post('/auth/signup')
          .send({ ...body, ...bad })
          .expect(400);
        expect(res.body.error.code).toBe('invalid_phone');
      }

      await http()
        .post('/auth/signup')
        .send({ ...body, phoneCountry: 'KR', phoneNumber: '010-9876-5432' })
        .expect(202);
      const ok = await confirm('phone@example.com').expect(200);
      expect(ok.body.user).toMatchObject({
        phone: '+82 10-9876-5432',
        phoneCountry: 'KR',
        phoneNational: '010-9876-5432',
      });
      const { rows } = await db.query('SELECT phone, phone_country FROM users WHERE id = $1', [ok.body.user.id]);
      expect(rows[0]).toEqual({ phone: '+821098765432', phone_country: 'KR' });

      // The same number written another way is still the same number.
      const taken = await http()
        .post('/auth/signup')
        .send({ email: 'phone2@example.com', password: PASSWORD, nickname: nextNickname(), phoneCountry: 'KR', phoneNumber: '01098765432' })
        .expect(409);
      expect(taken.body.error.code).toBe('phone_taken');
    });

    it('requires a valid, unused nickname and lets the member change it', async () => {
      const base = { password: PASSWORD };
      for (const nickname of ['a', 'has space', 'x'.repeat(17), 'bad!']) {
        const res = await http()
          .post('/auth/signup')
          .send({ ...base, email: 'nick@example.com', nickname, ...nextPhone() })
          .expect(400);
        expect(res.body.error.code).toBe('invalid_nickname');
      }
      await http()
        .post('/auth/signup')
        .send({ ...base, email: 'nick@example.com', nickname: ' 코인_Lover1 ', ...nextPhone() })
        .expect(202);
      const ok = await confirm('nick@example.com').expect(200);
      expect(ok.body.user.nickname).toBe('코인_Lover1');
      // Letter case does not make a different nickname.
      const taken = await http()
        .post('/auth/signup')
        .send({ ...base, email: 'nick2@example.com', nickname: '코인_lover1', ...nextPhone() })
        .expect(409);
      expect(taken.body.error.code).toBe('nickname_taken');

      const login = await http().post('/auth/login').send({ email: 'nick@example.com', password: PASSWORD }).expect(200);
      const headers = { Authorization: `Bearer ${login.body.token}` };
      const changed = await http().post('/me/nickname').set(headers).send({ nickname: '새이름' }).expect(200);
      expect(changed.body.user.nickname).toBe('새이름');
      const other = await signUpAndLogin('nick3@example.com');
      const clash = await http().post('/me/nickname').set(auth(other)).send({ nickname: '새이름' }).expect(409);
      expect(clash.body.error.code).toBe('nickname_taken');
    });

    it('lets a member change the phone number, with OTP once it is on', async () => {
      const user = await signUpAndLogin('newphone@example.com');
      const us = { phoneCountry: 'US', phoneNumber: '(415) 555-0100' };
      const changed = await http().post('/me/phone').set(auth(user)).send(us).expect(200);
      expect(changed.body.user).toMatchObject({ phone: '+1 4155550100', phoneCountry: 'US', phoneNational: '4155550100' });

      await enableOtp(user);
      const jp = { phoneCountry: 'JP', phoneNumber: '090-1234-5678' };
      const noOtp = await http().post('/me/phone').set(auth(user)).send(jp).expect(401);
      expect(noOtp.body.error.code).toBe('otp_required');
      const otp = codeAt(user.otpSecret!, counterAt(new Date()) + 1);
      await http()
        .post('/me/phone')
        .set(auth(user))
        .send({ ...jp, otp })
        .expect(200);
      expect((await http().get('/me').set(auth(user)).expect(200)).body.user.phone).toBe('+81 9012345678');

      const { rows } = await db.query(
        "SELECT before, after FROM audit_logs WHERE action = 'user.phone_change' AND target_id = $1 ORDER BY id",
        [user.id],
      );
      expect(rows.map((r) => r.after)).toEqual([{ phoneCountry: 'US' }, { phoneCountry: 'JP' }]);
    });

    it('logs in, returns the profile, and logs out', async () => {
      const user = await signUpAndLogin('alice@example.com');
      const me = await http().get('/me').set(auth(user)).expect(200);
      expect(me.body.user).toMatchObject({ email: 'alice@example.com', kycLevel: 0, otpEnabled: false });
      expect(me.body.user).not.toHaveProperty('password_hash');
      expect(me.body.user.locale).toBe('ko');

      await http().post('/me/locale').set(auth(user)).send({ locale: 'fr' }).expect(400);
      await http().post('/me/locale').set(auth(user)).send({ locale: 'en' }).expect(204);
      expect((await http().get('/me').set(auth(user)).expect(200)).body.user.locale).toBe('en');

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
      // Opening the signup link logs the member in; then the explicit login.
      expect(rows.slice(0, 2)).toEqual([
        { success: true, reason: 'signup' },
        { success: true, reason: null },
      ]);
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
      const paymentMethodId = await addBankAccount(db, app.get(PaymentMethodsService), seller.id);

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
          paymentMethodId,
        })
        .expect(201);
      const adId = adRes.body.ad.id;
      expect(adRes.body.ad.priceMinor).toBe('100000000');

      const market = await http().get('/ads').query({ asset: 'BTC', fiat: 'KRW', side: 'sell' }).expect(200);
      expect(market.body.ads.map((a: { id: string }) => a.id)).toContain(adId);
      const me = await http().get('/me').set(auth(seller)).expect(200);
      // The market names the advertiser by nickname, never by email or legal name.
      expect(market.body.ads.find((a: { id: string }) => a.id === adId).makerNickname).toBe(me.body.user.nickname);

      const orderRes = await http()
        .post('/orders')
        .set(auth(buyer))
        .send({ adId, amount: String(BTC / 100n) })
        .expect(201);
      const order = orderRes.body.order;
      expect(order).toMatchObject({ status: 'pending_payment', fiatAmountMinor: '1000000', sellerId: seller.id });

      await http().get(`/orders/${order.id}`).set(auth(stranger)).expect(404);
      const view = await http().get(`/orders/${order.id}`).set(auth(buyer)).expect(200);
      expect(view.body.paymentDetails).toMatchObject({ bankCode: '004', accountHolder: '홍길동' });
      expect(view.body.paymentDetails.accountNumber).toMatch(/^\d+$/);

      await http().post(`/orders/${order.id}/messages`).set(auth(buyer)).send({ body: '입금했어요' }).expect(201);
      await http().post(`/orders/${order.id}/messages`).set(auth(stranger)).send({ body: 'hi' }).expect(404);
      const chat = await http().get(`/orders/${order.id}/messages`).set(auth(seller)).expect(200);
      expect(chat.body.messages).toMatchObject([{ senderId: buyer.id, body: '입금했어요' }]);

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

      const inbox = await http().get('/notifications').set(auth(seller)).expect(200);
      expect(inbox.body.notifications.map((n: { type: string }) => n.type)).toEqual([
        'order.paid',
        'order.message',
        'order.created',
      ]);
      expect(inbox.body.unread).toBe(3);
      await http()
        .post('/notifications/read')
        .set(auth(seller))
        .send({ upToId: inbox.body.notifications[0].id })
        .expect(204);
      await http().get('/notifications/unread-count').set(auth(seller)).expect(200, { unread: 0 });
    });

    it('adds a bank account only with an OTP code', async () => {
      const user = await trader('bank@example.com');
      await db.query("UPDATE users SET legal_name = '김영희' WHERE id = $1", [user.id]);
      const body = { fiat: 'KRW', bankCode: '088', accountHolder: '김영희', accountNumber: '110-123-456789' };

      const noOtp = await http().post('/payment-methods').set(auth(user)).send(body).expect(400);
      expect(noOtp.body.error.code).toBe('invalid_request');

      const otp = codeAt(user.otpSecret!, counterAt(new Date()) + 1);
      const added = await http()
        .post('/payment-methods')
        .set(auth(user))
        .send({ ...body, otp })
        .expect(201);
      expect(added.body.paymentMethod).toMatchObject({ accountMasked: '****6789', accountHolder: '김영희' });
      expect(JSON.stringify(added.body)).not.toContain('110123456789');

      const list = await http().get('/payment-methods').set(auth(user)).expect(200);
      expect(list.body.paymentMethods).toHaveLength(1);
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

  describe('wallet', () => {
    /** Each code works once, so tests that need several in one 30s step forget the last one used. */
    async function freshOtp(user: TestUser): Promise<string> {
      await db.query('UPDATE users SET otp_last_counter = NULL WHERE id = $1', [user.id]);
      return codeAt(user.otpSecret!, counterAt(new Date()) + 1);
    }

    it('whitelists an address and withdraws to it', async () => {
      const user = await trader('wallet@example.com');
      await deposit(db, ledger, user.id, 'BTC', BTC);

      const balances = await http().get('/wallet/balances').set(auth(user)).expect(200);
      expect(balances.body.balances).toContainEqual({
        asset: 'BTC',
        available: String(BTC),
        escrow: '0',
        withdrawalPending: '0',
      });

      const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
      const bad = await http()
        .post('/wallet/addresses')
        .set(auth(user))
        .send({ asset: 'BTC', address: '0x52908400098527886e0f7030069857d2e4169ee7', otp: await freshOtp(user) })
        .expect(400);
      expect(bad.body.error.code).toBe('invalid_address');
      const added = await http()
        .post('/wallet/addresses')
        .set(auth(user))
        .send({ asset: 'BTC', address, label: '내 지갑', otp: await freshOtp(user) })
        .expect(201);
      const addressId = added.body.address.id;

      await http()
        .post('/wallet/withdrawals')
        .set(auth(user))
        .send({ addressId, amount: '1000000' })
        .expect(400);
      const res = await http()
        .post('/wallet/withdrawals')
        .set(auth(user))
        .send({ addressId, amount: '1000000', otp: await freshOtp(user) })
        .expect(201);
      expect(res.body.withdrawal).toMatchObject({ address, amount: '1000000', fee: '20000', status: 'approved' });

      const list = await http().get('/wallet/withdrawals').set(auth(user)).expect(200);
      expect(list.body.withdrawals).toHaveLength(1);
      expect(list.body.limits).toContainEqual(
        expect.objectContaining({ asset: 'BTC', dailyLimit: String(BTC), usedToday: '1000000' }),
      );

      const other = await trader('wallet-other@example.com');
      await http().get('/wallet/addresses').set(auth(other)).expect(200, { addresses: [] });
      await http().post(`/wallet/withdrawals/${res.body.withdrawal.id}/cancel`).set(auth(other)).expect(404);
    });
  });
});

import 'reflect-metadata';
import { createHmac, randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { codeAt, counterAt } from '../src/auth/totp';
import { Db } from '../src/db/database';
import { configureApp } from '../src/http/configure';
import { KycService } from '../src/kyc/kyc.service';
import { legalNameOf, SumsubApi, SumsubApplicant, SumsubClient, verifySumsubDigest } from '../src/kyc/sumsub.client';
import { OperatorAuthService } from '../src/ops/operator-auth.service';
import { DB } from '../src/tokens';
import { setupDb, TEST_DATABASE_URL } from './helpers';

const SECRET = 'webhook-secret';
const PASSWORD = 'test password 123';

/** Sumsub as the tests want it: applicants are set by hand, webhooks signed with SECRET. */
class FakeSumsub implements SumsubApi {
  readonly levelName = 'basic-kyc';
  applicants = new Map<string, SumsubApplicant>();
  tokens: string[] = [];
  checks: string[] = [];
  async accessToken(externalUserId: string) {
    this.tokens.push(externalUserId);
    return `token-for-${externalUserId}`;
  }
  async applicantByExternalId(externalUserId: string) {
    return this.applicants.get(externalUserId) ?? null;
  }
  async requestCheck(applicantId: string) {
    this.checks.push(applicantId);
  }
  verifyWebhook(body: Buffer, digest: string | undefined, alg: string | undefined) {
    return verifySumsubDigest(SECRET, body, digest, alg);
  }
}

const applicant = (userId: string, over: Partial<SumsubApplicant> = {}): SumsubApplicant => ({
  id: `app-${userId.slice(0, 8)}`,
  externalUserId: userId,
  levelName: 'basic-kyc',
  reviewStatus: 'pending',
  reviewAnswer: null,
  rejectType: null,
  rejectLabels: [],
  moderationComment: null,
  clientComment: null,
  legalName: '김철수',
  ...over,
});

describe('Sumsub client', () => {
  it('signs requests with the app token and secret key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ token: 'abc', userId: 'u1' }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new SumsubClient(
      { appToken: 'tok', secretKey: 'sec', webhookSecret: SECRET, levelName: 'basic-kyc', baseUrl: 'https://sumsub.test' },
      fakeFetch,
    );
    expect(await client.accessToken('u1')).toBe('abc');
    const { url, init } = calls[0]!;
    expect(url).toBe('https://sumsub.test/resources/accessTokens/sdk');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-App-Token']).toBe('tok');
    const expected = createHmac('sha256', 'sec')
      .update(headers['X-App-Access-Ts']! + 'POST' + '/resources/accessTokens/sdk' + init.body)
      .digest('hex');
    expect(headers['X-App-Access-Sig']).toBe(expected);
    expect(JSON.parse(init.body as string)).toEqual({ userId: 'u1', levelName: 'basic-kyc', ttlInSecs: 1800 });
  });

  it('reads an applicant and treats a missing one as none', async () => {
    let status = 200;
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          id: 'a1',
          externalUserId: 'u1',
          info: { firstName: '길동', lastName: '홍', idDocs: [{ number: 'never stored' }] },
          review: { reviewStatus: 'completed', levelName: 'basic-kyc', reviewResult: { reviewAnswer: 'GREEN' } },
        }),
        { status },
      )) as unknown as typeof fetch;
    const client = new SumsubClient(
      { appToken: 't', secretKey: 's', webhookSecret: SECRET, levelName: 'basic-kyc', baseUrl: 'https://sumsub.test' },
      fakeFetch,
    );
    expect(await client.applicantByExternalId('u1')).toEqual({
      id: 'a1',
      externalUserId: 'u1',
      levelName: 'basic-kyc',
      reviewStatus: 'completed',
      reviewAnswer: 'GREEN',
      rejectType: null,
      rejectLabels: [],
      moderationComment: null,
      clientComment: null,
      legalName: '홍길동',
    });
    status = 404;
    expect(await client.applicantByExternalId('u1')).toBeNull();
    status = 500;
    await expect(client.applicantByExternalId('u1')).rejects.toMatchObject({ code: 'kyc_provider_error' });
  });

  it('checks webhook digests and builds names in the right order', () => {
    const body = Buffer.from('{"type":"applicantReviewed"}');
    const sha256 = createHmac('sha256', SECRET).update(body).digest('hex');
    const sha1 = createHmac('sha1', SECRET).update(body).digest('hex');
    expect(verifySumsubDigest(SECRET, body, sha256, undefined)).toBe(true);
    expect(verifySumsubDigest(SECRET, body, sha1, 'HMAC_SHA1_HEX')).toBe(true);
    expect(verifySumsubDigest(SECRET, body, sha1, 'HMAC_SHA256_HEX')).toBe(false);
    expect(verifySumsubDigest(SECRET, body, undefined, undefined)).toBe(false);
    expect(verifySumsubDigest(SECRET, body, sha256, 'MD5')).toBe(false);
    expect(legalNameOf({ firstName: '길동', lastName: '홍' })).toBe('홍길동');
    expect(legalNameOf({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
    expect(legalNameOf({})).toBeNull();
  });
});

describe('identity verification', () => {
  let app: INestApplication;
  let db: Db;
  let sumsub: FakeSumsub;
  let reviewer: string;
  let reviewerId: string;
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function member(email: string): Promise<{ id: string; token: string }> {
    const signUp = await http().post('/auth/signup').send({ email, password: PASSWORD }).expect(201);
    const login = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id: signUp.body.user.id, token: login.body.token };
  }

  /** Posts a webhook signed like Sumsub signs it. */
  function webhook(payload: object, digest?: string) {
    const body = JSON.stringify(payload);
    return http()
      .post('/kyc/sumsub/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Payload-Digest', digest ?? createHmac('sha256', SECRET).update(body).digest('hex'))
      .set('X-Payload-Digest-Alg', 'HMAC_SHA256_HEX')
      .send(body);
  }

  const reviewed = (userId: string, createdAtMs: string) => ({
    applicantId: `app-${userId.slice(0, 8)}`,
    externalUserId: userId,
    type: 'applicantReviewed',
    reviewStatus: 'completed',
    createdAtMs,
  });

  const notifications = async (userId: string) =>
    (await db.query('SELECT type, data FROM notifications WHERE user_id = $1 ORDER BY id', [userId])).rows;

  beforeAll(async () => {
    db = await setupDb();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.OTP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.ORDER_EXPIRY_INTERVAL_SECONDS = '0';
    process.env.EMAIL_INTERVAL_SECONDS = '0';
    process.env.BILLING_INTERVAL_SECONDS = '0';
    sumsub = new FakeSumsub();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KycService)
      .useFactory({ inject: [DB], factory: (pool: Db) => new KycService(pool, sumsub) })
      .compile();
    app = moduleRef.createNestApplication({ logger: false, rawBody: true });
    configureApp(app);
    await app.init();

    const created = await app.get(OperatorAuthService).create({
      email: 'kyc@ops.test',
      name: 'kyc',
      role: 'reviewer',
      password: PASSWORD,
    });
    reviewerId = created.operator.id;
    const login = await http()
      .post('/ops/auth/login')
      .send({ email: 'kyc@ops.test', password: PASSWORD, otp: codeAt(created.otpSecret, counterAt(new Date())) })
      .expect(200);
    reviewer = login.body.token;
  });

  beforeEach(() => {
    sumsub.applicants.clear();
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  it('hands the member a WebSDK token for their own applicant', async () => {
    const m = await member('token@example.com');
    const status = await http().get('/kyc').set(bearer(m.token)).expect(200);
    expect(status.body).toEqual({ kycLevel: 0, available: true, applicant: null });
    const res = await http().post('/kyc/token').set(bearer(m.token)).expect(200);
    expect(res.body).toEqual({ token: `token-for-${m.id}`, levelName: 'basic-kyc' });
    await http().post('/kyc/token').expect(401);
  });

  it('drops webhooks with a bad signature', async () => {
    const m = await member('forged@example.com');
    sumsub.applicants.set(m.id, applicant(m.id, { reviewStatus: 'completed', reviewAnswer: 'GREEN' }));
    const res = await webhook(reviewed(m.id, '1'), 'deadbeef').expect(401);
    expect(res.body.error.code).toBe('invalid_signature');
    expect((await db.query('SELECT kyc_level FROM users WHERE id = $1', [m.id])).rows[0].kyc_level).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM sumsub_webhooks')).rows[0].n).toBe(0);
  });

  it('approves on a green review once, with the name from the ID, and tells the member', async () => {
    const m = await member('green@example.com');
    sumsub.applicants.set(m.id, applicant(m.id));
    await webhook({ ...reviewed(m.id, '1'), type: 'applicantPending', reviewStatus: 'pending' }).expect(200);
    expect((await http().get('/kyc').set(bearer(m.token)).expect(200)).body.applicant).toMatchObject({
      reviewStatus: 'pending',
      reviewAnswer: null,
    });

    sumsub.applicants.set(m.id, applicant(m.id, { reviewStatus: 'completed', reviewAnswer: 'GREEN' }));
    const first = await webhook(reviewed(m.id, '2')).expect(200);
    expect(first.body).toEqual({ ok: true, duplicate: false });
    const again = await webhook(reviewed(m.id, '2')).expect(200);
    expect(again.body).toEqual({ ok: true, duplicate: true });
    // A different delivery with the same result changes nothing either.
    await webhook({ ...reviewed(m.id, '3'), type: 'applicantPersonalInfoChanged' }).expect(200);

    const user = (await db.query('SELECT kyc_level, legal_name FROM users WHERE id = $1', [m.id])).rows[0];
    expect(user).toEqual({ kyc_level: 1, legal_name: '김철수' });
    expect(await notifications(m.id)).toEqual([{ type: 'kyc.approved', data: {} }]);
    const audit = await db.query("SELECT actor_type FROM audit_logs WHERE action = 'user.kyc_approved' AND target_id = $1", [
      m.id,
    ]);
    expect(audit.rows).toEqual([{ actor_type: 'system' }]);
    const status = await http().get('/kyc').set(bearer(m.token)).expect(200);
    expect(status.body).toMatchObject({ kycLevel: 1, applicant: { reviewStatus: 'completed', reviewAnswer: 'GREEN' } });
    expect(status.body.applicant).not.toHaveProperty('clientComment');
    const token = await http().post('/kyc/token').set(bearer(m.token)).expect(409);
    expect(token.body.error.code).toBe('invalid_transition');
  });

  it('lets the member retry after a soft rejection and revokes on a final one', async () => {
    const m = await member('red@example.com');
    sumsub.applicants.set(
      m.id,
      applicant(m.id, {
        reviewStatus: 'completed',
        reviewAnswer: 'RED',
        rejectType: 'RETRY',
        rejectLabels: ['BAD_PROOF_OF_IDENTITY'],
        moderationComment: '신분증 사진이 흐립니다.',
        clientComment: '재제출 필요',
      }),
    );
    await webhook(reviewed(m.id, '1')).expect(200);
    expect(await notifications(m.id)).toEqual([
      { type: 'kyc.rejected', data: { final: 'false', comment: '신분증 사진이 흐립니다.' } },
    ]);
    await http().post('/kyc/token').set(bearer(m.token)).expect(200);

    // An operator had let this member through by hand; a final rejection takes that back.
    await db.query('UPDATE users SET kyc_level = 1 WHERE id = $1', [m.id]);
    sumsub.applicants.set(
      m.id,
      applicant(m.id, { reviewStatus: 'completed', reviewAnswer: 'RED', rejectType: 'FINAL', rejectLabels: ['FORGERY'] }),
    );
    await webhook(reviewed(m.id, '2')).expect(200);
    expect((await db.query('SELECT kyc_level FROM users WHERE id = $1', [m.id])).rows[0].kyc_level).toBe(0);
    expect((await notifications(m.id)).at(-1)).toEqual({ type: 'kyc.rejected', data: { final: 'true', comment: null } });
    const token = await http().post('/kyc/token').set(bearer(m.token)).expect(403);
    expect(token.body.error.code).toBe('kyc_rejected');
  });

  it('ignores webhooks for someone who is not a member', async () => {
    await webhook({ type: 'applicantCreated', externalUserId: 'level-test-user', applicantId: 'x' }).expect(200);
    await webhook({ type: 'applicantCreated', externalUserId: '00000000-0000-0000-0000-000000000000' }).expect(200);
  });

  it('gives operators the KYC tab, a re-sync and a re-check, and the connection state', async () => {
    const m = await member('ops@example.com');
    const empty = await http().get(`/ops/users/${m.id}/kyc`).set(bearer(reviewer)).expect(200);
    expect(empty.body).toEqual({ configured: true, applicant: null, webhooks: [] });
    const noApplicant = await http()
      .post(`/ops/users/${m.id}/kyc/request-check`)
      .set(bearer(reviewer))
      .send({ reason: '재심사' })
      .expect(404);
    expect(noApplicant.body.error.code).toBe('not_found');

    // The approval webhook never came; the re-sync picks the result up from Sumsub.
    sumsub.applicants.set(
      m.id,
      applicant(m.id, { reviewStatus: 'completed', reviewAnswer: 'GREEN', clientComment: '정상' }),
    );
    const synced = await http().post(`/ops/users/${m.id}/kyc/sync`).set(bearer(reviewer)).expect(200);
    expect(synced.body.applicant).toMatchObject({
      applicantId: `app-${m.id.slice(0, 8)}`,
      reviewStatus: 'completed',
      reviewAnswer: 'GREEN',
      clientComment: '정상',
      consoleUrl: `https://cockpit.sumsub.com/checkus#/applicant/app-${m.id.slice(0, 8)}/basicInfo`,
    });
    expect((await db.query('SELECT kyc_level FROM users WHERE id = $1', [m.id])).rows[0].kyc_level).toBe(1);
    const approvedBy = await db.query(
      "SELECT actor_id FROM audit_logs WHERE action = 'user.kyc_approved' AND target_id = $1",
      [m.id],
    );
    expect(approvedBy.rows).toEqual([{ actor_id: reviewerId }]);

    await http().post(`/ops/users/${m.id}/kyc/request-check`).set(bearer(reviewer)).send({ reason: ' ' }).expect(400);
    await http()
      .post(`/ops/users/${m.id}/kyc/request-check`)
      .set(bearer(reviewer))
      .send({ reason: '서류 재확인' })
      .expect(200);
    expect(sumsub.checks).toEqual([`app-${m.id.slice(0, 8)}`]);

    const detail = await http().get(`/ops/users/${m.id}`).set(bearer(reviewer)).expect(200);
    expect(detail.body.history.map((h: { action: string }) => h.action)).toEqual([
      'user.kyc_request_check',
      'user.kyc_sync',
      'user.kyc_approved',
    ]);
    const grid = await http().get('/ops/users').query({ q: 'ops@example.com' }).set(bearer(reviewer)).expect(200);
    expect(grid.body.users[0]).toMatchObject({ sumsubStatus: 'completed', sumsubAnswer: 'GREEN', kycLevel: 1 });

    const settings = await http().get('/ops/settings/kyc').set(bearer(reviewer)).expect(200);
    expect(settings.body.kyc).toMatchObject({ configured: true, levelName: 'basic-kyc' });
    expect(settings.body.kyc.webhooksLast24h).toBeGreaterThan(0);
    expect(JSON.stringify(settings.body)).not.toContain(SECRET);
  });

  it('reports itself as not set up without the Sumsub keys', async () => {
    const off = new KycService(db, null);
    const m = await member('off@example.com');
    expect(await off.status(m.id)).toMatchObject({ available: false });
    await expect(off.accessToken(m.id)).rejects.toMatchObject({ code: 'kyc_unavailable' });
    await expect(off.handleWebhook(Buffer.from('{}'), 'x', undefined)).rejects.toMatchObject({ code: 'kyc_unavailable' });
    expect(await off.connection()).toMatchObject({ configured: false, levelName: null });
  });
});

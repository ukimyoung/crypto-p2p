import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import {
  PHONE_CODE_DAILY_LIMIT,
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODE_RESEND_SECONDS,
  PHONE_CODE_TTL_SECONDS,
  PhoneVerificationService,
  smsText,
} from '../src/auth/phone-verification.service';
import { Db } from '../src/db/database';
import { loadSmsSender, SolapiSmsSender, TwilioSmsSender } from '../src/sms/sms';
import { MemoryEmailSender, MemorySmsSender, setupDb, signUpConfirmed } from './helpers';

describe('phone verification by SMS', () => {
  let db: Db;
  let clock: Date;
  const sms = new MemorySmsSender();
  let phones: PhoneVerificationService;
  let auth: AuthService;
  const mail = new MemoryEmailSender();
  let seq = 0;

  const later = (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000));
  const member = async () => (await signUpConfirmed(auth, mail, `pv${++seq}@example.com`, 'test password 123')).id;
  const KR = { country: 'KR', number: '010-7777-0001' };

  beforeAll(async () => {
    db = await setupDb();
    auth = new AuthService(db, mail, { sessionTtlHours: 12, maxFailedLogins: 5, lockoutMinutes: 15, appUrl: 'http://x', signupLinkTtlHours: 24 });
    phones = new PhoneVerificationService(db, auth, sms, () => clock);
  });
  beforeEach(() => {
    clock = new Date('2026-11-11T00:00:00Z');
    sms.fail = false;
  });
  afterAll(async () => {
    await db?.end();
  });

  it('texts a 6-digit code in the member language and saves the number once it is typed', async () => {
    const id = await member();
    await phones.sendCode(id, KR);
    const text = sms.sent.at(-1)!;
    expect(text).toMatchObject({ to: '+821077770001', country: 'KR' });
    expect(text.text).toMatch(/^\[P2P Club\] 인증번호 \[\d{6}\]를 입력해 주세요\.$/);
    // Korean SMS counts 2 bytes for each Hangul letter.
    expect([...smsText('123456', 'ko')].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0)).toBeLessThanOrEqual(90);

    const me = await phones.confirm(id, ` ${sms.codeFor('+821077770001')} `);
    expect(me).toMatchObject({ phone: '+82 10-7777-0001', phoneVerified: true });
    await expect(phones.sendCode(id, KR)).rejects.toMatchObject({ code: 'phone_already_verified' });
  });

  it('only accepts the newest code, before it expires', async () => {
    const id = await member();
    const number = { country: 'KR', number: '010-7777-0002' };
    await phones.sendCode(id, number);
    const first = sms.codeFor('+821077770002');
    later(PHONE_CODE_RESEND_SECONDS);
    await phones.sendCode(id, number);
    const second = sms.codeFor('+821077770002');
    if (first !== second) await expect(phones.confirm(id, first)).rejects.toMatchObject({ code: 'invalid_phone_code' });

    later(PHONE_CODE_TTL_SECONDS);
    await expect(phones.confirm(id, second)).rejects.toMatchObject({ code: 'phone_code_expired' });
  });

  it('stops a code after too many wrong tries', async () => {
    const id = await member();
    await phones.sendCode(id, { country: 'KR', number: '010-7777-0003' });
    const code = sms.codeFor('+821077770003');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < PHONE_CODE_MAX_ATTEMPTS; i++) {
      await expect(phones.confirm(id, wrong)).rejects.toMatchObject({ code: 'invalid_phone_code' });
    }
    await expect(phones.confirm(id, wrong)).rejects.toMatchObject({ code: 'phone_code_expired' });
    await expect(phones.confirm(id, code)).rejects.toMatchObject({ code: 'phone_code_expired' });
    await expect(phones.confirm(id, '12345')).rejects.toMatchObject({ code: 'invalid_phone_code' });
  });

  it('limits how often codes are sent', async () => {
    const id = await member();
    const number = { country: 'KR', number: '010-7777-0004' };
    await phones.sendCode(id, number);
    await expect(phones.sendCode(id, number)).rejects.toMatchObject({ code: 'phone_code_resend_wait' });
    for (let i = 1; i < PHONE_CODE_DAILY_LIMIT; i++) {
      later(PHONE_CODE_RESEND_SECONDS);
      await phones.sendCode(id, number);
    }
    later(PHONE_CODE_RESEND_SECONDS);
    await expect(phones.sendCode(id, number)).rejects.toMatchObject({ code: 'phone_code_daily_limit' });
    // Another account cannot keep texting the same number either.
    const other = await member();
    await expect(phones.sendCode(other, number)).rejects.toMatchObject({ code: 'phone_code_daily_limit' });
    later(24 * 3600);
    await phones.sendCode(id, number);
  });

  it('lets the member retry right away when the text could not be sent', async () => {
    const id = await member();
    sms.fail = true;
    await expect(phones.sendCode(id, { country: 'KR', number: '010-7777-0005' })).rejects.toMatchObject({ code: 'sms_unavailable' });
    sms.fail = false;
    await phones.sendCode(id, { country: 'KR', number: '010-7777-0005' });
  });
});

describe('SMS senders', () => {
  function fakeFetch() {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fn };
  }

  it('picks the service from the environment', () => {
    expect(loadSmsSender({}).name).toBe('log');
    expect(loadSmsSender({ SOLAPI_API_KEY: 'k', SOLAPI_API_SECRET: 's', SMS_FROM: '02-123-4567' }).name).toBe('Solapi');
    expect(loadSmsSender({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', SMS_FROM: '+15005550006' }).name).toBe('Twilio');
    expect(() => loadSmsSender({ SOLAPI_API_KEY: 'k', SOLAPI_API_SECRET: 's' })).toThrow(/SMS_FROM/);
    expect(() => loadSmsSender({ SMS_PROVIDER: 'other' })).toThrow(/solapi or twilio/);
  });

  it('sends through Solapi with a signed request', async () => {
    const { calls, fn } = fakeFetch();
    const sender = new SolapiSmsSender({ apiKey: 'key', apiSecret: 'secret', from: '02-123-4567', baseUrl: 'https://api.solapi.com' }, fn);
    await sender.send({ to: '+821012345678', country: 'KR', text: 'hi' });
    await sender.send({ to: '+14155550100', country: 'US', text: 'hi' });
    expect(calls[0]!.url).toBe('https://api.solapi.com/messages/v4/send');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toMatch(
      /^HMAC-SHA256 apiKey=key, date=\S+, salt=[0-9a-f]{32}, signature=[0-9a-f]{64}$/,
    );
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ message: { to: '01012345678', from: '021234567', text: 'hi' } });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ message: { to: '4155550100', from: '021234567', text: 'hi', country: '1' } });
  });

  it('sends through Twilio', async () => {
    const { calls, fn } = fakeFetch();
    const sender = new TwilioSmsSender({ accountSid: 'AC1', authToken: 't', from: '+15005550006', baseUrl: 'https://api.twilio.com' }, fn);
    await sender.send({ to: '+821012345678', country: 'KR', text: 'hi' });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(String(calls[0]!.init.body)).toBe('To=%2B821012345678&Body=hi&From=%2B15005550006');
  });
});

import { describe, expect, it } from 'vitest';
import { loadResendConfig, ResendEmailSender } from '../src/notifications/resend.client';

describe('Resend email sender', () => {
  it('reads its settings from the environment', () => {
    expect(loadResendConfig({})).toBeNull();
    expect(() => loadResendConfig({ RESEND_API_KEY: 're_x' })).toThrow(/EMAIL_FROM/);
    expect(loadResendConfig({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'P2P <no-reply@mail.example.com>' })).toEqual({
      apiKey: 're_x',
      from: 'P2P <no-reply@mail.example.com>',
      baseUrl: 'https://api.resend.com',
    });
  });

  it('posts the message to the Resend API and reports refusals', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 200;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 200 ? '{"id":"e1"}' : '{"message":"domain not verified"}', { status });
    }) as unknown as typeof fetch;
    const sender = new ResendEmailSender(
      { apiKey: 're_x', from: 'P2P <no-reply@mail.example.com>', baseUrl: 'https://api.resend.com' },
      fakeFetch,
    );

    await sender.send({ to: 'a@example.com', subject: 'Hi', body: 'text', html: '<p>html</p>' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_x');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: 'P2P <no-reply@mail.example.com>',
      to: ['a@example.com'],
      subject: 'Hi',
      text: 'text',
      html: '<p>html</p>',
    });

    status = 403;
    await expect(sender.send({ to: 'a@example.com', subject: 'Hi', body: 'text' })).rejects.toThrow(/403.*domain not verified/);
  });

  it('sends a Resend template in place of the subject and content when the message names one', async () => {
    const bodies: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{"id":"e1"}', { status: 200 });
    }) as unknown as typeof fetch;
    const sender = new ResendEmailSender(
      { apiKey: 're_x', from: 'P2P Club <no-reply@p2pclub.biz>', baseUrl: 'https://api.resend.com' },
      fakeFetch,
    );

    await sender.send({
      to: 'a@example.com',
      subject: 'fallback',
      body: 'fallback',
      html: '<p>fallback</p>',
      template: { id: 'signup-verify-ko', variables: { VERIFY_URL: 'https://p2pclub.biz/x', NICKNAME: 'nectar', EXPIRES_HOURS: 24 } },
    });
    expect(bodies[0]).toEqual({
      from: 'P2P Club <no-reply@p2pclub.biz>',
      to: ['a@example.com'],
      template: { id: 'signup-verify-ko', variables: { VERIFY_URL: 'https://p2pclub.biz/x', NICKNAME: 'nectar', EXPIRES_HOURS: 24 } },
    });
  });
});

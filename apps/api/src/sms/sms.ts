import { createHmac, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PHONE_COUNTRIES } from '../auth/phone';

export interface SmsMessage {
  /** E.164, such as +821012345678. */
  to: string;
  /** ISO country of `to`, such as KR. */
  country: string;
  text: string;
}

export interface SmsSender {
  /** Shown in the startup log. */
  readonly name: string;
  send(message: SmsMessage): Promise<void>;
}

/**
 * Used when no SMS service is set up (local development, the hosted demo before keys are added):
 * writes the message, code included, to the log instead of sending it.
 */
export class LogSmsSender implements SmsSender {
  readonly name = 'log';
  private readonly logger = new Logger('SMS');

  async send(message: SmsMessage): Promise<void> {
    this.logger.log(`(not sent) to=${message.to} ${message.text}`);
  }
}

export interface SolapiConfig {
  apiKey: string;
  apiSecret: string;
  /** Sender number registered (발신번호 등록) in Solapi, such as 0212345678. */
  from: string;
  baseUrl: string;
}

/** Sends SMS through Solapi (https://developers.solapi.com/references/messages/sendSimpleMessage). */
export class SolapiSmsSender implements SmsSender {
  readonly name = 'Solapi';

  constructor(
    private readonly config: SolapiConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<void> {
    const dial = PHONE_COUNTRIES[message.country] ?? '82';
    let to = message.to.replace(/^\+/, '').slice(dial.length);
    // Solapi takes Korean numbers the local way (01012345678) and others without the calling code.
    if (message.country === 'KR') to = `0${to}`;
    const date = new Date().toISOString();
    const salt = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', this.config.apiSecret).update(date + salt).digest('hex');
    const res = await this.fetchFn(`${this.config.baseUrl}/messages/v4/send`, {
      method: 'POST',
      headers: {
        Authorization: `HMAC-SHA256 apiKey=${this.config.apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: { to, from: this.config.from.replace(/\D/g, ''), text: message.text, ...(dial === '82' ? {} : { country: dial }) },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Solapi answered ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** A Twilio phone number (+1...) or a Messaging Service SID (MG...). */
  from: string;
  baseUrl: string;
}

/** Sends SMS through Twilio's Messages API (https://www.twilio.com/docs/messaging/api/message-resource). */
export class TwilioSmsSender implements SmsSender {
  readonly name = 'Twilio';

  constructor(
    private readonly config: TwilioConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<void> {
    const form = new URLSearchParams({ To: message.to, Body: message.text });
    form.set(this.config.from.startsWith('MG') ? 'MessagingServiceSid' : 'From', this.config.from);
    const basic = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    const res = await this.fetchFn(`${this.config.baseUrl}/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Twilio answered ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
}

/**
 * Picks the SMS service from the environment. `SMS_PROVIDER` (solapi or twilio) chooses one;
 * left empty, whichever has its keys set is used. With neither, codes go to the log.
 */
export function loadSmsSender(env: NodeJS.ProcessEnv = process.env): SmsSender {
  const provider = (env.SMS_PROVIDER || (env.SOLAPI_API_KEY ? 'solapi' : env.TWILIO_ACCOUNT_SID ? 'twilio' : '')).toLowerCase();
  if (!provider || provider === 'log') return new LogSmsSender();
  const from = env.SMS_FROM;
  if (provider === 'solapi') {
    if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET) throw new Error('SOLAPI_API_KEY and SOLAPI_API_SECRET are needed for Solapi');
    if (!from) throw new Error('SMS_FROM is not set (the sender number registered in Solapi)');
    return new SolapiSmsSender({
      apiKey: env.SOLAPI_API_KEY,
      apiSecret: env.SOLAPI_API_SECRET,
      from,
      baseUrl: env.SOLAPI_BASE_URL ?? 'https://api.solapi.com',
    });
  }
  if (provider === 'twilio') {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are needed for Twilio');
    if (!from) throw new Error('SMS_FROM is not set (a Twilio number or Messaging Service SID)');
    return new TwilioSmsSender({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      from,
      baseUrl: env.TWILIO_BASE_URL ?? 'https://api.twilio.com',
    });
  }
  throw new Error(`SMS_PROVIDER must be solapi or twilio, not ${provider}`);
}

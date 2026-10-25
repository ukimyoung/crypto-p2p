import { EmailMessage, EmailSender } from './email.worker';

export interface ResendConfig {
  apiKey: string;
  /** Sender shown to members, e.g. `P2P <no-reply@mail.example.com>`. Its domain must be verified in Resend. */
  from: string;
  baseUrl: string;
}

/** Reads the Resend settings from the environment; null when no API key is set. */
export function loadResendConfig(env: NodeJS.ProcessEnv = process.env): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return null;
  const from = env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is not set (needed with RESEND_API_KEY)');
  return { apiKey, from, baseUrl: env.RESEND_BASE_URL ?? 'https://api.resend.com' };
}

/** Sends email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly config: ResendConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchFn(`${this.config.baseUrl}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.config.from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend answered ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
}

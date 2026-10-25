import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../config';
import { Db, withTransaction } from '../db/database';
import { CONFIG, DB, EMAIL_SENDER } from '../tokens';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. */
  body: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Used when no Resend API key is set (local development, the hosted demo): writes the
 * message to the log instead of sending it, so a signup link can be copied from there.
 */
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`(not sent) to=${message.to} subject=${message.subject}\n${message.body}`);
  }
}

const MAX_ATTEMPTS = 5;
const BATCH = 20;

/**
 * Sends queued emails. Rows are claimed with SKIP LOCKED, so several
 * instances can run this without sending the same email twice.
 */
@Injectable()
export class EmailWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EmailWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.emailIntervalSeconds <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.config.emailIntervalSeconds * 1000);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Sends one batch. Returns how many were sent. */
  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await withTransaction(this.db, async (tx) => {
        const { rows } = await tx.query(
          `SELECT * FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= $1
           ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
          [now, BATCH],
        );
        let sent = 0;
        for (const row of rows) {
          try {
            await this.sender.send({ to: row.to_address, subject: row.subject, body: row.body });
            await tx.query(
              `UPDATE email_outbox SET status = 'sent', sent_at = $2, attempts = attempts + 1 WHERE id = $1`,
              [row.id, now],
            );
            sent++;
          } catch (err) {
            const attempts = row.attempts + 1;
            // 1, 2, 4, 8 minutes between tries, then give up.
            await tx.query(
              `UPDATE email_outbox SET attempts = $2::int, last_error = $3, next_attempt_at = $4,
                      status = CASE WHEN $2::int >= $5::int THEN 'failed' ELSE 'pending' END
               WHERE id = $1`,
              [row.id, attempts, String(err), new Date(now.getTime() + 2 ** (attempts - 1) * 60_000), MAX_ATTEMPTS],
            );
          }
        }
        return sent;
      });
    } catch (err) {
      this.logger.error(err);
      return 0;
    } finally {
      this.running = false;
    }
  }
}

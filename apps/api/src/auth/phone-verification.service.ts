import { Logger } from '@nestjs/common';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { SmsSender } from '../sms/sms';
import { AuthService, Me, PhoneInput } from './auth.service';
import { formatPhone, normalizePhone } from './phone';

/** Seconds a code can be used. */
export const PHONE_CODE_TTL_SECONDS = 180;
/** Seconds before another code can be sent to the same member. */
export const PHONE_CODE_RESEND_SECONDS = 60;
/** Wrong codes allowed before the code stops working and a new one is needed. */
export const PHONE_CODE_MAX_ATTEMPTS = 5;
/** Codes a member, or a number, can be sent in 24 hours. Keeps SMS costs and abuse in check. */
export const PHONE_CODE_DAILY_LIMIT = 10;

export interface PhoneCodeSent {
  /** The number the code went to, as shown to the member (+82 10-1234-5678). */
  phone: string;
  expiresAt: string;
  /** When another code can be asked for. */
  resendAt: string;
}

/** Confirms a member's phone number with a 6-digit code sent by SMS, then saves the number. */
export class PhoneVerificationService {
  private readonly logger = new Logger('PhoneVerification');

  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly sms: SmsSender,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Sends a new code to the number. An earlier code that was not used stops working. */
  async sendCode(userId: string, input: PhoneInput): Promise<PhoneCodeSent> {
    const phone = normalizePhone(input.country, input.number);
    const now = this.now();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    const { id, locale } = await withTransaction(this.db, async (tx) => {
      // Locking the member's row keeps two quick clicks from sending two codes.
      const user = await tx.query<{ phone: string | null; phone_verified_at: Date | null; locale: string }>(
        'SELECT phone, phone_verified_at, locale FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const me = user.rows[0];
      if (!me) throw new DomainError('not_found', 'Member not found');
      if (me.phone === phone.e164 && me.phone_verified_at) {
        throw new DomainError('phone_already_verified', 'This phone number is already verified');
      }
      const taken = await tx.query('SELECT 1 FROM users WHERE phone = $1 AND id <> $2', [phone.e164, userId]);
      if (taken.rowCount) throw new DomainError('phone_taken', 'This phone number is already registered');

      const recent = await tx.query<{ last: Date | null; count: string }>(
        `SELECT max(sent_at) AS last, count(*) AS count FROM phone_verifications
          WHERE user_id = $1 AND sent_at > $2::timestamptz - interval '24 hours'`,
        [userId, now],
      );
      const last = recent.rows[0]?.last;
      if (last && now.getTime() - last.getTime() < PHONE_CODE_RESEND_SECONDS * 1000) {
        throw new DomainError('phone_code_resend_wait', 'Wait a minute before asking for another code');
      }
      const toNumber = await tx.query<{ count: string }>(
        `SELECT count(*) AS count FROM phone_verifications WHERE phone = $1 AND sent_at > $2::timestamptz - interval '24 hours'`,
        [phone.e164, now],
      );
      if (Number(recent.rows[0]?.count ?? 0) >= PHONE_CODE_DAILY_LIMIT || Number(toNumber.rows[0]?.count ?? 0) >= PHONE_CODE_DAILY_LIMIT) {
        throw new DomainError('phone_code_daily_limit', 'Too many codes were sent today. Try again tomorrow');
      }

      const id = randomUUID();
      await tx.query(
        `INSERT INTO phone_verifications (id, user_id, phone, phone_country, code_hash, sent_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6::timestamptz + make_interval(secs => $7))`,
        [id, userId, phone.e164, phone.country, hashCode(id, code), now, PHONE_CODE_TTL_SECONDS],
      );
      return { id, locale: me.locale };
    });

    try {
      await this.sms.send({ to: phone.e164, country: phone.country, text: smsText(code, locale) });
    } catch (err) {
      // The code never arrived: drop it so it neither counts against the limits nor blocks a retry.
      await this.db.query('DELETE FROM phone_verifications WHERE id = $1', [id]);
      this.logger.error(`SMS to ${phone.e164} failed: ${String(err)}`);
      throw new DomainError('sms_unavailable', 'The text message could not be sent. Try again later');
    }

    return {
      phone: formatPhone(phone.e164, phone.country)!,
      expiresAt: new Date(now.getTime() + PHONE_CODE_TTL_SECONDS * 1000).toISOString(),
      resendAt: new Date(now.getTime() + PHONE_CODE_RESEND_SECONDS * 1000).toISOString(),
    };
  }

  /** Checks the code from the latest SMS and, when it matches, saves the number as verified. */
  async confirm(userId: string, rawCode: string): Promise<Me> {
    const code = rawCode.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) throw new DomainError('invalid_phone_code', 'Enter the 6-digit code');
    const now = this.now();

    const outcome = await withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        phone: string;
        phone_country: string;
        code_hash: Buffer;
        attempts: number;
        expires_at: Date;
      }>(
        `SELECT id, phone, phone_country, code_hash, attempts, expires_at FROM phone_verifications
          WHERE user_id = $1 AND verified_at IS NULL ORDER BY sent_at DESC LIMIT 1 FOR UPDATE`,
        [userId],
      );
      const row = rows[0];
      if (!row || row.expires_at <= now || row.attempts >= PHONE_CODE_MAX_ATTEMPTS) return 'expired' as const;
      const expected = hashCode(row.id, code);
      if (!timingSafeEqual(expected, row.code_hash)) {
        await tx.query('UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = $1', [row.id]);
        return row.attempts + 1 >= PHONE_CODE_MAX_ATTEMPTS ? ('expired' as const) : ('wrong' as const);
      }

      const before = await tx.query<{ phone_country: string | null; phone_verified_at: Date | null }>(
        'SELECT phone_country, phone_verified_at FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      await tx.query('UPDATE phone_verifications SET verified_at = $2 WHERE id = $1', [row.id, now]);
      await tx
        .query('UPDATE users SET phone = $2, phone_country = $3, phone_verified_at = $4 WHERE id = $1', [
          userId,
          row.phone,
          row.phone_country,
          now,
        ])
        .catch((err: { constraint?: string }) => {
          if (err.constraint === 'users_phone_key') {
            throw new DomainError('phone_taken', 'This phone number is already registered');
          }
          throw err;
        });
      await writeAudit(
        tx,
        { type: 'user', id: userId },
        'user.phone_change',
        { type: 'user', id: userId },
        { phoneCountry: before.rows[0]?.phone_country ?? null, verified: Boolean(before.rows[0]?.phone_verified_at) },
        { phoneCountry: row.phone_country, verified: true },
      );
      return 'verified' as const;
    });

    if (outcome === 'wrong') throw new DomainError('invalid_phone_code', 'The code does not match');
    if (outcome === 'expired') {
      throw new DomainError('phone_code_expired', 'The code has expired or was typed wrong too many times. Ask for a new one');
    }
    return this.auth.me(userId);
  }
}

function hashCode(id: string, code: string): Buffer {
  return createHash('sha256').update(`${id}:${code}`).digest();
}

/** Kept within one Korean SMS (90 bytes) so it is not billed as a long message. */
export function smsText(code: string, locale: string): string {
  return locale === 'en'
    ? `[P2P Club] Your verification code is ${code}. It expires in 3 minutes.`
    : `[P2P Club] 인증번호 [${code}]를 입력해 주세요.`;
}

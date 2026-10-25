import { createHash, randomBytes } from 'node:crypto';
import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password';
import { formatPhone, nationalPhone, normalizePhone } from './phone';
import { SecretBox } from './secret-box';
import { generateSecret, matchCode, otpauthUrl } from './totp';

export interface AuthConfig {
  sessionTtlHours: number;
  /** Failed logins allowed per email within `lockoutMinutes` before login is refused. */
  maxFailedLogins: number;
  lockoutMinutes: number;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface Me {
  id: string;
  email: string;
  kycLevel: number;
  status: string;
  otpEnabled: boolean;
  /** Language for emails and, on a new device, for the site. */
  locale: 'ko' | 'en';
  /** +82 10-1234-5678. Null for members who joined before phone numbers were asked. */
  phone: string | null;
  /** ISO country the number belongs to, and the number in local form (010-1234-5678), for editing. */
  phoneCountry: string | null;
  phoneNational: string | null;
}

export interface PhoneInput {
  country: string;
  number: string;
}

/** Password login, opaque bearer sessions and app OTP (PRD AUTH-1, AUTH-3). */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly config: AuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async signUp(rawEmail: string, password: string, rawPhone: PhoneInput): Promise<Me> {
    const email = normalizeEmail(rawEmail);
    const phone = normalizePhone(rawPhone.country, rawPhone.number);
    assertPasswordPolicy(password);
    const passwordHash = await hashPassword(password);
    const { rows } = await this.db
      .query(
        `INSERT INTO users (email, password_hash, phone, phone_country) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING
         RETURNING *`,
        [email, passwordHash, phone.e164, phone.country],
      )
      .catch(phoneTaken);
    if (!rows[0]) throw new DomainError('email_taken', 'This email is already registered');
    return toMe(rows[0]);
  }

  /** Adds or changes the member's phone number. Once OTP is on, a code is needed. */
  async setPhone(userId: string, rawPhone: PhoneInput, otp: string | undefined): Promise<Me> {
    const phone = normalizePhone(rawPhone.country, rawPhone.number);
    const before = await this.me(userId);
    if (before.otpEnabled) {
      if (!otp) throw new DomainError('otp_required', 'An OTP code is required');
      await this.verifyOtp(userId, otp);
    }
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx
        .query('UPDATE users SET phone = $2, phone_country = $3 WHERE id = $1 RETURNING *', [
          userId,
          phone.e164,
          phone.country,
        ])
        .catch(phoneTaken);
      await writeAudit(
        tx,
        { type: 'user', id: userId },
        'user.phone_change',
        { type: 'user', id: userId },
        { phoneCountry: before.phoneCountry },
        { phoneCountry: phone.country },
      );
      return toMe(rows[0]);
    });
  }

  /** Returns a bearer token. Once OTP is enabled, a valid code is required too. */
  async login(rawEmail: string, password: string, otp: string | undefined, meta: RequestMeta): Promise<string> {
    const email = normalizeEmail(rawEmail);

    const failures = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM login_attempts
       WHERE email = $1 AND NOT success AND created_at > $2`,
      [email, new Date(this.now().getTime() - this.config.lockoutMinutes * 60_000)],
    );
    if (Number(failures.rows[0]!.n) >= this.config.maxFailedLogins) {
      await this.recordAttempt(email, null, false, 'locked', meta);
      throw new DomainError('too_many_attempts', 'Too many failed logins. Try again later');
    }

    const { rows } = await this.db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    // Same error for unknown email and wrong password so emails cannot be probed.
    if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      await this.recordAttempt(email, user?.id ?? null, false, 'bad_credentials', meta);
      throw new DomainError('invalid_credentials', 'Email or password is incorrect');
    }
    if (user.status === 'closed') {
      await this.recordAttempt(email, user.id, false, 'closed', meta);
      throw new DomainError('account_closed', 'This account is closed');
    }
    if (user.otp_enabled) {
      if (!otp) {
        await this.recordAttempt(email, user.id, false, 'otp_missing', meta);
        throw new DomainError('otp_required', 'An OTP code is required');
      }
      try {
        await this.verifyOtp(user.id, otp);
      } catch (err) {
        await this.recordAttempt(email, user.id, false, 'otp_invalid', meta);
        throw err;
      }
    }

    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO sessions (user_id, token_hash, ip, user_agent, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.id,
        hashToken(token),
        meta.ip ?? null,
        meta.userAgent ?? null,
        this.now(),
        new Date(this.now().getTime() + this.config.sessionTtlHours * 3_600_000),
      ],
    );
    await this.recordAttempt(email, user.id, true, null, meta);
    return token;
  }

  /** Resolves a bearer token to a user id, or null if it is unknown, expired or revoked. */
  async authenticate(token: string): Promise<string | null> {
    const { rows } = await this.db.query<{ user_id: string }>(
      `SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.status <> 'closed'`,
      [hashToken(token), this.now()],
    );
    return rows[0]?.user_id ?? null;
  }

  async logout(token: string): Promise<void> {
    await this.db.query('UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL', [
      hashToken(token),
      this.now(),
    ]);
  }

  async me(userId: string): Promise<Me> {
    const { rows } = await this.db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new DomainError('not_found', 'User not found');
    return toMe(rows[0]);
  }

  /** Starts OTP setup. The secret is shown once; OTP turns on only after `enableOtp`. */
  async setupOtp(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const me = await this.me(userId);
    if (me.otpEnabled) throw new DomainError('otp_already_enabled', 'OTP is already enabled');
    const secret = generateSecret();
    await this.db.query('UPDATE users SET otp_secret_enc = $2 WHERE id = $1', [userId, this.secrets.seal(secret)]);
    return { secret, otpauthUrl: otpauthUrl(secret, me.email) };
  }

  async enableOtp(userId: string, code: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const user = rows[0];
      if (user.otp_enabled) throw new DomainError('otp_already_enabled', 'OTP is already enabled');
      if (!user.otp_secret_enc) throw new DomainError('otp_not_set_up', 'Start OTP setup first');
      const counter = matchCode(this.secrets.open(user.otp_secret_enc), code, this.now());
      if (counter === null) throw new DomainError('invalid_otp', 'The OTP code is incorrect');
      await tx.query('UPDATE users SET otp_enabled = true, otp_last_counter = $2 WHERE id = $1', [userId, counter]);
      await writeAudit(tx, { type: 'user', id: userId }, 'user.otp_enable', { type: 'user', id: userId }, null, null);
    });
  }

  /** Checks an OTP code for a sensitive action. Each code is accepted once. */
  async verifyOtp(userId: string, code: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const user = rows[0];
      if (!user?.otp_enabled) throw new DomainError('otp_not_enabled', 'Enable OTP first');
      const counter = matchCode(this.secrets.open(user.otp_secret_enc), code, this.now());
      if (counter === null || (user.otp_last_counter !== null && counter <= Number(user.otp_last_counter))) {
        throw new DomainError('invalid_otp', 'The OTP code is incorrect or already used');
      }
      await tx.query('UPDATE users SET otp_last_counter = $2 WHERE id = $1', [userId, counter]);
    });
  }

  async setLocale(userId: string, locale: 'ko' | 'en'): Promise<void> {
    await this.db.query('UPDATE users SET locale = $2 WHERE id = $1', [userId, locale]);
  }

  /** AUTH-3: trading needs OTP turned on. */
  async assertOtpEnabled(userId: string): Promise<void> {
    if (!(await this.me(userId)).otpEnabled) {
      throw new DomainError('otp_not_enabled', 'Enable OTP before trading');
    }
  }

  private async recordAttempt(
    email: string,
    userId: string | null,
    success: boolean,
    reason: string | null,
    meta: RequestMeta,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO login_attempts (email, user_id, success, reason, ip, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [email, userId, success, reason, meta.ip ?? null, meta.userAgent ?? null, this.now()],
    );
  }
}

function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
    throw new DomainError('invalid_email', 'Email address is not valid');
  }
  return e;
}

function phoneTaken(err: unknown): never {
  if ((err as { code?: string; constraint?: string }).constraint === 'users_phone_key') {
    throw new DomainError('phone_taken', 'This phone number is already registered');
  }
  throw err;
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMe(row: any): Me {
  return {
    id: row.id,
    email: row.email,
    kycLevel: row.kyc_level,
    status: row.status,
    otpEnabled: row.otp_enabled,
    locale: row.locale,
    phone: formatPhone(row.phone, row.phone_country),
    phoneCountry: row.phone_country,
    phoneNational: nationalPhone(row.phone, row.phone_country),
  };
}

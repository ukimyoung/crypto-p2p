import { Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { EmailSender } from '../notifications/email.worker';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password';
import { formatPhone, nationalPhone, normalizePhone } from './phone';
import { SecretBox } from './secret-box';
import { signupEmail } from './signup-email';
import { generateSecret, matchCode, otpauthUrl } from './totp';

export interface AuthConfig {
  sessionTtlHours: number;
  /** Failed logins allowed per email within `lockoutMinutes` before login is refused. */
  maxFailedLogins: number;
  lockoutMinutes: number;
  /** Web app address; signup links point at `<appUrl>/signup/verify`. */
  appUrl: string;
  signupLinkTtlHours: number;
}

/** Seconds before another signup email can go to the same address. */
const SIGNUP_RESEND_SECONDS = 60;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface Me {
  id: string;
  email: string;
  /** Public name other members see, e.g. as the advertiser on the market. */
  nickname: string;
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

export interface SignUpInput {
  email: string;
  password: string;
  phone: PhoneInput;
  nickname: string;
  locale?: 'ko' | 'en';
}

/** Password login, opaque bearer sessions and app OTP (PRD AUTH-1, AUTH-3). */
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly mailer: EmailSender,
    private readonly config: AuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Starts a signup: checks the details, keeps them aside and emails a confirmation link.
   * The account is created only when the link is opened (`completeSignUp`).
   */
  async signUp(input: SignUpInput): Promise<{ email: string }> {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone.country, input.phone.number);
    const nickname = normalizeNickname(input.nickname);
    assertPasswordPolicy(input.password);
    const locale = input.locale ?? 'ko';

    const taken = await this.db.query<{ email: string; phone: string | null; nickname: string }>(
      'SELECT email, phone, nickname FROM users WHERE email = $1 OR phone = $2 OR lower(nickname) = lower($3)',
      [email, phone.e164, nickname],
    );
    if (taken.rows.some((u) => u.email === email)) {
      throw new DomainError('email_taken', 'This email is already registered');
    }
    if (taken.rows.some((u) => u.phone === phone.e164)) {
      throw new DomainError('phone_taken', 'This phone number is already registered');
    }
    if (taken.rows.length) throw new DomainError('nickname_taken', 'This nickname is already in use');

    const passwordHash = await hashPassword(input.password);
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    // Submitting again updates the details. A new link replaces the old one, but at most once a minute:
    // a quick second submit (a double click, say) keeps the link already on its way.
    const fresh = `signup_requests.sent_at <= $10`;
    const { rows } = await this.db.query<{ sent: boolean }>(
      `INSERT INTO signup_requests (email, password_hash, phone, phone_country, nickname, locale, token_hash, sent_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash, phone = EXCLUDED.phone, phone_country = EXCLUDED.phone_country,
         nickname = EXCLUDED.nickname, locale = EXCLUDED.locale,
         token_hash = CASE WHEN ${fresh} THEN EXCLUDED.token_hash ELSE signup_requests.token_hash END,
         sent_at = CASE WHEN ${fresh} THEN EXCLUDED.sent_at ELSE signup_requests.sent_at END,
         expires_at = CASE WHEN ${fresh} THEN EXCLUDED.expires_at ELSE signup_requests.expires_at END
       RETURNING token_hash = $7 AS sent`,
      [
        email,
        passwordHash,
        phone.e164,
        phone.country,
        nickname,
        locale,
        hashToken(token),
        now,
        this.linkExpiry(),
        new Date(now.getTime() - SIGNUP_RESEND_SECONDS * 1000),
      ],
    );
    if (rows[0]!.sent) await this.sendSignupEmail(email, locale, token);
    return { email };
  }

  /** Sends a fresh link for a signup that has not been confirmed yet. Says nothing about whether one exists. */
  async resendSignUp(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const { rows } = await this.db.query<{ locale: 'ko' | 'en' }>(
      `UPDATE signup_requests SET token_hash = $2, sent_at = $3, expires_at = $4
       WHERE email = $1 AND sent_at <= $5
       RETURNING locale`,
      [email, hashToken(token), now, this.linkExpiry(), new Date(now.getTime() - SIGNUP_RESEND_SECONDS * 1000)],
    );
    if (rows[0]) await this.sendSignupEmail(email, rows[0].locale, token);
  }

  /** Opens the link from the signup email: creates the account and logs the member in. */
  async completeSignUp(token: string, meta: RequestMeta): Promise<{ user: Me; token: string }> {
    const { rows } = await this.db.query('SELECT * FROM signup_requests WHERE token_hash = $1', [hashToken(token)]);
    const request = rows[0];
    if (!request) {
      throw new DomainError('invalid_signup_link', 'This link is not valid. It may have been used or replaced');
    }
    if (request.expires_at <= this.now()) {
      throw new DomainError('signup_link_expired', 'This link has expired. Sign up again to get a new one');
    }
    const user = await withTransaction(this.db, async (tx) => {
      // Locks the request so the link works once even if it is opened twice at the same moment.
      const locked = await tx.query('DELETE FROM signup_requests WHERE id = $1 RETURNING id', [request.id]);
      if (!locked.rows[0]) {
        throw new DomainError('invalid_signup_link', 'This link is not valid. It may have been used or replaced');
      }
      const created = await tx
        .query(
          `INSERT INTO users (email, password_hash, phone, phone_country, nickname, locale, email_verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (email) DO NOTHING
           RETURNING *`,
          [
            request.email,
            request.password_hash,
            request.phone,
            request.phone_country,
            request.nickname,
            request.locale,
            this.now(),
          ],
        )
        .catch(uniqueTaken);
      if (!created.rows[0]) throw new DomainError('email_taken', 'This email is already registered');
      await writeAudit(tx, { type: 'user', id: created.rows[0].id }, 'user.signup', { type: 'user', id: created.rows[0].id }, null, null);
      return toMe(created.rows[0]);
    }).catch(async (err) => {
      // Someone took the phone number or nickname in the meantime: the request cannot complete.
      if (err instanceof DomainError && err.code !== 'invalid_signup_link') {
        await this.db.query('DELETE FROM signup_requests WHERE id = $1', [request.id]);
      }
      throw err;
    });
    const session = await this.startSession(user.id, meta);
    await this.recordAttempt(user.email, user.id, true, 'signup', meta);
    return { user, token: session };
  }

  private linkExpiry(): Date {
    return new Date(this.now().getTime() + this.config.signupLinkTtlHours * 3_600_000);
  }

  private async sendSignupEmail(email: string, locale: 'ko' | 'en', token: string): Promise<void> {
    const link = `${this.config.appUrl}/signup/verify?token=${token}`;
    try {
      await this.mailer.send(signupEmail(email, locale, link, this.config.signupLinkTtlHours));
    } catch (err) {
      // Without the email the request is useless; drop it so the member can try again right away.
      await this.db.query('DELETE FROM signup_requests WHERE token_hash = $1', [hashToken(token)]);
      this.logger.error(`Signup email to ${email} failed: ${String(err)}`);
      throw new DomainError('email_unavailable', 'The confirmation email could not be sent. Try again later');
    }
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
        .catch(uniqueTaken);
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

  /** Changes the member's public nickname. */
  async setNickname(userId: string, rawNickname: string): Promise<Me> {
    const nickname = normalizeNickname(rawNickname);
    return withTransaction(this.db, async (tx) => {
      const before = await tx.query<{ nickname: string }>('SELECT nickname FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!before.rows[0]) throw new DomainError('not_found', 'User not found');
      const { rows } = await tx
        .query('UPDATE users SET nickname = $2 WHERE id = $1 RETURNING *', [userId, nickname])
        .catch(uniqueTaken);
      await writeAudit(
        tx,
        { type: 'user', id: userId },
        'user.nickname_change',
        { type: 'user', id: userId },
        { nickname: before.rows[0].nickname },
        { nickname },
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

    const token = await this.startSession(user.id, meta);
    await this.recordAttempt(email, user.id, true, null, meta);
    return token;
  }

  private async startSession(userId: string, meta: RequestMeta): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO sessions (user_id, token_hash, ip, user_agent, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        hashToken(token),
        meta.ip ?? null,
        meta.userAgent ?? null,
        this.now(),
        new Date(this.now().getTime() + this.config.sessionTtlHours * 3_600_000),
      ],
    );
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

/** 2–16 letters (Korean or Latin), digits or underscores. */
export function normalizeNickname(nickname: string): string {
  const n = nickname.trim().normalize('NFC');
  if (!/^[0-9A-Za-z_가-힣]{2,16}$/.test(n)) {
    throw new DomainError('invalid_nickname', 'A nickname is 2-16 letters, digits or underscores');
  }
  return n;
}

function uniqueTaken(err: unknown): never {
  const constraint = (err as { constraint?: string }).constraint;
  if (constraint === 'users_phone_key') {
    throw new DomainError('phone_taken', 'This phone number is already registered');
  }
  if (constraint === 'users_nickname_key') {
    throw new DomainError('nickname_taken', 'This nickname is already in use');
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
    nickname: row.nickname,
    kycLevel: row.kyc_level,
    status: row.status,
    otpEnabled: row.otp_enabled,
    locale: row.locale,
    phone: formatPhone(row.phone, row.phone_country),
    phoneCountry: row.phone_country,
    phoneNational: nationalPhone(row.phone, row.phone_country),
  };
}

import { createHash, randomBytes } from 'node:crypto';
import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password';
import { formatPhone, nationalPhone, normalizePhone } from './phone';

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
  /** Public name other members see, e.g. as the advertiser on the market. */
  nickname: string;
  /** True while the member still has the placeholder nickname given to accounts made before nicknames were asked. */
  temporaryNickname: boolean;
  /** Name the member typed at signup. Null for members who joined before it was asked. */
  firstName: string | null;
  lastName: string | null;
  kycLevel: number;
  status: string;
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
  firstName: string;
  lastName: string;
  locale?: 'ko' | 'en';
}

/** Password login and opaque bearer sessions (PRD AUTH-1). */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: AuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Creates the account and logs the member in. */
  async signUp(input: SignUpInput, meta: RequestMeta): Promise<{ user: Me; token: string }> {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone.country, input.phone.number);
    const nickname = normalizeNickname(input.nickname);
    const firstName = normalizePersonName(input.firstName);
    const lastName = normalizePersonName(input.lastName);
    assertPasswordPolicy(input.password);

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
    const user = await withTransaction(this.db, async (tx) => {
      const created = await tx
        .query(
          `INSERT INTO users (email, password_hash, phone, phone_country, nickname, locale, first_name, last_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (email) DO NOTHING
           RETURNING *`,
          [email, passwordHash, phone.e164, phone.country, nickname, input.locale ?? 'ko', firstName, lastName],
        )
        .catch(uniqueTaken);
      if (!created.rows[0]) throw new DomainError('email_taken', 'This email is already registered');
      await writeAudit(tx, { type: 'user', id: created.rows[0].id }, 'user.signup', { type: 'user', id: created.rows[0].id }, null, null);
      return toMe(created.rows[0]);
    });
    const token = await this.startSession(user.id, meta);
    await this.recordAttempt(user.email, user.id, true, 'signup', meta);
    return { user, token };
  }

  /** Adds or changes the member's phone number. */
  async setPhone(userId: string, rawPhone: PhoneInput): Promise<Me> {
    const phone = normalizePhone(rawPhone.country, rawPhone.number);
    const before = await this.me(userId);
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

  /**
   * Replaces the placeholder nickname of a member who joined before nicknames were asked.
   * A nickname the member chose cannot be changed.
   */
  async setNickname(userId: string, rawNickname: string): Promise<Me> {
    const nickname = normalizeNickname(rawNickname);
    return withTransaction(this.db, async (tx) => {
      const before = await tx.query<{ nickname: string }>('SELECT nickname FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!before.rows[0]) throw new DomainError('not_found', 'User not found');
      if (!isTemporaryNickname(before.rows[0].nickname)) {
        throw new DomainError('nickname_locked', 'The nickname cannot be changed');
      }
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

  /** Sets the first and last name of a member who joined before signup asked for it. A name once set cannot be changed. */
  async setName(userId: string, rawFirstName: string, rawLastName: string): Promise<Me> {
    const firstName = normalizePersonName(rawFirstName);
    const lastName = normalizePersonName(rawLastName);
    return withTransaction(this.db, async (tx) => {
      const before = await tx.query<{ first_name: string | null; last_name: string | null }>(
        'SELECT first_name, last_name FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!before.rows[0]) throw new DomainError('not_found', 'User not found');
      if (before.rows[0].first_name && before.rows[0].last_name) {
        throw new DomainError('name_locked', 'The name cannot be changed');
      }
      const { rows } = await tx.query('UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1 RETURNING *', [
        userId,
        firstName,
        lastName,
      ]);
      await writeAudit(
        tx,
        { type: 'user', id: userId },
        'user.name_change',
        { type: 'user', id: userId },
        { firstName: before.rows[0].first_name, lastName: before.rows[0].last_name },
        { firstName, lastName },
      );
      return toMe(rows[0]);
    });
  }

  /**
   * Changes the password after checking the current one. Wrong guesses count towards the same lockout as
   * logins. Every other session of the member is signed out; the one making the change stays signed in.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentToken: string,
    meta: RequestMeta,
  ): Promise<void> {
    const { rows } = await this.db.query('SELECT id, email, password_hash FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) throw new DomainError('not_found', 'User not found');

    const failures = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM login_attempts
       WHERE email = $1 AND NOT success AND created_at > $2`,
      [user.email, new Date(this.now().getTime() - this.config.lockoutMinutes * 60_000)],
    );
    if (Number(failures.rows[0]!.n) >= this.config.maxFailedLogins) {
      throw new DomainError('too_many_attempts', 'Too many failed attempts. Try again later');
    }
    if (!user.password_hash || !(await verifyPassword(currentPassword, user.password_hash))) {
      await this.recordAttempt(user.email, user.id, false, 'password_change', meta);
      throw new DomainError('wrong_password', 'The current password is incorrect');
    }
    assertPasswordPolicy(newPassword);
    if (newPassword === currentPassword) {
      throw new DomainError('same_password', 'Choose a password different from the current one');
    }

    const passwordHash = await hashPassword(newPassword);
    await withTransaction(this.db, async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
      await tx.query(
        'UPDATE sessions SET revoked_at = $3 WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL',
        [userId, hashToken(currentToken), this.now()],
      );
      await writeAudit(tx, { type: 'user', id: userId }, 'user.password_change', { type: 'user', id: userId }, null, null);
    });
  }

  /** Returns a bearer token. */
  async login(rawEmail: string, password: string, meta: RequestMeta): Promise<string> {
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

  async setLocale(userId: string, locale: 'ko' | 'en'): Promise<void> {
    await this.db.query('UPDATE users SET locale = $2 WHERE id = $1', [userId, locale]);
  }

  /** Trading needs identity verification (KYC level 1). */
  async assertKycVerified(userId: string): Promise<void> {
    if ((await this.me(userId)).kycLevel < 1) {
      throw new DomainError('kyc_required', 'Complete identity verification before trading');
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

/** 2–16 letters (Korean or Latin), digits or underscores. The placeholder form user_xxxxxxxx is reserved. */
export function normalizeNickname(nickname: string): string {
  const n = nickname.trim().normalize('NFC');
  if (!/^[0-9A-Za-z_가-힣]{2,16}$/.test(n) || isTemporaryNickname(n)) {
    throw new DomainError('invalid_nickname', 'A nickname is 2-16 letters, digits or underscores');
  }
  return n;
}

/** The placeholder migration 015 gave accounts made before nicknames were asked. */
function isTemporaryNickname(nickname: string): boolean {
  return /^user_[0-9a-f]{8}$/i.test(nickname);
}

/** A first or last name: 1-50 letters in any script, with spaces, hyphens, apostrophes or dots between. */
export function normalizePersonName(name: string): string {
  const n = name.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (n.length > 50 || !/^\p{L}\p{M}*(?:[\p{L}\p{M} .'’-]*[\p{L}\p{M}.])?$/u.test(n)) {
    throw new DomainError('invalid_name', 'Enter the first and last name in letters (up to 50 characters each)');
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
    temporaryNickname: isTemporaryNickname(row.nickname),
    firstName: row.first_name,
    lastName: row.last_name,
    kycLevel: row.kyc_level,
    status: row.status,
    locale: row.locale,
    phone: formatPhone(row.phone, row.phone_country),
    phoneCountry: row.phone_country,
    phoneNational: nationalPhone(row.phone, row.phone_country),
  };
}

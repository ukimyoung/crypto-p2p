import { createHash, randomBytes } from 'node:crypto';
import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../auth/password';
import { SecretBox } from '../auth/secret-box';
import { generateSecret, matchCode, otpauthUrl } from '../auth/totp';

export type OperatorRole = 'support' | 'reviewer' | 'admin';

/** Each role can do everything the roles before it can. */
const RANK: Record<OperatorRole, number> = { support: 1, reviewer: 2, admin: 3 };

export interface Operator {
  id: string;
  email: string;
  name: string;
  role: OperatorRole;
}

export interface OperatorAuthConfig {
  sessionTtlHours: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
}

/**
 * Staff accounts for the operations console. Kept apart from customer accounts:
 * separate table, separate sessions, OTP always required, no self sign-up.
 */
export class OperatorAuthService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly config: OperatorAuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Used by the CLI. Returns the OTP secret once so it can be put in an authenticator app. */
  async create(input: {
    email: string;
    name: string;
    role: OperatorRole;
    password: string;
  }): Promise<{ operator: Operator; otpSecret: string; otpauthUrl: string }> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('invalid_email', 'Email address is not valid');
    if (!(input.role in RANK)) throw new DomainError('invalid_request', `Unknown role ${input.role}`);
    assertPasswordPolicy(input.password);
    const otpSecret = generateSecret();
    const { rows } = await this.db.query(
      `INSERT INTO operators (email, name, role, password_hash, otp_secret_enc)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [email, input.name.trim(), input.role, await hashPassword(input.password), this.secrets.seal(otpSecret)],
    );
    if (!rows[0]) throw new DomainError('email_taken', 'This email is already registered');
    return { operator: toOperator(rows[0]), otpSecret, otpauthUrl: otpauthUrl(otpSecret, email, 'P2P Ops') };
  }

  async login(rawEmail: string, password: string, otp: string, meta: { ip?: string; userAgent?: string }) {
    const email = rawEmail.trim().toLowerCase();
    const failures = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM operator_login_attempts WHERE email = $1 AND NOT success AND created_at > $2`,
      [email, new Date(this.now().getTime() - this.config.lockoutMinutes * 60_000)],
    );
    if (Number(failures.rows[0]!.n) >= this.config.maxFailedLogins) {
      await this.recordAttempt(email, false, 'locked', meta.ip);
      throw new DomainError('too_many_attempts', 'Too many failed logins. Try again later');
    }

    const operatorId = await withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM operators WHERE email = $1 FOR UPDATE', [email]);
      const op = rows[0];
      // One error for every failure so staff emails cannot be probed.
      const fail = async (reason: string) => {
        await this.recordAttempt(email, false, reason, meta.ip);
        return new DomainError('invalid_credentials', 'Email, password or OTP code is incorrect');
      };
      if (!op || op.status !== 'active' || !(await verifyPassword(password, op.password_hash))) {
        throw await fail(op?.status === 'disabled' ? 'disabled' : 'bad_credentials');
      }
      const counter = matchCode(this.secrets.open(op.otp_secret_enc), otp, this.now());
      if (counter === null || (op.otp_last_counter !== null && counter <= Number(op.otp_last_counter))) {
        throw await fail('otp_invalid');
      }
      await tx.query('UPDATE operators SET otp_last_counter = $2 WHERE id = $1', [op.id, counter]);
      return op.id as string;
    });

    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO operator_sessions (operator_id, token_hash, ip, user_agent, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        operatorId,
        hashToken(token),
        meta.ip ?? null,
        meta.userAgent ?? null,
        this.now(),
        new Date(this.now().getTime() + this.config.sessionTtlHours * 3_600_000),
      ],
    );
    await this.recordAttempt(email, true, null, meta.ip);
    const actor = { type: 'operator' as const, id: operatorId };
    await withTransaction(this.db, (tx) =>
      writeAudit(tx, actor, 'operator.login', { type: 'operator', id: operatorId }, null, { ip: meta.ip ?? null }),
    );
    return token;
  }

  async authenticate(token: string): Promise<Operator | null> {
    const { rows } = await this.db.query(
      `SELECT o.* FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND o.status = 'active'`,
      [hashToken(token), this.now()],
    );
    return rows[0] ? toOperator(rows[0]) : null;
  }

  async logout(token: string): Promise<void> {
    await this.db.query('UPDATE operator_sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL', [
      hashToken(token),
      this.now(),
    ]);
  }

  private async recordAttempt(email: string, success: boolean, reason: string | null, ip?: string) {
    await this.db.query(
      'INSERT INTO operator_login_attempts (email, success, reason, ip, created_at) VALUES ($1, $2, $3, $4, $5)',
      [email, success, reason, ip ?? null, this.now()],
    );
  }
}

export function assertRole(operator: Operator, needed: OperatorRole): void {
  if (RANK[operator.role] < RANK[needed]) {
    throw new DomainError('forbidden', `This needs the ${needed} role`);
  }
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOperator(row: any): Operator {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

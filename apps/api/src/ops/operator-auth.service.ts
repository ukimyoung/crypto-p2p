import { createHash, randomBytes } from 'node:crypto';
import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../auth/password';
import { SecretBox } from '../auth/secret-box';
import { generateSecret, matchCode, otpauthUrl } from '../auth/totp';

export type OperatorRole = 'reviewer' | 'administrator';
export type OperatorStatus = 'active' | 'disabled';

/** Administrators can do everything reviewers can, plus system settings and operator accounts. */
const RANK: Record<OperatorRole, number> = { reviewer: 1, administrator: 2 };

/** How long a fresh OTP code unlocks sensitive actions. */
const STEP_UP_MINUTES = 5;

export interface Operator {
  id: string;
  email: string;
  name: string;
  role: OperatorRole;
  /** Sensitive actions are allowed until this time. Set by a step-up on the current session. */
  stepUpUntil: Date | null;
}

/** An operator account as administrators see it on the operator management page. */
export interface OperatorAccount {
  id: string;
  email: string;
  name: string;
  role: OperatorRole;
  status: OperatorStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
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

  /**
   * Used by the CLI and by administrators in the console (`by`). Returns the OTP secret once
   * so it can be put in an authenticator app.
   */
  async create(
    input: { email: string; name: string; role: OperatorRole; password: string },
    by?: string,
  ): Promise<{ operator: Operator; otpSecret: string; otpauthUrl: string }> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('invalid_email', 'Email address is not valid');
    if (!(input.role in RANK)) throw new DomainError('invalid_request', `Unknown role ${input.role}`);
    const name = assertName(input.name);
    assertPasswordPolicy(input.password);
    const otpSecret = generateSecret();
    const passwordHash = await hashPassword(input.password);
    const row = await withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO operators (email, name, role, password_hash, otp_secret_enc)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) WHERE status <> 'deleted' DO NOTHING
         RETURNING *`,
        [email, name, input.role, passwordHash, this.secrets.seal(otpSecret)],
      );
      if (!rows[0]) throw new DomainError('email_taken', 'This email is already registered');
      if (by) {
        await writeAudit(tx, { type: 'operator', id: by }, 'operator.create', { type: 'operator', id: rows[0].id }, null, {
          email,
          name,
          role: input.role,
        });
      }
      return rows[0];
    });
    return { operator: toOperator(row), otpSecret, otpauthUrl: otpauthUrl(otpSecret, email, 'P2P Ops') };
  }

  /** Every operator account that has not been deleted, newest first. */
  async list(): Promise<OperatorAccount[]> {
    const { rows } = await this.db.query(
      `SELECT o.*, (SELECT max(created_at) FROM operator_sessions s WHERE s.operator_id = o.id) AS last_login_at
       FROM operators o WHERE o.status <> 'deleted' ORDER BY o.created_at DESC, o.id`,
    );
    return rows.map(toAccount);
  }

  /**
   * Changes an operator's name, role or status. Disabling signs the operator out.
   * Administrators cannot change their own role or status, and at least one active
   * administrator always remains.
   */
  async update(
    id: string,
    changes: { name?: string; role?: OperatorRole; status?: OperatorStatus },
    by: string,
  ): Promise<OperatorAccount> {
    const name = changes.name === undefined ? undefined : assertName(changes.name);
    if (changes.role !== undefined && !(changes.role in RANK)) {
      throw new DomainError('invalid_request', `Unknown role ${changes.role}`);
    }
    await withTransaction(this.db, async (tx) => {
      const before = await this.lockForChange(tx, id, by);
      const role = changes.role ?? before.role;
      const status = changes.status ?? before.status;
      if (id === by && (role !== before.role || status !== before.status)) {
        throw new DomainError('cannot_change_self', 'Ask another administrator to change your own role or status');
      }
      if (before.role === 'administrator' && before.status === 'active' && (role !== 'administrator' || status !== 'active')) {
        await this.assertAnotherAdministrator(tx, id);
      }
      await tx.query('UPDATE operators SET name = $2, role = $3, status = $4, updated_at = $5 WHERE id = $1', [
        id,
        name ?? before.name,
        role,
        status,
        this.now(),
      ]);
      if (status !== 'active') await this.revokeSessions(tx, id);
      await writeAudit(
        tx,
        { type: 'operator', id: by },
        'operator.update',
        { type: 'operator', id },
        { name: before.name, role: before.role, status: before.status },
        { name: name ?? before.name, role, status },
      );
    });
    return this.account(id);
  }

  /**
   * Deletes an operator account and signs it out. The row stays so audit logs still name the
   * operator, and the email can be registered again.
   */
  async remove(id: string, by: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      if (id === by) throw new DomainError('cannot_change_self', 'You cannot delete your own account');
      const before = await this.lockForChange(tx, id, by);
      if (before.role === 'administrator' && before.status === 'active') await this.assertAnotherAdministrator(tx, id);
      await tx.query(`UPDATE operators SET status = 'deleted', updated_at = $2 WHERE id = $1`, [id, this.now()]);
      await this.revokeSessions(tx, id);
      await writeAudit(
        tx,
        { type: 'operator', id: by },
        'operator.delete',
        { type: 'operator', id },
        { email: before.email, name: before.name, role: before.role, status: before.status },
        null,
      );
    });
  }

  /**
   * Sets a new password and OTP secret for an operator who lost either, and signs them out.
   * Returns the new OTP secret once, like `create`.
   */
  async resetCredentials(id: string, password: string, by: string): Promise<{ otpSecret: string; otpauthUrl: string }> {
    assertPasswordPolicy(password);
    const otpSecret = generateSecret();
    const passwordHash = await hashPassword(password);
    const email = await withTransaction(this.db, async (tx) => {
      const before = await this.lockForChange(tx, id, by);
      await tx.query(
        `UPDATE operators SET password_hash = $2, otp_secret_enc = $3, otp_last_counter = NULL, updated_at = $4
         WHERE id = $1`,
        [id, passwordHash, this.secrets.seal(otpSecret), this.now()],
      );
      await this.revokeSessions(tx, id);
      await writeAudit(tx, { type: 'operator', id: by }, 'operator.reset_credentials', { type: 'operator', id }, null, null);
      return before.email as string;
    });
    return { otpSecret, otpauthUrl: otpauthUrl(otpSecret, email, 'P2P Ops') };
  }

  private async account(id: string): Promise<OperatorAccount> {
    const { rows } = await this.db.query(
      `SELECT o.*, (SELECT max(created_at) FROM operator_sessions s WHERE s.operator_id = o.id) AS last_login_at
       FROM operators o WHERE o.id = $1`,
      [id],
    );
    return toAccount(rows[0]);
  }

  /**
   * Locks every active administrator, then the target, so two administrators cannot each
   * demote the other at the same time and leave nobody. The acting operator must still be
   * an active administrator once the locks are held.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async lockForChange(tx: Tx, id: string, by: string): Promise<any> {
    const admins = await tx.query<{ id: string }>(
      `SELECT id FROM operators WHERE role = 'administrator' AND status = 'active' ORDER BY id FOR UPDATE`,
    );
    if (!admins.rows.some((r) => r.id === by)) throw new DomainError('forbidden', 'This needs the administrator role');
    const { rows } = await tx.query(`SELECT * FROM operators WHERE id = $1 AND status <> 'deleted' FOR UPDATE`, [id]);
    if (!rows[0]) throw new DomainError('not_found', 'Operator not found');
    return rows[0];
  }

  private async assertAnotherAdministrator(tx: Tx, id: string): Promise<void> {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM operators WHERE role = 'administrator' AND status = 'active' AND id <> $1`,
      [id],
    );
    if (rows[0]!.n === 0) {
      throw new DomainError('last_administrator', 'At least one active administrator must remain');
    }
  }

  private async revokeSessions(tx: Tx, operatorId: string): Promise<void> {
    await tx.query('UPDATE operator_sessions SET revoked_at = $2 WHERE operator_id = $1 AND revoked_at IS NULL', [
      operatorId,
      this.now(),
    ]);
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
      const { rows } = await tx.query(`SELECT * FROM operators WHERE email = $1 AND status <> 'deleted' FOR UPDATE`, [
        email,
      ]);
      const op = rows[0];
      // One error for every failure so staff emails cannot be probed.
      const fail = async (reason: string) => {
        await this.recordAttempt(email, false, reason, meta.ip);
        return new DomainError('invalid_credentials', 'Email, password or OTP code is incorrect');
      };
      if (!op || op.status !== 'active' || !(await verifyPassword(password, op.password_hash))) {
        throw await fail(op?.status === 'disabled' ? 'disabled' : 'bad_credentials');
      }
      if (!(await this.consumeOtp(tx, op, otp))) throw await fail('otp_invalid');
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
      `SELECT o.*, s.step_up_until FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND o.status = 'active'`,
      [hashToken(token), this.now()],
    );
    return rows[0] ? toOperator(rows[0]) : null;
  }

  /**
   * Checks a fresh OTP code and unlocks sensitive actions on this session for a few minutes.
   * The same code cannot be used twice, including the one used to log in.
   */
  async stepUp(token: string, otp: string): Promise<Date> {
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `SELECT o.*, s.id AS session_id FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND o.status = 'active'
         FOR UPDATE OF o`,
        [hashToken(token), this.now()],
      );
      const op = rows[0];
      if (!op) throw new DomainError('unauthorized', 'Operator login required');
      if (!(await this.consumeOtp(tx, op, otp))) throw new DomainError('invalid_otp', 'OTP code is incorrect or already used');
      const until = new Date(this.now().getTime() + STEP_UP_MINUTES * 60_000);
      await tx.query('UPDATE operator_sessions SET step_up_until = $2 WHERE id = $1', [op.session_id, until]);
      await writeAudit(tx, { type: 'operator', id: op.id }, 'operator.step_up', { type: 'operator', id: op.id }, null, {
        until,
      });
      return until;
    });
  }

  /** Accepts each code once: a code at or before the last used counter is refused. Caller holds the row lock. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async consumeOtp(tx: Tx, op: any, otp: string): Promise<boolean> {
    const counter = matchCode(this.secrets.open(op.otp_secret_enc), otp, this.now());
    if (counter === null || (op.otp_last_counter !== null && counter <= Number(op.otp_last_counter))) return false;
    await tx.query('UPDATE operators SET otp_last_counter = $2 WHERE id = $1', [op.id, counter]);
    return true;
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

/** Sensitive actions (moving money, changing limits, closing accounts) need a recent step-up. */
export function assertStepUp(operator: Operator, now: Date = new Date()): void {
  if (!operator.stepUpUntil || operator.stepUpUntil <= now) {
    throw new DomainError('step_up_required', 'Enter a fresh OTP code to continue');
  }
}

function assertName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 50) throw new DomainError('invalid_request', 'Name must be 1 to 50 characters');
  return name;
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOperator(row: any): Operator {
  return { id: row.id, email: row.email, name: row.name, role: row.role, stepUpUntil: row.step_up_until ?? null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAccount(row: any): OperatorAccount {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

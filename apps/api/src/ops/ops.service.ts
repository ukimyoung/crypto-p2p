import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { notify } from '../notifications/notify';

export type UserStatus = 'active' | 'trade_suspended' | 'withdraw_held' | 'closed';

export interface UserSummary {
  id: string;
  email: string | null;
  legalName: string | null;
  kycLevel: number;
  status: UserStatus;
  statusReason: string | null;
  otpEnabled: boolean;
  createdAt: Date;
}

export interface AuditEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

/** Customer lookup, account restrictions and the audit trail for the operations console. */
export class OpsService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Search by email fragment, exact user id or legal name. */
  async searchUsers(query: string): Promise<UserSummary[]> {
    const q = query.trim();
    if (!q) return [];
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    const { rows } = await this.db.query(
      `SELECT * FROM users
       WHERE id = $2::uuid OR email ILIKE '%' || $3 || '%' OR legal_name = $1
       ORDER BY created_at DESC LIMIT 50`,
      [q, isUuid ? q : null, q.replace(/[\\%_]/g, (c) => `\\${c}`)],
    );
    return rows.map(toUser);
  }

  async getUser(id: string): Promise<UserSummary> {
    const { rows } = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw new DomainError('not_found', 'User not found');
    return toUser(rows[0]);
  }

  /**
   * Restricts or restores an account. `closed` also ends every session.
   * Open orders and withdrawals are left to run their course.
   */
  async setUserStatus(userId: string, status: UserStatus, reason: string, operatorId: string): Promise<UserSummary> {
    const text = reason.trim();
    if (!text) throw new DomainError('invalid_request', 'Give a reason');
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!rows[0]) throw new DomainError('not_found', 'User not found');
      const before = toUser(rows[0]);
      const updated = await tx.query(
        'UPDATE users SET status = $2, status_reason = $3 WHERE id = $1 RETURNING *',
        [userId, status, status === 'active' ? null : text],
      );
      if (status === 'closed') {
        await tx.query('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [
          userId,
          this.now(),
        ]);
      }
      const after = toUser(updated.rows[0]);
      await writeAudit(
        tx,
        { type: 'operator', id: operatorId },
        'user.set_status',
        { type: 'user', id: userId },
        { status: before.status },
        { status: after.status, reason: text },
      );
      // The internal reason stays with staff; the customer is told only the new status.
      if (before.status !== after.status) await notify(tx, userId, 'account.status_changed', { status: after.status });
      return after;
    });
  }

  /** Newest first. Filter by what was acted on, who acted, or both. */
  async audit(filter: { targetId?: string; actorId?: string; limit?: number }): Promise<AuditEntry[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM audit_logs
       WHERE ($1::uuid IS NULL OR target_id = $1) AND ($2::uuid IS NULL OR actor_id = $2)
       ORDER BY id DESC LIMIT $3`,
      [filter.targetId ?? null, filter.actorId ?? null, Math.min(filter.limit ?? 100, 500)],
    );
    return rows.map((r) => ({
      id: String(r.id),
      actorType: r.actor_type,
      actorId: r.actor_id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      before: r.before,
      after: r.after,
      createdAt: r.created_at,
    }));
  }

  /** Display names for operator ids, so the console can show who did what. */
  async operatorNames(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const { rows } = await this.db.query('SELECT id, name FROM operators WHERE id = ANY($1::uuid[])', [ids]);
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUser(row: any): UserSummary {
  return {
    id: row.id,
    email: row.email,
    legalName: row.legal_name,
    kycLevel: row.kyc_level,
    status: row.status,
    statusReason: row.status_reason,
    otpEnabled: row.otp_enabled,
    createdAt: row.created_at,
  };
}

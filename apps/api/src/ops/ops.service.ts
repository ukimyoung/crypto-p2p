import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { notify } from '../notifications/notify';

export type UserStatus = 'active' | 'trade_suspended' | 'withdraw_held' | 'closed';

export interface UserSummary {
  id: string;
  email: string | null;
  /** Masked unless the caller asked for the full value. */
  phone: string | null;
  /** Masked unless the caller asked for the full value. */
  legalName: string | null;
  kycLevel: number;
  status: UserStatus;
  statusReason: string | null;
  otpEnabled: boolean;
  createdAt: Date;
}

export interface UserRow extends UserSummary {
  /** Orders waiting for payment, paid or under review. */
  openOrders: number;
  /** Sumsub review status and answer, null before the member opens identity verification. */
  sumsubStatus: string | null;
  sumsubAnswer: string | null;
  sumsubRejectType: string | null;
}

export const USER_SORTS = ['created_at', 'email', 'kyc_level', 'status', 'open_orders'] as const;
export type UserSort = (typeof USER_SORTS)[number];

export interface UserListFilter {
  q?: string;
  status?: UserStatus;
  kycLevel?: number;
  /** Signed up at or after. */
  from?: Date;
  /** Signed up before. */
  to?: Date;
  sort?: UserSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
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

  /**
   * Member grid (USR-1 to USR-3): every member by default, newest first, a page at a time.
   * `q` matches an email fragment, a phone number, an exact legal name or an exact id.
   * Phone numbers and legal names come back masked.
   */
  async listUsers(filter: UserListFilter): Promise<{ users: UserRow[]; total: number }> {
    const q = filter.q?.trim() || null;
    const isUuid = q !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 100);
    const page = Math.max(filter.page ?? 1, 1);
    const sort = USER_SORTS.includes(filter.sort as UserSort) ? filter.sort! : 'created_at';
    const dir = filter.dir === 'asc' ? 'ASC' : 'DESC';
    const { rows } = await this.db.query(
      `SELECT u.*, oo.n AS open_orders, k.review_status, k.review_answer, k.reject_type, count(*) OVER () AS total_count
       FROM users u
       LEFT JOIN kyc_applicants k ON k.user_id = u.id
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS n FROM orders o
         WHERE (o.buyer_id = u.id OR o.seller_id = u.id) AND o.status IN ('pending_payment', 'paid', 'under_review')
       ) oo
       WHERE ($1::text IS NULL OR u.id = $2::uuid OR u.email ILIKE '%' || $3 || '%' OR u.legal_name = $1
              OR regexp_replace(u.phone, '\\D', '', 'g') = NULLIF(regexp_replace($1, '\\D', '', 'g'), ''))
         AND ($4::text IS NULL OR u.status = $4)
         AND ($5::int IS NULL OR u.kyc_level = $5)
         AND ($6::timestamptz IS NULL OR u.created_at >= $6)
         AND ($7::timestamptz IS NULL OR u.created_at < $7)
       ORDER BY ${sort === 'open_orders' ? 'oo.n' : `u.${sort}`} ${dir} NULLS LAST, u.created_at DESC, u.id
       LIMIT $8 OFFSET $9`,
      [
        q,
        isUuid ? q : null,
        q?.replace(/[\\%_]/g, (c) => `\\${c}`) ?? null,
        filter.status ?? null,
        filter.kycLevel ?? null,
        filter.from ?? null,
        filter.to ?? null,
        pageSize,
        (page - 1) * pageSize,
      ],
    );
    return {
      users: rows.map((r) => ({
        ...toUser(r, true),
        openOrders: r.open_orders,
        sumsubStatus: r.review_status,
        sumsubAnswer: r.review_answer,
        sumsubRejectType: r.reject_type,
      })),
      total: Number(rows[0]?.total_count ?? 0),
    };
  }

  /** A member. Phone and legal name are masked unless `unmasked` (dispute review needs the name). */
  async getUser(id: string, unmasked = false): Promise<UserSummary> {
    const { rows } = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw new DomainError('not_found', 'User not found');
    return toUser(rows[0], !unmasked);
  }

  /** Shows a member's full personal details (USR-7). The reason and the viewing are audited. */
  async revealUser(
    id: string,
    reason: string,
    operatorId: string,
  ): Promise<{ email: string | null; phone: string | null; legalName: string | null }> {
    const text = reason.trim();
    if (!text) throw new DomainError('invalid_request', 'Give a reason');
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT email, phone, legal_name FROM users WHERE id = $1', [id]);
      if (!rows[0]) throw new DomainError('not_found', 'User not found');
      await writeAudit(tx, { type: 'operator', id: operatorId }, 'user.reveal_pii', { type: 'user', id }, null, {
        reason: text,
      });
      return { email: rows[0].email, phone: rows[0].phone, legalName: rows[0].legal_name };
    });
  }

  /** Manual KYC level change for exceptions (USR-6). Normally the level comes from identity verification. */
  async setKycLevel(userId: string, level: number, reason: string, operatorId: string): Promise<UserSummary> {
    const text = reason.trim();
    if (!text) throw new DomainError('invalid_request', 'Give a reason');
    if (level !== 0 && level !== 1) {
      throw new DomainError('invalid_request', 'KYC level must be 0 or 1');
    }
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT kyc_level FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!rows[0]) throw new DomainError('not_found', 'User not found');
      const updated = await tx.query('UPDATE users SET kyc_level = $2 WHERE id = $1 RETURNING *', [userId, level]);
      await writeAudit(
        tx,
        { type: 'operator', id: operatorId },
        'user.set_kyc_level',
        { type: 'user', id: userId },
        { kycLevel: rows[0].kyc_level },
        { kycLevel: level, reason: text },
      );
      return toUser(updated.rows[0], true);
    });
  }

  /** Recent logins, withdrawal addresses, ads and restriction history for the member detail (USR-4). */
  async userExtras(userId: string) {
    const [logins, addresses, ads, history] = await Promise.all([
      this.db.query(
        `SELECT success, reason, ip::text AS ip, user_agent, created_at FROM login_attempts
         WHERE user_id = $1 ORDER BY id DESC LIMIT 20`,
        [userId],
      ),
      this.db.query(
        `SELECT id, asset, address, label, status, created_at, removed_at FROM withdrawal_addresses
         WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      ),
      this.db.query(
        `SELECT id, side, asset, fiat, price_minor, total_amount, remaining_amount, status, created_at FROM ads
         WHERE maker_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId],
      ),
      this.db.query(
        `SELECT id, actor_id, action, before, after, created_at FROM audit_logs
         WHERE target_type = 'user' AND target_id = $1 AND action IN ('user.set_status', 'user.set_kyc_level', 'user.reveal_pii',
           'user.kyc_approved', 'user.kyc_revoked', 'user.kyc_sync', 'user.kyc_request_check')
         ORDER BY id DESC LIMIT 50`,
        [userId],
      ),
    ]);
    return {
      logins: logins.rows.map((r) => ({
        success: r.success,
        reason: r.reason,
        ip: r.ip,
        userAgent: r.user_agent,
        createdAt: r.created_at,
      })),
      addresses: addresses.rows.map((r) => ({
        id: r.id,
        asset: r.asset,
        address: r.address,
        label: r.label,
        status: r.status,
        createdAt: r.created_at,
        removedAt: r.removed_at,
      })),
      ads: ads.rows.map((r) => ({
        id: r.id,
        side: r.side,
        asset: r.asset,
        fiat: r.fiat,
        priceMinor: r.price_minor,
        totalAmount: r.total_amount,
        remainingAmount: r.remaining_amount,
        status: r.status,
        createdAt: r.created_at,
      })),
      history: history.rows.map((r) => ({
        id: String(r.id),
        actorId: r.actor_id,
        action: r.action,
        before: r.before,
        after: r.after,
        createdAt: r.created_at,
      })),
    };
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
      const before = toUser(rows[0], true);
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
      const after = toUser(updated.rows[0], true);
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
       WHERE ($1::text IS NULL OR target_id = $1) AND ($2::uuid IS NULL OR actor_id = $2)
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
function toUser(row: any, masked = true): UserSummary {
  return {
    id: row.id,
    email: row.email,
    phone: masked ? maskPhone(row.phone) : row.phone,
    legalName: masked ? maskName(row.legal_name) : row.legal_name,
    kycLevel: row.kyc_level,
    status: row.status,
    statusReason: row.status_reason,
    otpEnabled: row.otp_enabled,
    createdAt: row.created_at,
  };
}

/** 홍길동 -> 홍*동, 남궁민수 -> 남**수, 홍길 -> 홍*. */
export function maskName(name: string | null): string | null {
  if (!name) return name;
  const chars = [...name.trim()];
  if (chars.length <= 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;
  return chars[0] + '*'.repeat(chars.length - 2) + chars[chars.length - 1];
}

/** 010-1234-5678 -> 010-****-5678. Keeps the first 3 and last 4 digits. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  let digit = 0;
  const total = phone.replace(/\D/g, '').length;
  return phone.replace(/\d/g, (d) => {
    digit++;
    return digit <= 3 || digit > total - 4 ? d : '*';
  });
}

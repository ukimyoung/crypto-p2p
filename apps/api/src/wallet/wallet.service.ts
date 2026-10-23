import { Actor, writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';
import { LedgerService } from '../ledger/ledger.service';
import { notify } from '../notifications/notify';
import { NotificationType } from '../notifications/templates';
import { normalizeAddress } from './address';
import { loadWithdrawalRules, WalletConfig } from './wallet-config';
import {
  FINAL_STATUSES,
  nextWithdrawalStatus,
  WithdrawalEvent,
  WithdrawalRole,
  WithdrawalStatus,
} from './withdrawal-state';

export interface Balance {
  asset: string;
  available: bigint;
  /** Locked in open orders. */
  escrow: bigint;
  /** Locked in withdrawals that have not finished. */
  withdrawalPending: bigint;
}

export interface WithdrawalAddress {
  id: string;
  asset: string;
  address: string;
  label: string;
  usableFrom: Date;
  createdAt: Date;
}

export interface Withdrawal {
  id: string;
  userId: string;
  asset: string;
  addressId: string;
  address: string;
  amount: bigint;
  fee: bigint;
  status: WithdrawalStatus;
  txHash: string | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WithdrawalLimit {
  asset: string;
  fee: bigint;
  minAmount: bigint;
  /** null when the user's KYC level cannot withdraw this asset. */
  dailyLimit: bigint | null;
  usedToday: bigint;
}

const DAY_MS = 24 * 3_600_000;

const WITHDRAWAL_NOTICES: Partial<Record<WithdrawalStatus, NotificationType>> = {
  approved: 'withdrawal.approved',
  rejected: 'withdrawal.rejected',
  sent: 'withdrawal.sent',
  confirmed: 'withdrawal.confirmed',
  failed: 'withdrawal.failed',
};
/** Withdrawals that still count against the daily limit. */
const COUNTED = "status NOT IN ('rejected', 'cancelled', 'failed')";

/**
 * Balances, the withdrawal address whitelist (WAL-2) and withdrawals (WAL-3).
 *
 * A request moves amount + fee from `available` to `withdrawal_pending`.
 * When the transaction confirms, the pending funds leave the platform: the
 * amount goes back to `custody` (which mirrors on-chain holdings) and the fee
 * to `fee_revenue`. Rejected, cancelled and failed withdrawals return to `available`.
 */
export class WalletService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly config: WalletConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async balances(userId: string): Promise<Balance[]> {
    const { rows } = await this.db.query<{ asset: string; kind: string; balance: string | null }>(
      `SELECT a.code AS asset, l.kind, l.balance
       FROM assets a LEFT JOIN ledger_accounts l ON l.asset = a.code AND l.user_id = $1
       ORDER BY a.code`,
      [userId],
    );
    const byAsset = new Map<string, Balance>();
    for (const r of rows) {
      const b = byAsset.get(r.asset) ?? { asset: r.asset, available: 0n, escrow: 0n, withdrawalPending: 0n };
      const value = BigInt(r.balance ?? 0);
      if (r.kind === 'available') b.available = value;
      if (r.kind === 'escrow') b.escrow = value;
      if (r.kind === 'withdrawal_pending') b.withdrawalPending = value;
      byAsset.set(r.asset, b);
    }
    return [...byAsset.values()];
  }

  // Address whitelist ---------------------------------------------------------

  async addAddress(
    userId: string,
    input: { asset: string; address: string; label?: string },
  ): Promise<WithdrawalAddress> {
    const network = await this.networkOf(input.asset);
    const address = normalizeAddress(network, input.address);
    const label = (input.label ?? '').trim();
    if (label.length > 40) throw new DomainError('invalid_request', 'Label must be at most 40 characters');

    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO withdrawal_addresses (user_id, asset, address, label, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, asset, address) WHERE status = 'active' DO NOTHING
         RETURNING *`,
        [userId, input.asset, address, label, this.now()],
      );
      if (!rows[0]) throw new DomainError('address_exists', 'This address is already registered');
      const added = this.toAddress(rows[0]);
      const target = { type: 'withdrawal_address', id: added.id };
      await writeAudit(tx, { type: 'user', id: userId }, 'withdrawal_address.add', target, null, added);
      return added;
    });
  }

  async listAddresses(userId: string): Promise<WithdrawalAddress[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM withdrawal_addresses WHERE user_id = $1 AND status = 'active' ORDER BY created_at`,
      [userId],
    );
    return rows.map((r) => this.toAddress(r));
  }

  async removeAddress(userId: string, id: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE withdrawal_addresses SET status = 'removed', removed_at = $3
         WHERE id = $1 AND user_id = $2 AND status = 'active'`,
        [id, userId, this.now()],
      );
      if (!rowCount) throw new DomainError('not_found', 'Address not found');
      const target = { type: 'withdrawal_address', id };
      await writeAudit(tx, { type: 'user', id: userId }, 'withdrawal_address.remove', target, null, null);
    });
  }

  // Withdrawals ---------------------------------------------------------------

  async limits(userId: string): Promise<WithdrawalLimit[]> {
    const user = await this.db.query<{ kyc_level: number }>('SELECT kyc_level FROM users WHERE id = $1', [userId]);
    const kycLevel = user.rows[0]?.kyc_level ?? 0;
    const used = await this.db.query<{ asset: string; used: string }>(
      `SELECT asset, sum(amount) AS used FROM withdrawals
       WHERE user_id = $1 AND created_at > $2 AND ${COUNTED} GROUP BY asset`,
      [userId, new Date(this.now().getTime() - DAY_MS)],
    );
    const usedByAsset = new Map(used.rows.map((r) => [r.asset, BigInt(r.used)]));
    return (await loadWithdrawalRules(this.db)).map((rules) => ({
      asset: rules.asset,
      fee: rules.fee,
      minAmount: rules.minAmount,
      dailyLimit: rules.dailyLimitByKycLevel[kycLevel] ?? null,
      usedToday: usedByAsset.get(rules.asset) ?? 0n,
    }));
  }

  /** `amount` is what should arrive; the fee is charged on top. OTP is checked by the caller. */
  async requestWithdrawal(userId: string, addressId: string, amount: bigint): Promise<Withdrawal> {
    return withTransaction(this.db, async (tx) => {
      // One request at a time per user, so two requests cannot both fit under the daily limit.
      const { rows: users } = await tx.query('SELECT kyc_level, status FROM users WHERE id = $1 FOR UPDATE', [
        userId,
      ]);
      const user = users[0];
      if (!user) throw new DomainError('not_found', 'User not found');
      if (user.status !== 'active' && user.status !== 'trade_suspended') {
        throw new DomainError('user_restricted', 'Withdrawals are on hold for this account');
      }

      const { rows: addresses } = await tx.query('SELECT * FROM withdrawal_addresses WHERE id = $1', [addressId]);
      const addressRow = addresses[0];
      if (!addressRow || addressRow.user_id !== userId || addressRow.status !== 'active') {
        throw new DomainError('address_invalid', 'Choose one of your registered addresses');
      }
      const address = this.toAddress(addressRow);
      if (address.usableFrom > this.now()) {
        throw new DomainError('address_cooldown', 'A new address cannot receive withdrawals yet');
      }

      const [rules] = await loadWithdrawalRules(tx, address.asset);
      if (!rules) throw new DomainError('asset_unsupported', `${address.asset} withdrawals are not supported`);
      const asset = await tx.query<{ status: string }>('SELECT status FROM assets WHERE code = $1', [address.asset]);
      if (asset.rows[0]?.status === 'withdrawals_paused' || asset.rows[0]?.status === 'delisted') {
        throw new DomainError('withdrawals_paused', `${address.asset} withdrawals are paused`);
      }
      const dailyLimit = rules.dailyLimitByKycLevel[user.kyc_level];
      if (dailyLimit === undefined) throw new DomainError('kyc_required', 'Complete identity verification first');
      if (amount < rules.minAmount) {
        throw new DomainError('below_minimum', 'The amount is below the minimum withdrawal');
      }

      const used = await tx.query<{ used: string | null }>(
        `SELECT sum(amount) AS used FROM withdrawals
         WHERE user_id = $1 AND asset = $2 AND created_at > $3 AND ${COUNTED}`,
        [userId, address.asset, new Date(this.now().getTime() - DAY_MS)],
      );
      if (BigInt(used.rows[0]?.used ?? 0) + amount > dailyLimit) {
        throw new DomainError('daily_limit_exceeded', 'This would exceed your 24-hour withdrawal limit');
      }

      const { rows } = await tx.query(
        `INSERT INTO withdrawals (user_id, asset, address_id, address, amount, fee, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'requested', $7, $7)
         RETURNING *`,
        [userId, address.asset, address.id, address.address, amount.toString(), rules.fee.toString(), this.now()],
      );
      let withdrawal = toWithdrawal(rows[0]);
      await this.ledger.post(tx, {
        idempotencyKey: `withdrawal:${withdrawal.id}:lock`,
        kind: 'withdrawal_lock',
        ref: { type: 'withdrawal', id: withdrawal.id },
        postings: [
          { account: { userId, asset: withdrawal.asset, kind: 'available' }, amount: -(amount + rules.fee) },
          { account: { userId, asset: withdrawal.asset, kind: 'withdrawal_pending' }, amount: amount + rules.fee },
        ],
      });
      const target = { type: 'withdrawal', id: withdrawal.id };
      await writeAudit(tx, { type: 'user', id: userId }, 'withdrawal.request', target, null, withdrawal);

      if (amount <= rules.autoApproveMax) {
        withdrawal = await this.transition(tx, withdrawal.id, 'approve', { type: 'system' });
      }
      return withdrawal;
    });
  }

  async listWithdrawals(userId: string, limit = 50): Promise<Withdrawal[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, Math.min(limit, 100)],
    );
    return rows.map(toWithdrawal);
  }

  /** Review queue for operators, oldest first. */
  async listByStatus(status: WithdrawalStatus, limit = 100): Promise<Withdrawal[]> {
    const { rows } = await this.db.query('SELECT * FROM withdrawals WHERE status = $1 ORDER BY created_at LIMIT $2', [
      status,
      Math.min(limit, 200),
    ]);
    return rows.map(toWithdrawal);
  }

  cancel(id: string, userId: string): Promise<Withdrawal> {
    return this.apply(id, 'cancel', { type: 'user', id: userId });
  }

  /** Operator review of withdrawals above the auto-approve amount. */
  approve(id: string, operatorId: string): Promise<Withdrawal> {
    return this.apply(id, 'approve', { type: 'operator', id: operatorId });
  }

  reject(id: string, operatorId: string, note: string): Promise<Withdrawal> {
    return this.apply(id, 'reject', { type: 'operator', id: operatorId }, { note });
  }

  /** Custody callbacks. Not wired to a provider yet. */
  markSent(id: string, txHash: string): Promise<Withdrawal> {
    return this.apply(id, 'broadcast', { type: 'system' }, { txHash });
  }

  markConfirmed(id: string): Promise<Withdrawal> {
    return this.apply(id, 'confirm', { type: 'system' });
  }

  markFailed(id: string, reason: string): Promise<Withdrawal> {
    return this.apply(id, 'fail', { type: 'system' }, { note: reason });
  }

  private apply(id: string, event: WithdrawalEvent, actor: Actor, extra: { note?: string; txHash?: string } = {}) {
    return withTransaction(this.db, (tx) => this.transition(tx, id, event, actor, extra));
  }

  private async transition(
    tx: Tx,
    id: string,
    event: WithdrawalEvent,
    actor: Actor,
    extra: { note?: string; txHash?: string } = {},
  ): Promise<Withdrawal> {
    const { rows } = await tx.query('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new DomainError('not_found', 'Withdrawal not found');
    const before = toWithdrawal(rows[0]);
    if (actor.type === 'user' && actor.id !== before.userId) throw new DomainError('not_found', 'Withdrawal not found');
    const role: WithdrawalRole = actor.type;
    const status = nextWithdrawalStatus(before.status, event, role);

    const updated = await tx.query(
      `UPDATE withdrawals SET status = $2, updated_at = $3,
              tx_hash = COALESCE($4, tx_hash),
              review_note = COALESCE($5, review_note),
              reviewed_by = CASE WHEN $6::uuid IS NULL THEN reviewed_by ELSE $6::uuid END
       WHERE id = $1 RETURNING *`,
      [id, status, this.now(), extra.txHash ?? null, extra.note ?? null, actor.type === 'operator' ? actor.id : null],
    );
    const after = toWithdrawal(updated.rows[0]);

    if (FINAL_STATUSES.includes(status)) await this.settle(tx, after);
    await writeAudit(tx, actor, `withdrawal.${event}`, { type: 'withdrawal', id }, before, after);

    // Automatic approval happens while the user waits on the request, so it needs no notice.
    const type = actor.type === 'system' && status === 'approved' ? undefined : WITHDRAWAL_NOTICES[status];
    if (type) {
      await notify(tx, after.userId, type, {
        withdrawalId: after.id,
        asset: after.asset,
        amount: after.amount.toString(),
        address: after.address,
        txHash: after.txHash,
        note: after.reviewNote,
      });
    }
    return after;
  }

  private async settle(tx: Tx, w: Withdrawal): Promise<void> {
    const locked = w.amount + w.fee;
    const pending = {
      account: { userId: w.userId, asset: w.asset, kind: 'withdrawal_pending' as const },
      amount: -locked,
    };
    const postings =
      w.status === 'confirmed'
        ? [
            pending,
            { account: { system: 'custody' as const, asset: w.asset }, amount: w.amount },
            ...(w.fee > 0n ? [{ account: { system: 'fee_revenue' as const, asset: w.asset }, amount: w.fee }] : []),
          ]
        : [pending, { account: { userId: w.userId, asset: w.asset, kind: 'available' as const }, amount: locked }];
    await this.ledger.post(tx, {
      idempotencyKey: `withdrawal:${w.id}:settle`,
      kind: w.status === 'confirmed' ? 'withdrawal' : 'withdrawal_refund',
      ref: { type: 'withdrawal', id: w.id },
      postings,
    });
  }

  private async networkOf(asset: string): Promise<string> {
    const { rows } = await this.db.query<{ network: string }>('SELECT network FROM assets WHERE code = $1', [asset]);
    if (!rows[0] || (await loadWithdrawalRules(this.db, asset)).length === 0) {
      throw new DomainError('asset_unsupported', `${asset} withdrawals are not supported`);
    }
    return rows[0].network;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toAddress(row: any): WithdrawalAddress {
    return {
      id: row.id,
      asset: row.asset,
      address: row.address,
      label: row.label,
      usableFrom: new Date(row.created_at.getTime() + this.config.addressCooldownHours * 3_600_000),
      createdAt: row.created_at,
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toWithdrawal(row: any): Withdrawal {
  return {
    id: row.id,
    userId: row.user_id,
    asset: row.asset,
    addressId: row.address_id,
    address: row.address,
    amount: BigInt(row.amount),
    fee: BigInt(row.fee),
    status: row.status,
    txHash: row.tx_hash,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

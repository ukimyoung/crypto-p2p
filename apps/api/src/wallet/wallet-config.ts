import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';

/** Per-asset withdrawal rules. All amounts are in the asset's smallest unit. */
export interface AssetWithdrawalRules {
  asset: string;
  /** Network fee charged on top of the amount. */
  fee: bigint;
  minAmount: bigint;
  /** Requests up to this amount skip operator review. 0 sends everything to review. */
  autoApproveMax: bigint;
  /** Rolling 24-hour limit by KYC level. A level that is missing cannot withdraw. */
  dailyLimitByKycLevel: Record<number, bigint>;
}

export interface WalletConfig {
  /** Hours before a newly whitelisted address can receive withdrawals. */
  addressCooldownHours: number;
}

export const DEFAULT_WALLET_CONFIG: WalletConfig = { addressCooldownHours: 24 };

/**
 * Withdrawal rules live in `withdrawal_rules` and `withdrawal_daily_limits` so
 * operators can change them from the admin page. Read on every request, so a
 * change applies to the next withdrawal.
 */
export async function loadWithdrawalRules(q: Db | Tx, asset?: string): Promise<AssetWithdrawalRules[]> {
  const { rows } = await q.query(
    `SELECT r.*, COALESCE(json_object_agg(l.kyc_level, l.daily_limit::text) FILTER (WHERE l.asset IS NOT NULL), '{}') AS limits
     FROM withdrawal_rules r LEFT JOIN withdrawal_daily_limits l ON l.asset = r.asset
     WHERE $1::text IS NULL OR r.asset = $1
     GROUP BY r.asset ORDER BY r.asset`,
    [asset ?? null],
  );
  return rows.map((r) => ({
    asset: r.asset,
    fee: BigInt(r.fee),
    minAmount: BigInt(r.min_amount),
    autoApproveMax: BigInt(r.auto_approve_max),
    dailyLimitByKycLevel: Object.fromEntries(
      Object.entries(r.limits as Record<string, string>).map(([level, limit]) => [Number(level), BigInt(limit)]),
    ),
  }));
}

export interface WithdrawalRulesInput {
  fee: bigint;
  minAmount: bigint;
  autoApproveMax: bigint;
  dailyLimitByKycLevel: Record<number, bigint>;
}

/** Replaces one coin's rules. The old and new values go to the audit log. */
export async function updateWithdrawalRules(
  db: Db,
  asset: string,
  input: WithdrawalRulesInput,
  operatorId: string,
  reason: string,
): Promise<AssetWithdrawalRules> {
  const text = reason.trim();
  if (!text) throw new DomainError('invalid_request', 'Give a reason');
  if (input.fee < 0n || input.minAmount <= 0n || input.autoApproveMax < 0n) {
    throw new DomainError('invalid_request', 'Fee and auto-approve amount must not be negative; minimum must be positive');
  }
  for (const [level, limit] of Object.entries(input.dailyLimitByKycLevel)) {
    if (!Number.isInteger(Number(level)) || Number(level) < 0 || limit <= 0n) {
      throw new DomainError('invalid_request', 'Daily limits must be positive and keyed by KYC level');
    }
  }
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query('SELECT asset FROM withdrawal_rules WHERE asset = $1 FOR UPDATE', [asset]);
    if (!rows[0]) throw new DomainError('not_found', `${asset} has no withdrawal rules`);
    const [before] = await loadWithdrawalRules(tx, asset);
    await tx.query(
      `UPDATE withdrawal_rules SET fee = $2, min_amount = $3, auto_approve_max = $4, updated_at = now(), updated_by = $5
       WHERE asset = $1`,
      [asset, input.fee.toString(), input.minAmount.toString(), input.autoApproveMax.toString(), operatorId],
    );
    await tx.query('DELETE FROM withdrawal_daily_limits WHERE asset = $1', [asset]);
    for (const [level, limit] of Object.entries(input.dailyLimitByKycLevel)) {
      await tx.query('INSERT INTO withdrawal_daily_limits (asset, kyc_level, daily_limit) VALUES ($1, $2, $3)', [
        asset,
        Number(level),
        limit.toString(),
      ]);
    }
    const [after] = await loadWithdrawalRules(tx, asset);
    await writeAudit(
      tx,
      { type: 'operator', id: operatorId },
      'settings.withdrawal_rules',
      { type: 'asset', id: asset },
      before,
      { ...after, reason: text },
    );
    return after!;
  });
}

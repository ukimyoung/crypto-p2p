import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';

/** Settings operators change from the admin page, with their checks. */
const SETTINGS = {
  /** How often fee invoices are issued. */
  'billing.cycle': (v: unknown) => v === 'daily' || v === 'monthly',
  /** Days after issue until an invoice is due. */
  'billing.due_days': (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 60,
} as const;

export type OpsSettingKey = keyof typeof SETTINGS;

export interface BillingSettings {
  cycle: 'daily' | 'monthly';
  dueDays: number;
}

export async function getSettings(q: Db | Tx): Promise<Record<OpsSettingKey, unknown>> {
  const { rows } = await q.query<{ key: OpsSettingKey; value: unknown }>('SELECT key, value FROM ops_settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<OpsSettingKey, unknown>;
}

export async function billingSettings(q: Db | Tx): Promise<BillingSettings> {
  const s = await getSettings(q);
  return {
    cycle: s['billing.cycle'] === 'daily' ? 'daily' : 'monthly',
    dueDays: typeof s['billing.due_days'] === 'number' ? s['billing.due_days'] : 7,
  };
}

/** Changes several settings at once. Each change is audited with its old value. */
export async function updateSettings(
  db: Db,
  values: Partial<Record<OpsSettingKey, unknown>>,
  operatorId: string,
  reason: string,
): Promise<Record<OpsSettingKey, unknown>> {
  const text = reason.trim();
  if (!text) throw new DomainError('invalid_request', 'Give a reason');
  for (const [key, value] of Object.entries(values)) {
    const check = SETTINGS[key as OpsSettingKey];
    if (!check) throw new DomainError('invalid_request', `Unknown setting ${key}`);
    if (!check(value)) throw new DomainError('invalid_request', `Invalid value for ${key}`);
  }
  return withTransaction(db, async (tx) => {
    const before = await getSettings(tx);
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(before[key as OpsSettingKey]) === JSON.stringify(value)) continue;
      await tx.query(
        `INSERT INTO ops_settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3`,
        [key, JSON.stringify(value), operatorId],
      );
      await writeAudit(
        tx,
        { type: 'operator', id: operatorId },
        'settings.ops',
        { type: 'setting', id: key },
        { value: before[key as OpsSettingKey] ?? null },
        { value, reason: text },
      );
    }
    return getSettings(tx);
  });
}

import { Tx } from '../db/database';
import { Locale, NotificationType, renderEmail } from './templates';

export type NotificationData = Record<string, string | null>;

/**
 * Records a notification for `userId` inside the caller's transaction, and
 * queues an email when the type has one and the user has an address.
 * Amounts in `data` are smallest-unit strings next to an `asset`; emails show them in whole coins.
 */
export async function notify(tx: Tx, userId: string, type: NotificationType, data: NotificationData): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    'INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3) RETURNING id',
    [userId, type, JSON.stringify(data)],
  );
  const user = await tx.query<{ email: string | null; locale: Locale }>(
    'SELECT email, locale FROM users WHERE id = $1',
    [userId],
  );
  const email = user.rows[0]?.email;
  if (!email) return;

  const shown = { ...data };
  if (data.amount && data.asset) {
    const asset = await tx.query<{ decimals: number }>('SELECT decimals FROM assets WHERE code = $1', [data.asset]);
    if (asset.rows[0]) shown.amount = formatUnits(BigInt(data.amount), asset.rows[0].decimals);
  }
  const rendered = renderEmail(type, user.rows[0]!.locale, shown);
  if (!rendered) return;
  await tx.query(
    'INSERT INTO email_outbox (notification_id, to_address, subject, body) VALUES ($1, $2, $3, $4)',
    [rows[0]!.id, email, rendered.subject, rendered.body],
  );
}

/** 1500000n with 8 decimals -> "0.015". */
export function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const frac = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${value / base}.${frac}` : `${value / base}`;
}

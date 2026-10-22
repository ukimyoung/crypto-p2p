import { Tx } from '../db/database';

export type Actor =
  | { type: 'user'; id: string }
  | { type: 'operator'; id: string }
  | { type: 'system' };

export async function writeAudit(
  tx: Tx,
  actor: Actor,
  action: string,
  target: { type: string; id: string },
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actor.type,
      actor.type === 'system' ? null : actor.id,
      action,
      target.type,
      target.id,
      before === null ? null : JSON.stringify(before, bigintReplacer),
      after === null ? null : JSON.stringify(after, bigintReplacer),
    ],
  );
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

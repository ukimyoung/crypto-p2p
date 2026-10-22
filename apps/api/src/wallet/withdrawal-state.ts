import { DomainError } from '../common/errors';

export type WithdrawalStatus = 'requested' | 'approved' | 'sent' | 'confirmed' | 'rejected' | 'cancelled' | 'failed';

export type WithdrawalEvent =
  | 'cancel' // the user withdraws the request before review
  | 'approve' // an operator lets it go to custody
  | 'reject' // an operator refuses it; funds go back
  | 'broadcast' // custody signed and sent the transaction
  | 'confirm' // the transaction reached enough confirmations
  | 'fail'; // custody could not send it; funds go back

export type WithdrawalRole = 'user' | 'operator' | 'system';

const TRANSITIONS: Record<WithdrawalEvent, { from: WithdrawalStatus[]; to: WithdrawalStatus; by: WithdrawalRole[] }> = {
  cancel: { from: ['requested'], to: 'cancelled', by: ['user'] },
  // Small withdrawals are approved by the system at request time.
  approve: { from: ['requested'], to: 'approved', by: ['operator', 'system'] },
  reject: { from: ['requested'], to: 'rejected', by: ['operator'] },
  broadcast: { from: ['approved'], to: 'sent', by: ['system'] },
  confirm: { from: ['sent'], to: 'confirmed', by: ['system'] },
  fail: { from: ['approved', 'sent'], to: 'failed', by: ['system'] },
};

/** Statuses where the funds have left `withdrawal_pending` for good. */
export const FINAL_STATUSES: WithdrawalStatus[] = ['confirmed', 'rejected', 'cancelled', 'failed'];

export function nextWithdrawalStatus(
  current: WithdrawalStatus,
  event: WithdrawalEvent,
  role: WithdrawalRole,
): WithdrawalStatus {
  const t = TRANSITIONS[event];
  if (!t.by.includes(role)) throw new DomainError('forbidden', `A ${role} cannot ${event} a withdrawal`);
  if (!t.from.includes(current)) {
    throw new DomainError('invalid_transition', `Cannot ${event} a withdrawal that is ${current}`);
  }
  return t.to;
}

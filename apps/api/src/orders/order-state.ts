import { DomainError } from '../common/errors';

export type OrderStatus = 'pending_payment' | 'paid' | 'completed' | 'cancelled' | 'under_review';

export type OrderEvent =
  | 'mark_paid' // buyer says the fiat transfer is done
  | 'release' // seller confirms receipt; escrow goes to the buyer
  | 'cancel' // buyer gives up before paying
  | 'expire' // payment window ran out without a payment mark
  | 'escalate' // a party asks operators to step in after payment was marked
  | 'auto_review' // the seller did not release in time after payment was marked
  | 'resolve_release' // operators decide for the buyer
  | 'resolve_refund'; // operators decide for the seller

export type OrderRole = 'buyer' | 'seller' | 'system' | 'operator';

interface Transition {
  from: OrderStatus[];
  to: OrderStatus;
  by: OrderRole[];
}

/**
 * The only allowed order transitions. Anything not listed here is rejected.
 * Escrow is locked when the order is created and leaves escrow exactly once:
 * to the buyer on `completed`, back to the seller on `cancelled`.
 */
export const TRANSITIONS: Record<OrderEvent, Transition> = {
  mark_paid: { from: ['pending_payment'], to: 'paid', by: ['buyer'] },
  // Sellers may release as soon as they see the money, even before the buyer marks it paid.
  release: { from: ['pending_payment', 'paid'], to: 'completed', by: ['seller'] },
  cancel: { from: ['pending_payment'], to: 'cancelled', by: ['buyer'] },
  expire: { from: ['pending_payment'], to: 'cancelled', by: ['system'] },
  escalate: { from: ['paid'], to: 'under_review', by: ['buyer', 'seller'] },
  auto_review: { from: ['paid'], to: 'under_review', by: ['system'] },
  resolve_release: { from: ['under_review'], to: 'completed', by: ['operator'] },
  resolve_refund: { from: ['under_review'], to: 'cancelled', by: ['operator'] },
};

export function nextStatus(current: OrderStatus, event: OrderEvent, role: OrderRole): OrderStatus {
  const t = TRANSITIONS[event];
  if (!t.by.includes(role)) {
    throw new DomainError('forbidden', `A ${role} cannot ${event} an order`);
  }
  if (!t.from.includes(current)) {
    throw new DomainError('invalid_transition', `Cannot ${event} an order that is ${current}`);
  }
  return t.to;
}

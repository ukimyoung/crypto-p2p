import { describe, expect, it } from 'vitest';
import { nextStatus } from '../src/orders/order-state';

describe('order state machine', () => {
  it('follows the happy path', () => {
    expect(nextStatus('pending_payment', 'mark_paid', 'buyer')).toBe('paid');
    expect(nextStatus('paid', 'release', 'seller')).toBe('completed');
  });

  it('lets the seller release before the buyer marks payment', () => {
    expect(nextStatus('pending_payment', 'release', 'seller')).toBe('completed');
  });

  it('rejects the wrong party', () => {
    expect(() => nextStatus('paid', 'release', 'buyer')).toThrow(/buyer cannot release/);
    expect(() => nextStatus('pending_payment', 'cancel', 'seller')).toThrow(/seller cannot cancel/);
    expect(() => nextStatus('under_review', 'resolve_release', 'seller')).toThrow();
  });

  it('rejects transitions out of final states', () => {
    for (const event of ['mark_paid', 'cancel', 'escalate'] as const) {
      expect(() => nextStatus('completed', event, 'buyer')).toThrow(/Cannot/);
      expect(() => nextStatus('cancelled', event, 'buyer')).toThrow(/Cannot/);
    }
    expect(() => nextStatus('completed', 'release', 'seller')).toThrow(/Cannot/);
  });

  it('does not let the buyer cancel after marking payment', () => {
    expect(() => nextStatus('paid', 'cancel', 'buyer')).toThrow(/Cannot cancel an order that is paid/);
  });

  it('only escalates paid orders', () => {
    expect(nextStatus('paid', 'escalate', 'seller')).toBe('under_review');
    expect(() => nextStatus('pending_payment', 'escalate', 'buyer')).toThrow();
  });

  it('lets only the system send an unreleased paid order to review', () => {
    expect(nextStatus('paid', 'auto_review', 'system')).toBe('under_review');
    expect(() => nextStatus('paid', 'auto_review', 'buyer')).toThrow(/cannot auto_review/);
    expect(() => nextStatus('pending_payment', 'auto_review', 'system')).toThrow();
  });
});

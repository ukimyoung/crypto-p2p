import { describe as group, expect, it } from 'vitest';
import { describe } from '../lib/notifications';

const TYPES = [
  'order.created',
  'order.paid',
  'order.completed',
  'order.cancelled',
  'order.under_review',
  'order.message',
  'withdrawal.approved',
  'withdrawal.rejected',
  'withdrawal.sent',
  'withdrawal.confirmed',
  'withdrawal.failed',
  'account.status_changed',
];

const note = (type: string, data: Record<string, string | null> = {}, locale: 'ko' | 'en' = 'ko') =>
  describe({ id: '1', type, data, createdAt: '2026-10-22T00:00:00Z', readAt: null }, locale);

group('notification text', () => {
  it('has its own text for every type the API sends', () => {
    for (const type of TYPES) expect(note(type).text).not.toBe('새 알림이 있습니다.');
  });

  it('shows amounts in whole coins and links to the order', () => {
    const n = note('order.completed', { orderId: 'abc', asset: 'BTC', amount: '1500000' });
    expect(n).toEqual({ text: '거래가 완료되었습니다: 0.015 BTC', href: '/orders/abc' });
    expect(note('order.cancelled', { orderId: 'abc', asset: 'BTC', amount: '1', reason: 'expire' }).text).toContain(
      '결제 기한',
    );
    expect(note('withdrawal.rejected', { asset: 'USDT', amount: '5000000', note: '소명 필요' }).text).toBe(
      '출금이 거절되어 잔고로 돌려드렸습니다: 5 USDT (사유: 소명 필요)',
    );
  });

  it('speaks English to English users', () => {
    expect(note('order.completed', { orderId: 'abc', asset: 'BTC', amount: '1500000' }, 'en').text).toBe(
      'Trade completed: 0.015 BTC',
    );
    expect(note('order.created', { asset: 'BTC', amount: '1500000', fiatAmountMinor: '150000' }, 'en').text).toBe(
      'New order on your ad: 0.015 BTC (150,000 KRW)',
    );
  });
});

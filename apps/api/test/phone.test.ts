import { describe, expect, it } from 'vitest';
import { formatPhone, nationalPhone, normalizePhone } from '../src/auth/phone';
import { maskPhone } from '../src/ops/ops.service';

describe('phone numbers', () => {
  it('stores what members type the local way in E.164', () => {
    expect(normalizePhone('KR', '010-1234-5678')).toEqual({ country: 'KR', e164: '+821012345678' });
    expect(normalizePhone('KR', '02 123 4567').e164).toBe('+8221234567');
    expect(normalizePhone('US', '(415) 555-0100').e164).toBe('+14155550100');
    expect(normalizePhone('GB', '07700 900123').e164).toBe('+447700900123');
    // Italian numbers keep their leading 0.
    expect(normalizePhone('IT', '06 1234 5678').e164).toBe('+390612345678');
  });

  it('rejects unknown countries and numbers that cannot be right', () => {
    for (const [country, number] of [
      ['ZZ', '010-1234-5678'],
      ['KR', '010-123'],
      ['KR', '010-1234-5678-9999'],
      ['KR', '+82 10 1234 5678'],
      ['US', 'call me'],
    ] as const) {
      expect(() => normalizePhone(country, number)).toThrow(expect.objectContaining({ code: 'invalid_phone' }));
    }
  });

  it('shows the calling code and the local form', () => {
    expect(formatPhone('+821012345678', 'KR')).toBe('+82 10-1234-5678');
    expect(formatPhone('+8221234567', 'KR')).toBe('+82 2-123-4567');
    expect(formatPhone('+14155550100', 'US')).toBe('+1 4155550100');
    // Saved before country codes were asked.
    expect(formatPhone('010-1234-5678', null)).toBe('010-1234-5678');
    expect(formatPhone(null, null)).toBeNull();
    expect(nationalPhone('+821012345678', 'KR')).toBe('010-1234-5678');
    expect(nationalPhone('+14155550100', 'US')).toBe('4155550100');
  });

  it('masks the middle of the number but keeps the calling code', () => {
    expect(maskPhone('+82 10-1234-5678')).toBe('+82 10-****-5678');
    expect(maskPhone('+1 4155550100')).toBe('+1 41****0100');
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
  });
});

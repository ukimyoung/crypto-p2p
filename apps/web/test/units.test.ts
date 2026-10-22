import { describe, expect, it } from 'vitest';
import { fiatFor, formatKrw, formatUnits, parseUnits } from '../lib/units';

describe('units', () => {
  it('parses decimal coin amounts into smallest units', () => {
    expect(parseUnits('0.015', 8)).toBe(1_500_000n);
    expect(parseUnits('1', 8)).toBe(100_000_000n);
    expect(parseUnits(' 2.5 ', 6)).toBe(2_500_000n);
    expect(parseUnits('0.000000000000000001', 18)).toBe(1n);
  });

  it('rejects anything that is not a positive amount with allowed precision', () => {
    for (const bad of ['', '0', '0.0', '-1', '1e5', 'abc', '1.', '.5', '0.123456789']) {
      expect(parseUnits(bad, 8)).toBeNull();
    }
  });

  it('formats smallest units back to coins', () => {
    expect(formatUnits(1_500_000n, 8)).toBe('0.015');
    expect(formatUnits('123456789000000000000', 18)).toBe('123.456789');
    expect(formatUnits(100_000_000_000n, 8)).toBe('1,000');
  });

  it('computes fiat like the API, rounding down', () => {
    expect(fiatFor(1_000_000n, 100_000_000n, 8)).toBe(1_000_000n);
    expect(fiatFor(1n, 100_000_000n, 8)).toBe(1n);
    expect(fiatFor(1n, 99_999_999n, 8)).toBe(0n);
    expect(formatKrw(1_234_567n)).toBe('1,234,567원');
  });
});

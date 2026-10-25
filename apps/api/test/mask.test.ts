import { describe, expect, it } from 'vitest';
import { maskName, maskNamePart } from '../src/ops/ops.service';

describe('name masking', () => {
  it('hides the middle of a name', () => {
    expect(maskName('홍길동')).toBe('홍*동');
    expect(maskName('홍길')).toBe('홍*');
    expect(maskName(null)).toBeNull();
  });

  it('keeps a one-letter name part, such as a Korean family name', () => {
    expect(maskNamePart('홍')).toBe('홍');
    expect(maskNamePart('길동')).toBe('길*');
    expect(maskNamePart('Gildong')).toBe('G*****g');
    expect(maskNamePart(null)).toBeNull();
  });
});

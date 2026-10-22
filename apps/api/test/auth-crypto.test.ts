import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../src/auth/password';
import { SecretBox } from '../src/auth/secret-box';
import { codeAt, counterAt, generateSecret, matchCode } from '../src/auth/totp';

// Base32 of the ASCII secret "12345678901234567890" from RFC 6238 appendix B.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vectors (last 6 digits)', () => {
    expect(codeAt(RFC_SECRET, counterAt(new Date(59_000)))).toBe('287082');
    expect(codeAt(RFC_SECRET, counterAt(new Date(1_111_111_109_000)))).toBe('081804');
    expect(codeAt(RFC_SECRET, counterAt(new Date(2_000_000_000_000)))).toBe('279037');
  });

  it('accepts one step of drift and nothing beyond', () => {
    const secret = generateSecret();
    const now = new Date('2026-10-22T00:00:15Z');
    const c = counterAt(now);
    expect(matchCode(secret, codeAt(secret, c - 1), now)).toBe(c - 1);
    expect(matchCode(secret, codeAt(secret, c + 1), now)).toBe(c + 1);
    expect(matchCode(secret, codeAt(secret, c + 2), now)).toBeNull();
    expect(matchCode(secret, 'abcdef', now)).toBeNull();
  });
});

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('correct horse 42');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse 42', hash)).toBe(true);
    expect(await verifyPassword('correct horse 43', hash)).toBe(false);
  });

  it('enforces the policy', () => {
    expect(() => assertPasswordPolicy('short1')).toThrow();
    expect(() => assertPasswordPolicy('onlyletterslong')).toThrow();
    expect(() => assertPasswordPolicy('1234567890123')).toThrow();
    expect(() => assertPasswordPolicy('letters and 1 digit')).not.toThrow();
  });
});

describe('SecretBox', () => {
  it('round-trips and rejects tampering', () => {
    const box = new SecretBox(randomBytes(32).toString('base64'));
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => box.open(parts.join('.'))).toThrow();
  });
});

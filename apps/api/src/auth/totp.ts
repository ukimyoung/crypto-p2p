import { createHmac, randomBytes } from 'node:crypto';

// RFC 6238 TOTP with the defaults authenticator apps use: SHA-1, 6 digits, 30-second steps.
const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUrl(secret: string, account: string, issuer = 'P2P'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export function counterAt(time: Date): number {
  return Math.floor(time.getTime() / 1000 / STEP_SECONDS);
}

export function codeAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/**
 * Returns the matching time step, or null. Accepts one step of clock drift either way.
 * Callers must reject a step at or below the last one accepted, so a code works once.
 */
export function matchCode(secret: string, code: string, time: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = counterAt(time);
  for (const counter of [now - 1, now, now + 1]) {
    if (codeAt(secret, counter) === code) return counter;
  }
  return null;
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

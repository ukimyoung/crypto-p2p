import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DomainError } from '../common/errors';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

/**
 * AUTH-1 password policy: 10 to 128 characters with at least one letter and one digit.
 * Any other characters are allowed too: special characters (! @ # ...), spaces, non-Latin letters.
 */
export function assertPasswordPolicy(password: string): void {
  if (password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new DomainError('weak_password', 'Password must be 10-128 characters with letters and digits');
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

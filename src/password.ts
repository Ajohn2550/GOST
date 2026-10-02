import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const MAXMEM = 32 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    if (n < 2 || r < 1 || p < 1) return false;
    const salt = Buffer.from(parts[4] ?? '', 'base64url');
    const key = Buffer.from(parts[5] ?? '', 'base64url');
    if (salt.length === 0 || key.length === 0) return false;
    const got = scryptSync(password, salt, key.length, { N: n, r, p, maxmem: MAXMEM });
    if (got.length !== key.length) return false;
    return timingSafeEqual(got, key);
  } catch {
    return false;
  }
}

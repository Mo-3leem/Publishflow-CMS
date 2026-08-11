import 'server-only';
import argon2 from 'argon2';
import { MIN_PASSWORD_LENGTH } from '@/lib/domain';

/**
 * Argon2id password hashing.
 *
 * Parameters meet the current OWASP baseline (19 MiB, t=2, p=1). They are kept
 * at the baseline rather than higher so CI on a shared runner stays fast; the
 * trade-off is documented in docs/security.md.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a password. Never throws on a malformed hash — a corrupt row must read
 * as "wrong password", not as a 500 that reveals the account exists.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

/**
 * Length-based policy only.
 *
 * Arbitrary composition rules push people toward `Password1!` patterns, so the
 * rule is a 12-character minimum plus a check against the most common leaked
 * passwords.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  'passwordpassword',
  '123456789012',
  'qwertyuiop12',
  'administrator',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
]);

export function validatePasswordPolicy(plain: string): PasswordPolicyResult {
  const errors: string[] = [];

  if (plain.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (plain.length > 200) {
    errors.push('Password must not exceed 200 characters.');
  }
  if (plain.trim().length === 0) {
    errors.push('Password must not be blank.');
  }
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) {
    errors.push('This password is too common. Choose something less predictable.');
  }

  return { ok: errors.length === 0, errors };
}

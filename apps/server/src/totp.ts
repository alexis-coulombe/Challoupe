import { generateSecret, generateURI, verify } from 'otplib';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const BACKUP_CODE_COUNT = 8;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpKeyUri(username: string, secret: string): string {
  return generateURI({ issuer: 'Challoupe', label: username, secret });
}

/**
 * Verify TOTP token
 * @param secret string
 * @param token string
 * @returns boolean
 */
export async function verifyTotpToken(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  // A 30s tolerance absorbs ordinary clock drift between the server and the user's authenticator app
  const result = await verify({ secret, token, epochTolerance: 30 });
  return result.valid;
}

/**
 * Generate 10 hex characters split into two groups.
 * @param count number
 * @returns string[]
 */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export function hashBackupCodes(codes: string[]): string[] {
  return codes.map((code) => bcrypt.hashSync(code, 10));
}

/**
 * Checks `code` against the stored hashes and returns the remaining set with that hash removed
 * @param hashedCodes 
 * @param code 
 * @returns 
 */
export function consumeBackupCode(hashedCodes: string[], code: string): string[] | null {
  const idx = hashedCodes.findIndex((hash) => bcrypt.compareSync(code, hash));
  if (idx === -1) {
    return null;
  }
  
  return [...hashedCodes.slice(0, idx), ...hashedCodes.slice(idx + 1)];
}

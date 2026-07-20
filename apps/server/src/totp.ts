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

// A ±1 time-step (30s) tolerance absorbs ordinary clock drift between the server and the
// user's authenticator app without meaningfully widening the guessable window.
export async function verifyTotpToken(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  const result = await verify({ secret, token, epochTolerance: 30 });
  return result.valid;
}

// Each code is 10 hex characters split into two groups for easier transcription.
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export function hashBackupCodes(codes: string[]): string[] {
  return codes.map((code) => bcrypt.hashSync(code, 10));
}

// Checks `code` against the stored hashes and, on a match, returns the remaining set with
// that hash removed — each backup code is single-use. Returns null when there's no match.
export function consumeBackupCode(hashedCodes: string[], code: string): string[] | null {
  const idx = hashedCodes.findIndex((hash) => bcrypt.compareSync(code, hash));
  if (idx === -1) return null;
  return [...hashedCodes.slice(0, idx), ...hashedCodes.slice(idx + 1)];
}

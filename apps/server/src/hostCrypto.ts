import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | undefined;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const file = path.join(DATA_DIR, '.host-secret-key');
  if (existsSync(file)) {
    cachedKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
    return cachedKey;
  }
  cachedKey = crypto.randomBytes(32);
  writeFileSync(file, cachedKey.toString('hex'), { mode: 0o600 });
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  if (plaintext === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptSecret(ciphertext: string): string {
  if (ciphertext === '') return '';
  const raw = Buffer.from(ciphertext, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

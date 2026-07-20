import { describe, expect, it } from 'vitest';
import { generate } from 'otplib';
import {
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  totpKeyUri,
  verifyTotpToken,
} from './totp.js';

describe('generateTotpSecret', () => {
  it('generates a base32 secret different each time', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]+$/);
    expect(a).not.toBe(b);
  });
});

describe('totpKeyUri', () => {
  it('builds an otpauth:// URI naming Challoupe as the issuer', () => {
    const uri = totpKeyUri('alice', 'JBSWY3DPEHPK3PXP');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('Challoupe');
    expect(uri).toContain('alice');
  });
});

describe('verifyTotpToken', () => {
  it('accepts the current valid code for a secret', async () => {
    const secret = generateTotpSecret();
    const token = await generate({ secret });
    expect(await verifyTotpToken(secret, token)).toBe(true);
  });

  it('rejects an incorrect code', async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotpToken(secret, '000000')).toBe(false);
  });

  it('rejects a non-6-digit input without ever calling into the verifier', async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotpToken(secret, 'not-a-code')).toBe(false);
  });
});

describe('backup codes', () => {
  it('generates 8 unique XXXXX-XXXXX codes by default', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it('consumes a matching code and returns the remaining hashes with it removed', () => {
    const codes = generateBackupCodes(3);
    const hashed = hashBackupCodes(codes);
    const remaining = consumeBackupCode(hashed, codes[1]);
    expect(remaining).toHaveLength(2);
    // The used code no longer matches anything in what's left.
    expect(consumeBackupCode(remaining!, codes[1])).toBeNull();
  });

  it('returns null for a code that was never issued', () => {
    const hashed = hashBackupCodes(generateBackupCodes(3));
    expect(consumeBackupCode(hashed, '00000-00000')).toBeNull();
  });
});

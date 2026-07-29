import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { SystemStatsTokenRepository } from '../src/systemStatsToken.js';

beforeEach(() => {
  db.exec('DELETE FROM system_stats_token');
});

describe('SystemStatsTokenRepository', () => {
  const repo = new SystemStatsTokenRepository(db);

  it('reports not configured with no token', () => {
    expect(repo.status()).toEqual({ configured: false });
  });

  it('regenerates a token and reports it as configured afterward', () => {
    const token = repo.regenerate();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.status()).toMatchObject({ configured: true });
  });

  it('never persists the plaintext token', () => {
    const token = repo.regenerate();
    const row = db.prepare('SELECT token_hash FROM system_stats_token WHERE id = 1').get() as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).not.toContain(token);
  });

  it('verifies the correct token and rejects a wrong one', () => {
    const token = repo.regenerate();
    expect(repo.verify(token)).toBe(true);
    expect(repo.verify('wrong-token')).toBe(false);
  });

  it('rejects any token when none has ever been configured', () => {
    expect(repo.verify('anything')).toBe(false);
  });

  it('invalidates the previous token when regenerated', () => {
    const first = repo.regenerate();
    const second = repo.regenerate();
    expect(repo.verify(first)).toBe(false);
    expect(repo.verify(second)).toBe(true);
  });

  it('revokes the token, after which nothing verifies and status reports unconfigured', () => {
    const token = repo.regenerate();
    repo.revoke();
    expect(repo.verify(token)).toBe(false);
    expect(repo.status()).toEqual({ configured: false });
  });
});

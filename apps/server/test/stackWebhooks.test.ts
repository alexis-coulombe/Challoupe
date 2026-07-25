import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { StackWebhookRepository } from '../src/stackWebhooks.js';

beforeEach(() => {
  db.exec('DELETE FROM stack_webhooks');
});

describe('StackWebhookRepository', () => {
  const repo = new StackWebhookRepository(db);

  it('reports not configured for a stack with no webhook', () => {
    expect(repo.status('myapp')).toEqual({ configured: false });
  });

  it('regenerates a token and reports it as configured afterward', () => {
    const token = repo.regenerate('myapp');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.status('myapp')).toMatchObject({ configured: true });
  });

  it('never persists the plaintext token', () => {
    const token = repo.regenerate('myapp');
    const row = db.prepare('SELECT token_hash FROM stack_webhooks WHERE stack_name = ?').get('myapp') as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).not.toContain(token);
  });

  it('verifies the correct token and rejects a wrong one', () => {
    const token = repo.regenerate('myapp');
    expect(repo.verify('myapp', token)).toBe(true);
    expect(repo.verify('myapp', 'wrong-token')).toBe(false);
  });

  it('rejects any token for a stack that never had a webhook configured', () => {
    expect(repo.verify('never-configured', 'anything')).toBe(false);
  });

  it('invalidates the previous token when regenerated', () => {
    const first = repo.regenerate('myapp');
    const second = repo.regenerate('myapp');
    expect(repo.verify('myapp', first)).toBe(false);
    expect(repo.verify('myapp', second)).toBe(true);
  });

  it('revokes a webhook, after which no token verifies and status reports unconfigured', () => {
    const token = repo.regenerate('myapp');
    repo.revoke('myapp');
    expect(repo.verify('myapp', token)).toBe(false);
    expect(repo.status('myapp')).toEqual({ configured: false });
  });

  it('tracks tokens independently per stack', () => {
    const tokenA = repo.regenerate('app-a');
    const tokenB = repo.regenerate('app-b');
    expect(repo.verify('app-a', tokenB)).toBe(false);
    expect(repo.verify('app-b', tokenA)).toBe(false);
    expect(repo.verify('app-a', tokenA)).toBe(true);
    expect(repo.verify('app-b', tokenB)).toBe(true);
  });
});

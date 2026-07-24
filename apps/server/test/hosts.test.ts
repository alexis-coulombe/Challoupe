import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { HostRepository } from '../src/hosts.js';

beforeEach(() => {
  db.exec('DELETE FROM hosts');
});

describe('HostRepository', () => {
  const repo = new HostRepository(db);

  it('creates a host and returns a summary without the private key/passphrase', () => {
    const host = repo.create({
      name: 'prod-server',
      sshHost: '192.168.1.50',
      sshPort: 22,
      sshUsername: 'deploy',
      sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
      createdBy: 1,
    });
    expect(host).toMatchObject({
      name: 'prod-server',
      sshHost: '192.168.1.50',
      sshPort: 22,
      sshUsername: 'deploy',
      hasPassphrase: false,
    });
    expect(host).not.toHaveProperty('sshPrivateKey');
  });

  it('encrypts the private key at rest instead of storing it as plaintext', () => {
    const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nsupersecret\n-----END OPENSSH PRIVATE KEY-----';
    const host = repo.create({
      name: 'h1',
      sshHost: 'h',
      sshPort: 22,
      sshUsername: 'u',
      sshPrivateKey: key,
      createdBy: 1,
    });
    const row = db.prepare('SELECT ssh_private_key FROM hosts WHERE id = ?').get(host.id) as {
      ssh_private_key: string;
    };
    expect(row.ssh_private_key).not.toContain('supersecret');
    expect(row.ssh_private_key).not.toBe(key);
  });

  it('round-trips the private key and passphrase through getConnection()', () => {
    const host = repo.create({
      name: 'h2',
      sshHost: 'h',
      sshPort: 2222,
      sshUsername: 'u',
      sshPrivateKey: 'key-content',
      sshPassphrase: 'shh',
      createdBy: 1,
    });
    expect(repo.getConnection(host.id)).toEqual({
      sshHost: 'h',
      sshPort: 2222,
      sshUsername: 'u',
      sshPrivateKey: 'key-content',
      sshPassphrase: 'shh',
    });
  });

  it('reports hasPassphrase correctly', () => {
    const withPass = repo.create({
      name: 'a',
      sshHost: 'h',
      sshPort: 22,
      sshUsername: 'u',
      sshPrivateKey: 'k',
      sshPassphrase: 'p',
      createdBy: 1,
    });
    const withoutPass = repo.create({
      name: 'b',
      sshHost: 'h',
      sshPort: 22,
      sshUsername: 'u',
      sshPrivateKey: 'k',
      createdBy: 1,
    });
    expect(withPass.hasPassphrase).toBe(true);
    expect(withoutPass.hasPassphrase).toBe(false);
  });

  it('lists hosts alphabetically by name', () => {
    repo.create({ name: 'zeta', sshHost: 'h', sshPort: 22, sshUsername: 'u', sshPrivateKey: 'k', createdBy: 1 });
    repo.create({ name: 'alpha', sshHost: 'h', sshPort: 22, sshUsername: 'u', sshPrivateKey: 'k', createdBy: 1 });
    expect(repo.list().map((h) => h.name)).toEqual(['alpha', 'zeta']);
  });

  it('updates fields independently, leaving others intact', () => {
    const host = repo.create({
      name: 'orig',
      sshHost: 'h1',
      sshPort: 22,
      sshUsername: 'u1',
      sshPrivateKey: 'k1',
      createdBy: 1,
    });
    const updated = repo.update(host.id, { sshHost: 'h2' });
    expect(updated).toMatchObject({ name: 'orig', sshHost: 'h2', sshUsername: 'u1' });
  });

  it('leaves the stored private key unchanged when an update sends a blank one', () => {
    const host = repo.create({
      name: 'orig',
      sshHost: 'h',
      sshPort: 22,
      sshUsername: 'u',
      sshPrivateKey: 'original-key',
      createdBy: 1,
    });
    repo.update(host.id, { sshPrivateKey: '', sshHost: 'new-host' });
    const conn = repo.getConnection(host.id);
    expect(conn?.sshPrivateKey).toBe('original-key');
    expect(conn?.sshHost).toBe('new-host');
  });

  it('leaves the stored passphrase unchanged when an update sends a blank one', () => {
    const host = repo.create({
      name: 'orig',
      sshHost: 'h',
      sshPort: 22,
      sshUsername: 'u',
      sshPrivateKey: 'k',
      sshPassphrase: 'first',
      createdBy: 1,
    });
    repo.update(host.id, { sshPassphrase: '' });
    expect(repo.getConnection(host.id)?.sshPassphrase).toBe('first');
  });

  it('returns undefined when updating a host that does not exist', () => {
    expect(repo.update(9999, { name: 'x' })).toBeUndefined();
  });

  it('deletes a host', () => {
    const host = repo.create({ name: 'gone', sshHost: 'h', sshPort: 22, sshUsername: 'u', sshPrivateKey: 'k', createdBy: 1 });
    expect(repo.remove(host.id)).toBe(true);
    expect(repo.getSummary(host.id)).toBeUndefined();
  });

  it('returns false when deleting a host that does not exist', () => {
    expect(repo.remove(9999)).toBe(false);
  });
});

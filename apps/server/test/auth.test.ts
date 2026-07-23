import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { hashPassword, userRepository, verifyPassword } from '../src/auth.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
});

describe('password hashing', () => {
  it('round-trips a password through hash and verify', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash each time (salted)', () => {
    expect(hashPassword('same-password')).not.toBe(hashPassword('same-password'));
  });
});

describe('user lookups', () => {
  it('reports zero users on an empty database', () => {
    expect(userRepository.count()).toBe(0);
  });

  it('finds a user by username after insertion', () => {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run('alice', hashPassword('secret123'), 'admin');

    expect(userRepository.count()).toBe(1);
    const found = userRepository.findByUsername('alice');
    expect(found?.role).toBe('admin');
    expect(userRepository.getById(Number(info.lastInsertRowid))?.username).toBe('alice');
  });

  it('returns undefined for an unknown username', () => {
    expect(userRepository.findByUsername('nobody')).toBeUndefined();
  });
});

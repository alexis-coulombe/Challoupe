import type Database from 'better-sqlite3';
import { db } from './db.js';
import { decryptSecret, encryptSecret } from './hostCrypto.js';

export interface HostSummary {
  id: number;
  name: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  hasPassphrase: boolean;
  createdAt: string;
}

export interface HostConnection {
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPrivateKey: string;
  sshPassphrase: string;
}

export interface HostCreate {
  name: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPrivateKey: string;
  sshPassphrase?: string;
  createdBy: number;
}

export interface HostUpdate {
  name?: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
}

interface HostRow {
  id: number;
  name: string;
  ssh_host: string;
  ssh_port: number;
  ssh_username: string;
  ssh_private_key: string;
  ssh_passphrase: string;
  created_at: string;
  created_by: number | null;
}

function toSummary(row: HostRow): HostSummary {
  return {
    id: row.id,
    name: row.name,
    sshHost: row.ssh_host,
    sshPort: row.ssh_port,
    sshUsername: row.ssh_username,
    hasPassphrase: row.ssh_passphrase !== '',
    createdAt: row.created_at,
  };
}

export class HostRepository {
  constructor(private readonly db: Database.Database) {}

  list(): HostSummary[] {
    const rows = this.db.prepare('SELECT * FROM hosts ORDER BY name').all() as HostRow[];
    return rows.map(toSummary);
  }

  getSummary(id: number): HostSummary | undefined {
    const row = this.db.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  getConnection(id: number): HostConnection | undefined {
    const row = this.db.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow | undefined;
    if (!row) return undefined;
    return {
      sshHost: row.ssh_host,
      sshPort: row.ssh_port,
      sshUsername: row.ssh_username,
      sshPrivateKey: decryptSecret(row.ssh_private_key),
      sshPassphrase: decryptSecret(row.ssh_passphrase),
    };
  }

  create(input: HostCreate): HostSummary {
    const info = this.db
      .prepare(
        `INSERT INTO hosts (name, ssh_host, ssh_port, ssh_username, ssh_private_key, ssh_passphrase, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.sshHost,
        input.sshPort,
        input.sshUsername,
        encryptSecret(input.sshPrivateKey),
        encryptSecret(input.sshPassphrase ?? ''),
        input.createdBy
      );
    return this.getSummary(Number(info.lastInsertRowid))!;
  }

  // Blank sshPrivateKey/sshPassphrase means "leave unchanged", same convention as
  // settings.ts's oidc.clientSecret/ntfy.password.
  update(id: number, input: HostUpdate): HostSummary | undefined {
    if (!this.getSummary(id)) return undefined;
    const sets: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) {
      sets.push('name = ?');
      values.push(input.name);
    }
    if (input.sshHost !== undefined) {
      sets.push('ssh_host = ?');
      values.push(input.sshHost);
    }
    if (input.sshPort !== undefined) {
      sets.push('ssh_port = ?');
      values.push(input.sshPort);
    }
    if (input.sshUsername !== undefined) {
      sets.push('ssh_username = ?');
      values.push(input.sshUsername);
    }
    if (input.sshPrivateKey) {
      sets.push('ssh_private_key = ?');
      values.push(encryptSecret(input.sshPrivateKey));
    }
    if (input.sshPassphrase) {
      sets.push('ssh_passphrase = ?');
      values.push(encryptSecret(input.sshPassphrase));
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    }
    return this.getSummary(id);
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM hosts WHERE id = ?').run(id).changes > 0;
  }
}

export const hostRepository = new HostRepository(db);

/**
 * Every host id background services should loop over: the 'local' sentinel plus every
 * registered remote host, as string ids matching what hostManager.getClient() expects.
 */
export function allHostIds(): string[] {
  return ['local', ...hostRepository.list().map((h) => String(h.id))];
}

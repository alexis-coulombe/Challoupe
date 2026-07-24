import http from 'node:http';
import Docker from 'dockerode';
import type Dockerode from 'dockerode';
import { Client as SshClient } from 'ssh2';
import { docker } from './docker.js';
import { hostRepository, type HostConnection } from './hosts.js';

const DIAL_STDIO_COMMAND = 'docker system dial-stdio';

interface CachedClient {
  client: Docker;
  sshConn: SshClient;
}

function connectSsh(conn: HostConnection): Promise<SshClient> {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    client
      .on('ready', () => resolve(client))
      .on('error', reject)
      .connect({
        host: conn.sshHost,
        port: conn.sshPort,
        username: conn.sshUsername,
        privateKey: conn.sshPrivateKey,
        passphrase: conn.sshPassphrase || undefined,
        readyTimeout: 15_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
      });
  });
}

function buildAgent(sshConn: SshClient): http.Agent {
  const agent = new http.Agent({ keepAlive: true });
  agent.createConnection = (_options, callback) => {
    sshConn.exec(DIAL_STDIO_COMMAND, (err, stream) => {
      callback?.(err ?? null, stream);
    });
    return undefined;
  };
  return agent;
}

function buildDockerClient(sshConn: SshClient): Docker {
  return new Docker({
    protocol: 'http',
    host: 'localhost',
    port: 2375,
    agent: buildAgent(sshConn),
  } as Dockerode.DockerOptions & { agent: http.Agent });
}

/**
 * Resolves a hostId (route param, always a string) to a live dockerode client. 
 */
export class HostManager {
  private readonly clients = new Map<string, CachedClient>();

  async getClient(hostId: string): Promise<Docker | null> {
    if (hostId === 'local') return docker;

    const cached = this.clients.get(hostId);
    if (cached) return cached.client;

    const numericId = Number(hostId);
    if (!Number.isInteger(numericId)) return null;
    const conn = hostRepository.getConnection(numericId);
    if (!conn) return null;

    const sshConn = await connectSsh(conn);
    sshConn.on('close', () => this.clients.delete(hostId));
    sshConn.on('error', () => this.clients.delete(hostId));

    const client = buildDockerClient(sshConn);
    this.clients.set(hostId, { client, sshConn });
    return client;
  }

  invalidate(hostId: string): void {
    const cached = this.clients.get(hostId);
    if (cached) {
      cached.sshConn.end();
      this.clients.delete(hostId);
    }
  }

  async testConnection(conn: HostConnection): Promise<{ ok: boolean; error?: string }> {
    let sshConn: SshClient | undefined;
    try {
      sshConn = await connectSsh(conn);
      await buildDockerClient(sshConn).ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      sshConn?.end();
    }
  }
}

export const hostManager = new HostManager();

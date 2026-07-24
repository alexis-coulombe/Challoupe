import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let nextConnectError: Error | null = null;

class FakeSshClient extends EventEmitter {
  connect = vi.fn(() => {
    queueMicrotask(() => {
      if (nextConnectError) this.emit('error', nextConnectError);
      else this.emit('ready');
    });
  });
  exec = vi.fn((_cmd: string, cb: (err: Error | null, stream: unknown) => void) => {
    cb(null, new EventEmitter());
  });
  end = vi.fn();
}

const createdSshClients: FakeSshClient[] = [];
vi.mock('ssh2', () => ({
  Client: vi.fn().mockImplementation(() => {
    const client = new FakeSshClient();
    createdSshClients.push(client);
    return client;
  }),
}));

const mockPing = vi.fn();
const dockerConstructorCalls: unknown[] = [];
vi.mock('dockerode', () => ({
  default: vi.fn().mockImplementation((opts: unknown) => {
    dockerConstructorCalls.push(opts);
    return { ping: mockPing };
  }),
}));

const localDockerSentinel = { sentinel: 'local' };
vi.mock('../src/docker.js', () => ({ docker: localDockerSentinel }));

const mockGetConnection = vi.fn();
vi.mock('../src/hosts.js', () => ({
  hostRepository: { getConnection: mockGetConnection },
}));

const { HostManager } = await import('../src/hostManager.js');

const validConnection = {
  sshHost: '10.0.0.5',
  sshPort: 22,
  sshUsername: 'deploy',
  sshPrivateKey: 'key-content',
  sshPassphrase: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  createdSshClients.length = 0;
  dockerConstructorCalls.length = 0;
  nextConnectError = null;
  mockPing.mockResolvedValue(undefined);
});

describe('HostManager.getClient', () => {
  it("returns the local docker singleton for hostId 'local' without touching ssh2", async () => {
    const manager = new HostManager();
    const client = await manager.getClient('local');
    expect(client).toBe(localDockerSentinel);
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(createdSshClients).toHaveLength(0);
  });

  it('returns null for a non-numeric hostId', async () => {
    const manager = new HostManager();
    expect(await manager.getClient('not-a-number')).toBeNull();
  });

  it('returns null when the host does not exist', async () => {
    mockGetConnection.mockReturnValue(undefined);
    const manager = new HostManager();
    expect(await manager.getClient('42')).toBeNull();
  });

  it('builds an SSH-tunneled dockerode client for a valid host', async () => {
    mockGetConnection.mockReturnValue(validConnection);
    const manager = new HostManager();
    const client = await manager.getClient('42');
    expect(client).toEqual({ ping: mockPing });
    expect(createdSshClients).toHaveLength(1);
    expect(createdSshClients[0].connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: '10.0.0.5', port: 22, username: 'deploy', privateKey: 'key-content' })
    );
    expect(dockerConstructorCalls[0]).toMatchObject({ protocol: 'http', host: 'localhost', port: 2375 });
  });

  it('reuses the same cached client on a second call, without reconnecting SSH', async () => {
    mockGetConnection.mockReturnValue(validConnection);
    const manager = new HostManager();
    const first = await manager.getClient('7');
    const second = await manager.getClient('7');
    expect(second).toBe(first);
    expect(createdSshClients).toHaveLength(1);
  });

  it('invalidate() ends the SSH connection and forces a fresh connect on the next call', async () => {
    mockGetConnection.mockReturnValue(validConnection);
    const manager = new HostManager();
    await manager.getClient('7');
    manager.invalidate('7');
    expect(createdSshClients[0].end).toHaveBeenCalledOnce();
    await manager.getClient('7');
    expect(createdSshClients).toHaveLength(2);
  });

  it('evicts the cached client when the SSH connection closes on its own', async () => {
    mockGetConnection.mockReturnValue(validConnection);
    const manager = new HostManager();
    await manager.getClient('7');
    createdSshClients[0].emit('close');
    await manager.getClient('7');
    expect(createdSshClients).toHaveLength(2);
  });
});

describe('HostManager.testConnection', () => {
  it('returns ok:true and closes the throwaway connection on success', async () => {
    const manager = new HostManager();
    const result = await manager.testConnection(validConnection);
    expect(result).toEqual({ ok: true });
    expect(createdSshClients[0].end).toHaveBeenCalledOnce();
  });

  it('returns ok:false with the error message when the SSH connection fails', async () => {
    nextConnectError = new Error('auth failed');
    const manager = new HostManager();
    const result = await manager.testConnection(validConnection);
    expect(result).toEqual({ ok: false, error: 'auth failed' });
  });

  it('propagates a ping failure as ok:false, still closing the connection', async () => {
    mockPing.mockRejectedValueOnce(new Error('connection refused'));
    const manager = new HostManager();
    const result = await manager.testConnection(validConnection);
    expect(result).toEqual({ ok: false, error: 'connection refused' });
    expect(createdSshClients[0].end).toHaveBeenCalledOnce();
  });
});

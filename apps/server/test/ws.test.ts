import { PassThrough, Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';

const mockContainer = { stats: vi.fn(), exec: vi.fn(), inspect: vi.fn(), logs: vi.fn() };
const mockDocker = { getContainer: vi.fn(() => mockContainer), listContainers: vi.fn() };

vi.mock('../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/docker.js')>();
  return { ...actual, docker: mockDocker };
});

const { app, server } = await import('../src/index.js');
const { db } = await import('../src/db.js');

let port: number;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
  vi.clearAllMocks();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function loginCookie(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ username: 'admin', password: 'password123' });
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  return setCookie[0].split(';')[0];
}

// Requires an admin session to already exist (the first account is always admin).
async function nonAdminCookie(adminCookie: string, permissions: Record<string, boolean> = {}): Promise<string> {
  await request(app)
    .post('/api/users')
    .set('Cookie', adminCookie)
    .send({ username: 'viewer', password: 'password123', role: 'user', permissions });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'viewer', password: 'password123' });
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  return setCookie[0].split(';')[0];
}

// Waits out the full close handshake so no connection is left open when the
// next test's afterEach tears the server down.
function closeAndWait(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });
}

describe('WS /containers/:id/stats', () => {
  it('rejects a connection with no valid session', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/containers/abc/stats`);
    const statusCode = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('connection should have been rejected')));
      ws.on('error', () => {});
    });
    expect(statusCode).toBe(401);
  });

  it('streams a summarized sample to an authenticated client', async () => {
    const cookie = await loginCookie();
    const raw = {
      read: '2026-01-01T00:00:00Z',
      cpu_stats: { cpu_usage: { total_usage: 2_000_000_000 }, system_cpu_usage: 20_000_000_000, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 1_000_000_000 }, system_cpu_usage: 10_000_000_000 },
      memory_stats: { usage: 100_000_000, limit: 500_000_000, stats: { cache: 20_000_000 } },
      networks: { eth0: { rx_bytes: 1000, tx_bytes: 2000 } },
    };
    mockContainer.stats.mockImplementation((_opts: unknown, cb: (err: null, stream: Readable) => void) => {
      cb(null, Readable.from([Buffer.from(JSON.stringify(raw) + '\n')]));
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/containers/abc/stats`, {
      headers: { Cookie: cookie },
    });

    const message = await new Promise<string>((resolve, reject) => {
      ws.on('message', (data) => resolve(data.toString()));
      ws.on('error', reject);
    });
    await closeAndWait(ws);

    const sample = JSON.parse(message);
    expect(sample.cpuPercent).toBeCloseTo(20, 5);
    expect(sample.memoryUsage).toBe(80_000_000);
    expect(sample.networkRx).toBe(1000);
    expect(sample.networkTx).toBe(2000);
    expect(mockDocker.getContainer).toHaveBeenCalledWith('abc');
  });
});

describe('WS /containers/:id/logs', () => {
  it('clamps an oversized tail request to the same 5000-line cap as the REST endpoint', async () => {
    const cookie = await loginCookie();
    mockContainer.inspect.mockResolvedValue({ Config: { Tty: false } });
    mockContainer.logs.mockResolvedValue(Readable.from([]));

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/containers/abc/logs?tail=999999999`, {
      headers: { Cookie: cookie },
    });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockContainer.logs).toHaveBeenCalledWith(expect.objectContaining({ tail: 5000 }));
    // The empty mock stream ends (and the server closes the socket) almost immediately,
    // so the connection is very likely already closed by now. closeAndWait would hang
    // waiting for a 'close' event that already fired before it attached its listener.
    if (ws.readyState !== WebSocket.CLOSED) await closeAndWait(ws);
  });
});

describe('WS /containers/:id/exec', () => {
  function mockExecSession() {
    const execStream = new PassThrough();
    const exec = { resize: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(execStream) };
    mockContainer.exec.mockResolvedValue(exec);
    return { execStream, exec };
  }

  async function waitForExecCall(): Promise<void> {
    // The exec session is created asynchronously right after the WS handshake; give that microtask a tick.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('falls back to the configured default shell when none is requested', async () => {
    const cookie = await loginCookie();
    await request(app).put('/api/settings').set('Cookie', cookie).send({ defaultTerminalShell: '/bin/bash' });
    mockExecSession();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/containers/abc/exec`, { headers: { Cookie: cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    await waitForExecCall();

    expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({ Cmd: ['/bin/bash'] }));
    await closeAndWait(ws);
  });

  it('uses an explicitly requested shell from the allow-list over the default', async () => {
    const cookie = await loginCookie();
    mockExecSession();

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/containers/abc/exec?shell=${encodeURIComponent('/bin/ash')}`,
      { headers: { Cookie: cookie } }
    );
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    await waitForExecCall();

    expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({ Cmd: ['/bin/ash'] }));
    await closeAndWait(ws);
  });

  it('rejects a shell outside the allow-list and falls back to the default instead', async () => {
    const cookie = await loginCookie();
    mockExecSession();

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/containers/abc/exec?shell=${encodeURIComponent('/bin/evil')}`,
      { headers: { Cookie: cookie } }
    );
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    await waitForExecCall();

    expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({ Cmd: ['/bin/sh'] }));
    await closeAndWait(ws);
  });

  it('rejects a non-admin user with 403, since a shell is as powerful as the Docker socket itself', async () => {
    const adminCookie = await loginCookie();
    const cookie = await nonAdminCookie(adminCookie);
    mockExecSession();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/containers/abc/exec`, { headers: { Cookie: cookie } });
    const statusCode = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('connection should have been rejected')));
      ws.on('error', () => {});
    });
    expect(statusCode).toBe(403);
    expect(mockContainer.exec).not.toHaveBeenCalled();
  });

  it('allows a non-admin user granted the exec permission', async () => {
    const adminCookie = await loginCookie();
    const cookie = await nonAdminCookie(adminCookie, { exec: true });
    mockExecSession();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/containers/abc/exec`, { headers: { Cookie: cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    await waitForExecCall();

    expect(mockContainer.exec).toHaveBeenCalledOnce();
    await closeAndWait(ws);
  });
});

describe('WS unknown path', () => {
  it('destroys the socket without a WebSocket handshake', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/not-a-real-route`);
    const errored = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(false));
      ws.on('error', () => resolve(true));
      ws.on('unexpected-response', () => resolve(true));
    });
    expect(errored).toBe(true);
  });
});

function mockOllamaStream(chunks: string[]): void {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(chunks.join(''), { status: 200 })) as unknown as typeof fetch;
}

function collectMessages(ws: WebSocket, count: number): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const received: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
      if (received.length >= count) resolve(received);
    });
    ws.on('error', reject);
  });
}

describe('WS /ws/ai/* with the feature flag disabled', () => {
  it('rejects the upgrade with 403 instead of dispatching to a handler', async () => {
    const cookie = await loginCookie();
    await request(app).put('/api/settings').set('Cookie', cookie).send({ featureFlags: { aiAssistant: false } });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ai/generate-stack`, { headers: { Cookie: cookie } });
    const statusCode = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('connection should have been rejected')));
      ws.on('error', () => {});
    });
    expect(statusCode).toBe(403);
  });
});

describe('WS /ai/diagnose/:id', () => {
  it('streams a diagnosis built from the container logs and closes when done', async () => {
    const cookie = await loginCookie();
    await request(app).put('/api/settings').set('Cookie', cookie).send({ ollamaModel: 'llama3.1' });
    mockContainer.inspect.mockResolvedValue({
      Name: '/my-app',
      Config: { Image: 'nginx:alpine', Tty: false },
      State: { Status: 'running', ExitCode: 0 },
    });
    mockContainer.logs.mockResolvedValue(Buffer.from('plain log line\n'));
    mockOllamaStream(['{"message":{"content":"Looks healthy."}}\n', '{"done":true}\n']);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ai/diagnose/abc`, { headers: { Cookie: cookie } });
    const messages = await collectMessages(ws, 2);
    await closeAndWait(ws);

    expect(messages[0]).toEqual({ type: 'token', content: 'Looks healthy.' });
    expect(messages[1]).toEqual({ type: 'done' });
    expect(mockDocker.getContainer).toHaveBeenCalledWith('abc');
  });

  it('sends an error frame when no Ollama model is configured', async () => {
    const cookie = await loginCookie();
    mockContainer.inspect.mockResolvedValue({
      Name: '/my-app',
      Config: { Image: 'nginx:alpine', Tty: false },
      State: { Status: 'running', ExitCode: 0 },
    });
    mockContainer.logs.mockResolvedValue(Buffer.from(''));

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ai/diagnose/abc`, { headers: { Cookie: cookie } });
    const [message] = await collectMessages(ws, 1);
    await closeAndWait(ws);

    expect(message).toEqual({ type: 'error', message: expect.stringContaining('No Ollama model configured') });
  });
});

describe('WS /ai/generate-stack', () => {
  it('streams a compose file generated from a prompt', async () => {
    const cookie = await loginCookie();
    await request(app).put('/api/settings').set('Cookie', cookie).send({ ollamaModel: 'llama3.1' });
    mockOllamaStream(['{"message":{"content":"services:\\n"}}\n', '{"done":true}\n']);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ai/generate-stack`, { headers: { Cookie: cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    ws.send(JSON.stringify({ type: 'prompt', text: 'a redis cache' }));

    const messages = await collectMessages(ws, 2);
    await closeAndWait(ws);

    expect(messages[0]).toEqual({ type: 'token', content: 'services:\n' });
    expect(messages[1]).toEqual({ type: 'done' });
  });
});

describe('WS /ai/chat', () => {
  it('answers with infra context and keeps the connection open for another turn', async () => {
    const cookie = await loginCookie();
    await request(app).put('/api/settings').set('Cookie', cookie).send({ ollamaModel: 'llama3.1' });
    mockDocker.listContainers.mockResolvedValue([
      { Names: ['/web'], Image: 'nginx:alpine', State: 'running', Status: 'Up 2 hours' },
    ]);
    mockOllamaStream(['{"message":{"content":"You have one container."}}\n', '{"done":true}\n']);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ai/chat`, { headers: { Cookie: cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    ws.send(JSON.stringify({ type: 'message', messages: [{ role: 'user', content: 'what is running?' }] }));

    const messages = await collectMessages(ws, 2);
    expect(messages[0]).toEqual({ type: 'token', content: 'You have one container.' });
    expect(messages[1]).toEqual({ type: 'done' });
    expect(ws.readyState).toBe(ws.OPEN);
    expect(mockDocker.listContainers).toHaveBeenCalledWith({ all: true });

    await closeAndWait(ws);
  });
});

import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';

const mockDocker = { getEvents: vi.fn() };

vi.mock('../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/docker.js')>();
  return { ...actual, docker: mockDocker };
});

const mockNotifyContainerEvent = vi.fn();
vi.mock('../src/integrations/notifications/notifications.js', () => ({
  notificationService: { notifyContainerEvent: mockNotifyContainerEvent },
}));

const mockDiagnose = vi.fn();
vi.mock('../src/containerWatchdog.js', () => ({
  containerWatchdog: { diagnose: mockDiagnose },
}));

const { app, server } = await import('../src/index.js');
const { db } = await import('../src/db.js');
const { settingsService } = await import('../src/settings.js');

// The broadcaster only ever calls docker.getEvents() once (its "streamStarted" guard is a
// module-level singleton that outlives any single test), so every test in this file must
// push onto this same stream rather than handing the mock a fresh one each time.
const eventStream = new Readable({ read() {} });
mockDocker.getEvents.mockResolvedValue(eventStream);

let port: number;

beforeEach(async () => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
  vi.clearAllMocks();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function loginCookie(): Promise<string> {
  const res = await request(app).post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  return setCookie[0].split(';')[0];
}

function closeAndWait(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });
}

describe('WS /events', () => {
  it('rejects a connection with no valid session', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`);
    const statusCode = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('connection should have been rejected')));
      ws.on('error', () => {});
    });
    expect(statusCode).toBe(401);
  });

  it('broadcasts a crash notification but filters out a clean exit and unrelated events', async () => {
    const cookie = await loginCookie();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`, { headers: { Cookie: cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));

    const events = [
      { Type: 'container', Action: 'start', Actor: { ID: 'aaa', Attributes: { name: 'web' } }, time: 1 },
      {
        Type: 'container',
        Action: 'die',
        Actor: { ID: 'bbb', Attributes: { name: 'worker', exitCode: '0' } },
        time: 2,
      },
      {
        Type: 'container',
        Action: 'die',
        Actor: { ID: 'ccc', Attributes: { name: 'db', exitCode: '137' } },
        time: 3,
      },
    ];
    for (const event of events) eventStream.push(JSON.stringify(event) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 50));
    await closeAndWait(ws);

    expect(messages).toEqual([
      { type: 'container_event', action: 'crashed', containerId: 'ccc', containerName: 'db', exitCode: 137, time: 3 },
    ]);
    // Only the crash reaches the notification service, same filtering as the WS broadcast.
    expect(mockNotifyContainerEvent).toHaveBeenCalledOnce();
    expect(mockNotifyContainerEvent).toHaveBeenCalledWith('db', 'crashed (exit code 137)');
  });

  it('enriches the notification with the AI watchdog diagnosis when it flags something', async () => {
    settingsService.update({
      featureFlags: { aiAssistant: true },
      aiWatchdog: { enabled: true, checkContainerEvents: true },
    });
    mockDiagnose.mockResolvedValue('the app is missing a required environment variable');

    const cookie = await loginCookie();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`, { headers: { Cookie: cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    eventStream.push(
      JSON.stringify({
        Type: 'container',
        Action: 'die',
        Actor: { ID: 'ccc', Attributes: { name: 'db', exitCode: '137' } },
        time: 3,
      }) + '\n'
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    await closeAndWait(ws);

    expect(mockDiagnose).toHaveBeenCalledWith('ccc', 'db', 'crashed (exit code 137)');
    expect(mockNotifyContainerEvent).toHaveBeenCalledWith(
      'db',
      'crashed (exit code 137) AI diagnosis: the app is missing a required environment variable'
    );
  });

  it('falls back to the plain notification when the watchdog is enabled but finds nothing notable', async () => {
    settingsService.update({
      featureFlags: { aiAssistant: true },
      aiWatchdog: { enabled: true, checkContainerEvents: true },
    });
    mockDiagnose.mockResolvedValue(null);

    const cookie = await loginCookie();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`, { headers: { Cookie: cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    eventStream.push(
      JSON.stringify({
        Type: 'container',
        Action: 'die',
        Actor: { ID: 'ccc', Attributes: { name: 'db', exitCode: '137' } },
        time: 3,
      }) + '\n'
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    await closeAndWait(ws);

    expect(mockDiagnose).toHaveBeenCalledOnce();
    expect(mockNotifyContainerEvent).toHaveBeenCalledWith('db', 'crashed (exit code 137)');
  });
});

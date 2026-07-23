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

const { app, server } = await import('../src/index.js');
const { db } = await import('../src/db.js');

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
    const stream = new Readable({ read() {} });
    mockDocker.getEvents.mockResolvedValue(stream);

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
    for (const event of events) stream.push(JSON.stringify(event) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 50));
    await closeAndWait(ws);

    expect(messages).toEqual([
      { type: 'container_event', action: 'crashed', containerId: 'ccc', containerName: 'db', exitCode: 137, time: 3 },
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { createAdminAgent, createUserAgent } from '../helpers.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('GET /api/ai/models', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/ai/models');
    expect(res.status).toBe(401);
  });

  it('returns the model list from a reachable Ollama server', async () => {
    const { agent } = await createAdminAgent(app);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'llama3.1' }] }), { status: 200 })
    ) as unknown as typeof fetch;

    const res = await agent.get('/api/ai/models');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: ['llama3.1'] });
  });

  it('returns a 502 with a friendly message when Ollama is unreachable', async () => {
    const { agent } = await createAdminAgent(app);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;

    const res = await agent.get('/api/ai/models');
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Could not reach Ollama');
  });

  it('returns a 403 when the aiAssistant feature flag is disabled', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.put('/api/settings').send({ featureFlags: { aiAssistant: false } });
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const res = await agent.get('/api/ai/models');
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-admin even with useAi granted, since baseUrl is an SSRF primitive', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', { useAi: true });
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const res = await agent.get('/api/ai/models');
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('tests a baseUrl passed as a query param instead of the saved setting', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.put('/api/settings').send({ ollamaBaseUrl: 'http://saved:11434' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await agent.get('/api/ai/models?baseUrl=http://not-yet-saved:11434');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://not-yet-saved:11434/api/tags',
      expect.anything()
    );
  });

  it('falls back to the saved base URL when no query param is given', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.put('/api/settings').send({ ollamaBaseUrl: 'http://saved:11434' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await agent.get('/api/ai/models');
    expect(fetchMock).toHaveBeenCalledWith('http://saved:11434/api/tags', expect.anything());
  });
});

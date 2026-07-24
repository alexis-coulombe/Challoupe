import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createAdminAgent, createUserAgent } from '../helpers.js';

vi.mock('../../src/trivy.js', () => ({ scanImage: vi.fn() }));

const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db.js');
const { scanImage } = await import('../../src/trivy.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
  vi.clearAllMocks();
});

describe('POST /api/trivy/scan', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/trivy/scan').send({ image: 'nginx:alpine' });
    expect(res.status).toBe(401);
  });

  it('scans an image using the configured Trivy image and returns the result', async () => {
    const { agent } = await createAdminAgent(app);
    const fakeResult = {
      image: 'nginx:alpine',
      scannedAt: '2026-01-01T00:00:00.000Z',
      counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
      vulnerabilities: [],
    };
    vi.mocked(scanImage).mockResolvedValue(fakeResult);

    const res = await agent.post('/api/trivy/scan').send({ image: 'nginx:alpine' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeResult);
    expect(scanImage).toHaveBeenCalledWith('nginx:alpine', 'aquasec/trivy:latest');
  });

  it('returns 403 when the vulnerabilityScanner feature flag is disabled', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.put('/api/settings').send({ featureFlags: { vulnerabilityScanner: false } });

    const res = await agent.post('/api/trivy/scan').send({ image: 'nginx:alpine' });
    expect(res.status).toBe(403);
    expect(scanImage).not.toHaveBeenCalled();
  });

  it('returns 502 with the failure message when the scan throws', async () => {
    const { agent } = await createAdminAgent(app);
    vi.mocked(scanImage).mockRejectedValue(new Error('trivy exploded'));

    const res = await agent.post('/api/trivy/scan').send({ image: 'nginx:alpine' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('trivy exploded');
  });

  it('rejects an empty image reference', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/trivy/scan').send({ image: '' });
    expect(res.status).toBe(400);
  });

  it('rejects an image reference starting with "-" (CLI argument injection)', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/trivy/scan').send({ image: '--server=http://evil.example' });
    expect(res.status).toBe(400);
    expect(scanImage).not.toHaveBeenCalled();
  });

  it('is usable by a non-admin by default (useSecurityScanner defaults to on)', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    vi.mocked(scanImage).mockResolvedValue({
      image: 'nginx:alpine',
      scannedAt: '2026-01-01T00:00:00.000Z',
      counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
      vulnerabilities: [],
    });

    const res = await agent.post('/api/trivy/scan').send({ image: 'nginx:alpine' });
    expect(res.status).toBe(200);
  });

  it('returns a 403 for a non-admin whose useSecurityScanner permission was revoked', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      useSecurityScanner: false,
    });

    const res = await agent.post('/api/trivy/scan').send({ image: 'nginx:alpine' });
    expect(res.status).toBe(403);
    expect(scanImage).not.toHaveBeenCalled();
  });
});

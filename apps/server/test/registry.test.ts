import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRemoteDigest, parseImageReference } from '../src/registry.js';

describe('parseImageReference', () => {
  it('treats an unqualified name as a Docker Hub official image', () => {
    expect(parseImageReference('redis')).toEqual({
      registryHost: 'registry-1.docker.io',
      repository: 'library/redis',
      tag: 'latest',
    });
  });

  it('parses a tagged official image', () => {
    expect(parseImageReference('nginx:alpine')).toEqual({
      registryHost: 'registry-1.docker.io',
      repository: 'library/nginx',
      tag: 'alpine',
    });
  });

  it('parses a Docker Hub namespaced repository without adding a library/ prefix', () => {
    expect(parseImageReference('myuser/myapp:latest')).toEqual({
      registryHost: 'registry-1.docker.io',
      repository: 'myuser/myapp',
      tag: 'latest',
    });
  });

  it('recognizes a dotted host as a third-party registry', () => {
    expect(parseImageReference('ghcr.io/owner/repo:tag')).toEqual({
      registryHost: 'ghcr.io',
      repository: 'owner/repo',
      tag: 'tag',
    });
  });

  it('recognizes a host:port registry without mistaking the port colon for a tag separator', () => {
    expect(parseImageReference('localhost:5000/myrepo:tag')).toEqual({
      registryHost: 'localhost:5000',
      repository: 'myrepo',
      tag: 'tag',
    });
  });

  it('defaults to the "latest" tag for a host:port registry reference with no tag', () => {
    expect(parseImageReference('localhost:5000/myrepo')).toEqual({
      registryHost: 'localhost:5000',
      repository: 'myrepo',
      tag: 'latest',
    });
  });

  it('returns null for a digest-pinned reference — nothing to compare against', () => {
    expect(parseImageReference('nginx@sha256:abcdef0123456789')).toBeNull();
  });
});

describe('getRemoteDigest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeResponse(opts: { ok: boolean; status: number; headers?: Record<string, string>; body?: unknown }) {
    return {
      ok: opts.ok,
      status: opts.status,
      headers: { get: (name: string) => opts.headers?.[name.toLowerCase()] ?? null },
      json: async () => opts.body,
    };
  }

  it('returns the Docker-Content-Digest header on a direct 200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ ok: true, status: 200, headers: { 'docker-content-digest': 'sha256:abc123' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const digest = await getRemoteDigest('nginx:alpine');
    expect(digest).toBe('sha256:abc123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://registry-1.docker.io/v2/library/nginx/manifests/alpine'
    );
  });

  it('follows the WWW-Authenticate bearer-token challenge on a 401', async () => {
    const challengeResponse = fakeResponse({
      ok: false,
      status: 401,
      headers: {
        'www-authenticate':
          'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"',
      },
    });
    const tokenResponse = fakeResponse({ ok: true, status: 200, body: { token: 'the-token' } });
    const authedManifestResponse = fakeResponse({
      ok: true,
      status: 200,
      headers: { 'docker-content-digest': 'sha256:def456' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(authedManifestResponse);
    vi.stubGlobal('fetch', fetchMock);

    const digest = await getRemoteDigest('nginx:alpine');
    expect(digest).toBe('sha256:def456');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenUrl = fetchMock.mock.calls[1][0] as URL;
    expect(tokenUrl.toString()).toBe(
      'https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fnginx%3Apull'
    );
    const finalHeaders = fetchMock.mock.calls[2][1].headers;
    expect(finalHeaders.Authorization).toBe('Bearer the-token');
  });

  it('returns null when the registry responds with a non-ok status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getRemoteDigest('nginx:alpine')).toBeNull();
  });

  it('returns null for a digest-pinned reference without making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getRemoteDigest('nginx@sha256:abcdef0123456789')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

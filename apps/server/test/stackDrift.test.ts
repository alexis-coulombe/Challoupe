import { describe, expect, it } from 'vitest';
import type Dockerode from 'dockerode';
import { computeStackDrift } from '../src/stackDrift.js';

const COMPOSE = `services:
  web:
    image: nginx:alpine
  db:
    image: postgres:16
`;

function container(overrides: Partial<Dockerode.ContainerInfo>): Dockerode.ContainerInfo {
  return {
    Id: 'id',
    Names: ['/name'],
    Image: 'nginx:alpine',
    Labels: { 'com.docker.compose.project': 'myapp', 'com.docker.compose.service': 'web' },
    State: 'running',
    ...overrides,
  } as Dockerode.ContainerInfo;
}

describe('computeStackDrift', () => {
  it('reports in sync when every service has a matching, correctly-imaged container', () => {
    const containers = [
      container({ Names: ['/myapp-web-1'], Labels: { 'com.docker.compose.service': 'web' } }),
      container({
        Names: ['/myapp-db-1'],
        Image: 'postgres:16',
        Labels: { 'com.docker.compose.service': 'db' },
      }),
    ];
    const result = computeStackDrift(COMPOSE, containers);
    expect(result).toEqual({
      inSync: true,
      missingServices: [],
      orphanedContainers: [],
      imageMismatches: [],
    });
  });

  it('flags a service with no running-or-stopped container as missing', () => {
    const containers = [container({ Names: ['/myapp-web-1'], Labels: { 'com.docker.compose.service': 'web' } })];
    const result = computeStackDrift(COMPOSE, containers);
    expect(result.inSync).toBe(false);
    expect(result.missingServices).toEqual(['db']);
  });

  it('flags a container whose service no longer exists in the compose file as orphaned', () => {
    const containers = [
      container({ Names: ['/myapp-web-1'], Labels: { 'com.docker.compose.service': 'web' } }),
      container({
        Names: ['/myapp-db-1'],
        Image: 'postgres:16',
        Labels: { 'com.docker.compose.service': 'db' },
      }),
      container({
        Id: 'old-id',
        Names: ['/myapp-cache-1'],
        Image: 'redis:7',
        Labels: { 'com.docker.compose.service': 'cache' },
      }),
    ];
    const result = computeStackDrift(COMPOSE, containers);
    expect(result.inSync).toBe(false);
    expect(result.orphanedContainers).toEqual([{ id: 'old-id', name: 'myapp-cache-1', service: 'cache' }]);
  });

  it('flags a running image that no longer matches the compose file (tag bumped, not redeployed)', () => {
    const containers = [
      container({ Names: ['/myapp-web-1'], Image: 'nginx:1.25', Labels: { 'com.docker.compose.service': 'web' } }),
      container({
        Names: ['/myapp-db-1'],
        Image: 'postgres:16',
        Labels: { 'com.docker.compose.service': 'db' },
      }),
    ];
    const result = computeStackDrift(COMPOSE, containers);
    expect(result.inSync).toBe(false);
    expect(result.imageMismatches).toEqual([
      { service: 'web', expectedImage: 'nginx:alpine', actualImage: 'nginx:1.25' },
    ]);
  });

  it('does not flag a service built from a Dockerfile (no image: key) as a mismatch', () => {
    const compose = `services:\n  web:\n    build: .\n`;
    const containers = [
      container({ Names: ['/myapp-web-1'], Image: 'myapp-web', Labels: { 'com.docker.compose.service': 'web' } }),
    ];
    const result = computeStackDrift(compose, containers);
    expect(result.inSync).toBe(true);
  });

  it('ignores a container with no compose-service label entirely (not this project)', () => {
    const containers = [
      container({ Names: ['/myapp-web-1'], Labels: { 'com.docker.compose.service': 'web' } }),
      container({
        Names: ['/myapp-db-1'],
        Image: 'postgres:16',
        Labels: { 'com.docker.compose.service': 'db' },
      }),
      container({ Id: 'unrelated', Names: ['/unrelated'], Labels: {} }),
    ];
    const result = computeStackDrift(COMPOSE, containers);
    expect(result.inSync).toBe(false);
    expect(result.orphanedContainers).toEqual([{ id: 'unrelated', name: 'unrelated', service: null }]);
  });
});

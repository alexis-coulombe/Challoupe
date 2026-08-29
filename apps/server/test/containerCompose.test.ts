import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import type Docker from 'dockerode';
import { composeName, containerToCompose } from '../src/containerCompose.js';

function inspect(overrides: Record<string, unknown> = {}): Docker.ContainerInspectInfo {
  return {
    Id: 'abc123',
    Name: '/web',
    Image: 'sha256:deadbeef',
    Config: {
      Image: 'nginx:alpine',
      Env: ['PATH=/usr/bin', 'TZ=UTC'],
      Cmd: ['nginx', '-g', 'daemon off;'],
      Entrypoint: undefined,
      Labels: {},
      User: '',
      WorkingDir: '',
    },
    HostConfig: {
      PortBindings: {},
      RestartPolicy: { Name: 'no' },
      NetworkMode: 'bridge',
    },
    NetworkSettings: { Networks: { bridge: {} } },
    Mounts: [],
    ...overrides,
  } as unknown as Docker.ContainerInspectInfo;
}

function image(overrides: Record<string, unknown> = {}): Docker.ImageInspectInfo {
  return {
    Config: { Env: ['PATH=/usr/bin'], Cmd: ['nginx', '-g', 'daemon off;'], Labels: {}, WorkingDir: '' },
    ...overrides,
  } as unknown as Docker.ImageInspectInfo;
}

function parse(inspectArg: Docker.ContainerInspectInfo, imageArg?: Docker.ImageInspectInfo) {
  const { name, compose } = containerToCompose(inspectArg, imageArg);
  return { name, doc: YAML.parse(compose) as { services: Record<string, any>; volumes?: any; networks?: any } };
}

describe('composeName', () => {
  it('slugifies a container name into a compose-safe key', () => {
    expect(composeName('/My_App.1')).toBe('my_app-1');
    expect(composeName('/@@@')).toBe('app');
  });
});

describe('containerToCompose', () => {
  it('emits image and container_name, keyed by the slugified name', () => {
    const { name, doc } = parse(inspect({ Name: '/My-Web' }), image());
    expect(name).toBe('my-web');
    expect(doc.services['my-web'].image).toBe('nginx:alpine');
    expect(doc.services['my-web'].container_name).toBe('My-Web');
  });

  it('drops env vars and the command the image already bakes in', () => {
    const { doc } = parse(inspect(), image());
    const svc = doc.services.web;
    expect(svc.environment).toEqual(['TZ=UTC']);
    expect(svc.command).toBeUndefined();
  });

  it('keeps a command that overrides the image default', () => {
    const { doc } = parse(inspect({ Config: { ...inspect().Config, Cmd: ['sleep', 'infinity'] } }), image());
    expect(doc.services.web.command).toEqual(['sleep', 'infinity']);
  });

  it('translates published ports, preserving a bound host IP and a non-tcp protocol', () => {
    const { doc } = parse(
      inspect({
        HostConfig: {
          ...inspect().HostConfig,
          PortBindings: {
            '80/tcp': [{ HostIp: '', HostPort: '8080' }],
            '53/udp': [{ HostIp: '127.0.0.1', HostPort: '53' }],
          },
        },
      }),
      image()
    );
    expect(doc.services.web.ports).toEqual(['8080:80', '127.0.0.1:53:53/udp']);
  });

  it('translates bind and named volumes, marks named ones external, and skips anonymous ones', () => {
    const anon = 'a'.repeat(64);
    const { doc } = parse(
      inspect({
        Mounts: [
          { Type: 'bind', Source: '/srv/data', Destination: '/data', RW: true },
          { Type: 'bind', Source: '/etc/conf', Destination: '/conf', RW: false },
          { Type: 'volume', Name: 'pgdata', Destination: '/var/lib/postgresql/data', RW: true },
          { Type: 'volume', Name: anon, Destination: '/cache', RW: true },
        ],
      }),
      image()
    );
    expect(doc.services.web.volumes).toEqual([
      '/srv/data:/data',
      '/etc/conf:/conf:ro',
      'pgdata:/var/lib/postgresql/data',
      '/cache',
    ]);
    expect(doc.volumes).toEqual({ pgdata: { external: true } });
  });

  it('carries the restart policy across, with its retry count', () => {
    expect(parse(inspect({ HostConfig: { ...inspect().HostConfig, RestartPolicy: { Name: 'unless-stopped' } } }), image()).doc.services.web.restart).toBe('unless-stopped');
    expect(
      parse(
        inspect({ HostConfig: { ...inspect().HostConfig, RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 } } }),
        image()
      ).doc.services.web.restart
    ).toBe('on-failure:5');
  });

  it('keeps labels the image did not set and drops compose bookkeeping labels', () => {
    const { doc } = parse(
      inspect({
        Config: {
          ...inspect().Config,
          Labels: {
            'com.docker.compose.project': 'old',
            'maintained.by': 'me',
            'org.opencontainers.image.source': 'from-image',
          },
        },
      }),
      image({ Config: { ...image().Config, Labels: { 'org.opencontainers.image.source': 'from-image' } } })
    );
    expect(doc.services.web.labels).toEqual({ 'maintained.by': 'me' });
  });

  it('uses network_mode for host networking', () => {
    const { doc } = parse(
      inspect({ HostConfig: { ...inspect().HostConfig, NetworkMode: 'host' }, NetworkSettings: { Networks: { host: {} } } }),
      image()
    );
    expect(doc.services.web.network_mode).toBe('host');
  });

  it('lists a custom network and declares it external at the top level', () => {
    const { doc } = parse(
      inspect({
        HostConfig: { ...inspect().HostConfig, NetworkMode: 'proxy' },
        NetworkSettings: { Networks: { proxy: {} } },
      }),
      image()
    );
    expect(doc.services.web.networks).toEqual(['proxy']);
    expect(doc.networks).toEqual({ proxy: { external: true } });
  });

  it('translates privileged mode, capabilities and resource limits', () => {
    const { doc } = parse(
      inspect({
        HostConfig: {
          ...inspect().HostConfig,
          Privileged: true,
          CapAdd: ['NET_ADMIN'],
          CapDrop: ['MKNOD'],
          Memory: 512 * 1024 * 1024,
          NanoCpus: 1_500_000_000,
        },
      }),
      image()
    );
    const svc = doc.services.web;
    expect(svc.privileged).toBe(true);
    expect(svc.cap_add).toEqual(['NET_ADMIN']);
    expect(svc.cap_drop).toEqual(['MKNOD']);
    expect(svc.mem_limit).toBe('512m');
    expect(svc.cpus).toBe(1.5);
  });

  it('falls back to a raw translation when no image inspect is supplied', () => {
    const { doc } = parse(inspect());
    // Without the image to diff against, the baked-in command is kept but PATH is still dropped.
    expect(doc.services.web.command).toEqual(['nginx', '-g', 'daemon off;']);
    expect(doc.services.web.environment).toEqual(['TZ=UTC']);
  });
});

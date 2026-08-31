import YAML from 'yaml';
import type Docker from 'dockerode';

type Inspect = Docker.ContainerInspectInfo;
type Image = Docker.ImageInspectInfo;

// Networks Docker maintains itself; never emitted as external stack networks.
const BUILT_IN_NETWORKS = new Set(['bridge', 'host', 'none']);

// Docker names anonymous volumes with a 64-char hex id; those can't be referenced
// meaningfully from a compose file, so they're written as anonymous mounts instead.
const ANONYMOUS_VOLUME_RE = /^[0-9a-f]{64}$/;

/**
 * Derives a compose-safe service/stack name from a container name
 * ("/My_App.1" -> "my_app-1"). Falls back to "app" if nothing survives.
 */
export function composeName(containerName: string): string {
  const slug = containerName
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return slug || 'app';
}

function toArray(value: string | string[] | undefined): string[] | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value : [value];
}

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function humanBytes(bytes: number): string {
  const gb = bytes / 2 ** 30;
  if (Number.isInteger(gb)) return `${gb}g`;
  const mb = bytes / 2 ** 20;
  if (Number.isInteger(mb)) return `${mb}m`;
  return String(bytes);
}

function portList(inspect: Inspect): string[] {
  const bindings = (inspect.HostConfig?.PortBindings ?? {}) as Record<
    string,
    Array<{ HostIp?: string; HostPort?: string }> | null
  >;
  const ports: string[] = [];
  for (const [key, binds] of Object.entries(bindings)) {
    if (!binds?.length) continue;
    const [containerPort, proto] = key.split('/');
    for (const bind of binds) {
      const host = bind.HostPort || containerPort;
      const ip =
        bind.HostIp && bind.HostIp !== '0.0.0.0' && bind.HostIp !== '::' ? `${bind.HostIp}:` : '';
      const protoSuffix = proto && proto !== 'tcp' ? `/${proto}` : '';
      ports.push(`${ip}${host}:${containerPort}${protoSuffix}`);
    }
  }
  return ports;
}

function volumeList(inspect: Inspect): string[] {
  const volumes: string[] = [];
  for (const mount of inspect.Mounts ?? []) {
    const ro = mount.RW ? '' : ':ro';
    if (mount.Type === 'bind') {
      volumes.push(`${mount.Source}:${mount.Destination}${ro}`);
    } else if (mount.Type === 'volume' && mount.Name) {
      if (ANONYMOUS_VOLUME_RE.test(mount.Name)) {
        volumes.push(mount.Destination);
      } else {
        volumes.push(`${mount.Name}:${mount.Destination}${ro}`);
      }
    }
  }
  return volumes;
}

function namedVolumes(inspect: Inspect): string[] {
  return (inspect.Mounts ?? [])
    .filter((m) => m.Type === 'volume' && m.Name && !ANONYMOUS_VOLUME_RE.test(m.Name))
    .map((m) => m.Name as string);
}

function restart(inspect: Inspect): string | undefined {
  const policy = inspect.HostConfig?.RestartPolicy;
  if (!policy?.Name || policy.Name === 'no') return undefined;
  if (policy.Name === 'on-failure' && policy.MaximumRetryCount) {
    return `on-failure:${policy.MaximumRetryCount}`;
  }
  return policy.Name;
}

function environment(inspect: Inspect, image?: Image): string[] {
  const fromImage = new Set(image?.Config?.Env ?? []);
  return (inspect.Config?.Env ?? []).filter(
    (entry) => !fromImage.has(entry) && !entry.startsWith('PATH=')
  );
}

function labels(inspect: Inspect, image?: Image): Record<string, string> {
  const fromImage = image?.Config?.Labels ?? {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(inspect.Config?.Labels ?? {})) {
    // Compose re-adds its own project/service bookkeeping labels on deploy.
    if (key.startsWith('com.docker.compose.')) continue;
    if (fromImage[key] === value) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Best-effort translation of a container's inspect output into a single-service
 * docker-compose.yml. `image` (the container's image inspect, when still
 * available) is used to drop settings the image already bakes in, so the file
 * stays readable rather than echoing every inherited env var and command.
 */
export function containerToCompose(inspect: Inspect, image?: Image): { name: string; compose: string } {
  const containerName = inspect.Name?.replace(/^\//, '') || composeName(inspect.Name ?? '');
  const name = composeName(inspect.Name ?? '');
  const service: Record<string, unknown> = { image: inspect.Config?.Image ?? inspect.Image };
  service.container_name = containerName;

  const entrypoint = toArray(inspect.Config?.Entrypoint);
  if (entrypoint && !sameList(entrypoint, toArray(image?.Config?.Entrypoint))) {
    service.entrypoint = entrypoint;
  }

  const command = inspect.Config?.Cmd ?? undefined;
  if (command?.length && !sameList(command, image?.Config?.Cmd)) {
    service.command = command;
  }

  if (inspect.Config?.User) service.user = inspect.Config.User;

  const workingDir = inspect.Config?.WorkingDir;
  if (workingDir && workingDir !== (image?.Config?.WorkingDir ?? '')) {
    service.working_dir = workingDir;
  }

  const env = environment(inspect, image);
  if (env.length) service.environment = env;

  const ports = portList(inspect);
  if (ports.length) service.ports = ports;

  const volumes = volumeList(inspect);
  if (volumes.length) service.volumes = volumes;

  const mode = inspect.HostConfig?.NetworkMode;
  const customNetworks = Object.keys(inspect.NetworkSettings?.Networks ?? {}).filter(
    (n) => !BUILT_IN_NETWORKS.has(n)
  );
  let topLevelNetworks: Record<string, unknown> | undefined;
  if (mode === 'host' || mode === 'none') {
    service.network_mode = mode;
  } else if (customNetworks.length) {
    service.networks = customNetworks;
    topLevelNetworks = Object.fromEntries(customNetworks.map((n) => [n, { external: true }]));
  }

  const serviceLabels = labels(inspect, image);
  if (Object.keys(serviceLabels).length) service.labels = serviceLabels;

  if (inspect.HostConfig?.Privileged) service.privileged = true;

  const capAdd = (inspect.HostConfig?.CapAdd ?? undefined) as string[] | undefined;
  if (capAdd?.length) service.cap_add = capAdd;
  const capDrop = (inspect.HostConfig?.CapDrop ?? undefined) as string[] | undefined;
  if (capDrop?.length) service.cap_drop = capDrop;

  if (inspect.HostConfig?.Memory) service.mem_limit = humanBytes(inspect.HostConfig.Memory);
  if (inspect.HostConfig?.NanoCpus) {
    service.cpus = Math.round((inspect.HostConfig.NanoCpus / 1e9) * 1000) / 1000;
  }

  const restartValue = restart(inspect);
  if (restartValue) service.restart = restartValue;

  const compose: Record<string, unknown> = { services: { [name]: service } };
  const stackVolumes = namedVolumes(inspect);
  if (stackVolumes.length) {
    compose.volumes = Object.fromEntries(stackVolumes.map((v) => [v, { external: true }]));
  }
  if (topLevelNetworks) compose.networks = topLevelNetworks;

  const header =
    `# Generated by Challoupe from container "${containerName}".\n` +
    `# Review before deploying: bind-mount paths, secrets in environment, and any\n` +
    `# external volumes/networks are carried straight over. Deploying reuses the\n` +
    `# original container_name, so remove the source container first if it still exists.\n`;

  return { name, compose: header + YAML.stringify(compose, { lineWidth: 0 }) };
}

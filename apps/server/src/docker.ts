import Docker from 'dockerode';
import { DOCKER_SOCK } from './config.js';

export const docker = new Docker({ socketPath: DOCKER_SOCK });

export async function pullImage(reference: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.pull(reference, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err2: Error | null) =>
        err2 ? reject(err2) : resolve()
      );
    });
  });
}

export interface BuildFromGitOptions {
  ref?: string;
  subdir?: string;
  dockerfile?: string;
  buildArgs?: Record<string, string>;
}

export interface BuildFromGitResult {
  log: string;
  error?: string;
}

// Docker's git-context URL fragment is `#ref:subdir`, where either half may be omitted —
// `#:subdir` means "default branch, this subdirectory"; `#ref` alone means "repo root".
export function buildGitRemote(repoUrl: string, opts: Pick<BuildFromGitOptions, 'ref' | 'subdir'> = {}): string {
  if (!opts.ref && !opts.subdir) return repoUrl;
  return `${repoUrl}#${opts.ref ?? ''}${opts.subdir ? `:${opts.subdir}` : ''}`;
}

// Delegates the actual git clone entirely to the Docker daemon via the Engine API's
// `remote` build parameter (the same mechanism `docker build <git-url>` itself uses) —
// Challoupe never runs `git` itself. This means the *daemon's* host needs `git` available,
// and a private repo is only reachable by embedding credentials in the URL
// (https://<token>@host/user/repo.git), same as the plain Docker CLI.
//
// A build can fail two different ways at the Engine API level: some errors (an invalid
// git ref, a missing Dockerfile) come back as an immediate non-200 response before any
// streaming starts; others (a failing RUN step) let the stream complete normally with an
// `error` field on the last event. Both are folded into the same `{ log, error }` shape
// here — this function never rejects — so callers don't need to special-case which kind
// of failure they got.
export async function buildImageFromGit(
  repoUrl: string,
  tag: string,
  opts: BuildFromGitOptions = {}
): Promise<BuildFromGitResult> {
  const remote = buildGitRemote(repoUrl, opts);

  let stream: NodeJS.ReadableStream;
  try {
    stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      docker.buildImage(
        null as unknown as NodeJS.ReadableStream,
        {
          remote,
          t: tag,
          dockerfile: opts.dockerfile || undefined,
          buildargs: opts.buildArgs,
        },
        (err: Error | null, result?: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          resolve(result as NodeJS.ReadableStream);
        }
      );
    });
  } catch (err) {
    return { log: '', error: (err as Error).message };
  }

  // A pathological (or just very chatty) build shouldn't be able to grow server memory
  // without limit — this is well past what any real build log needs, just a backstop.
  const MAX_LOG_BYTES = 10 * 1024 * 1024;
  let log = '';
  let buildError: string | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null) => (err ? reject(err) : resolve()),
        (event: { stream?: string; error?: string }) => {
          if (event.stream && log.length < MAX_LOG_BYTES) log += event.stream;
          if (event.error) buildError = event.error;
        }
      );
    });
  } catch (err) {
    return { log, error: (err as Error).message };
  }
  return { log, error: buildError };
}

// Docker logs without a TTY are multiplexed in frames with an 8-byte header.
export function demuxLogs(buffer: Buffer): string {
  let out = '';
  let i = 0;
  while (i + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(i + 4);
    out += buffer.subarray(i + 8, i + 8 + size).toString('utf8');
    i += 8 + size;
  }
  return out;
}

// Stateful version of demuxLogs for a live stream, where a chunk boundary can
// land in the middle of a frame's header or body: incomplete frames are held
// back and completed by a later push().
export function createLogDemuxer() {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  return {
    push(chunk: Buffer): string {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      let out = '';
      let offset = 0;
      while (offset + 8 <= buffer.length) {
        const size = buffer.readUInt32BE(offset + 4);
        if (offset + 8 + size > buffer.length) break;
        out += buffer.subarray(offset + 8, offset + 8 + size).toString('utf8');
        offset += 8 + size;
      }
      buffer = buffer.subarray(offset);
      return out;
    },
  };
}

export interface StatsSample {
  timestamp: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
}

interface RawCpuUsage {
  total_usage: number;
  percpu_usage?: number[];
}

interface RawStats {
  read: string;
  cpu_stats: { cpu_usage: RawCpuUsage; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: RawCpuUsage; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: { cache?: number; inactive_file?: number } };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
}

// Same CPU-percent formula the `docker stats` CLI itself uses.
export function summarizeStats(raw: RawStats): StatsSample {
  const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
  const systemDelta = (raw.cpu_stats.system_cpu_usage ?? 0) - (raw.precpu_stats.system_cpu_usage ?? 0);
  const onlineCpus = raw.cpu_stats.online_cpus || raw.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const cpuPercent =
    systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

  const memUsage = raw.memory_stats?.usage ?? 0;
  // Docker's raw "usage" includes page cache; subtract it for a more accurate working-set figure.
  const cache = raw.memory_stats?.stats?.cache ?? raw.memory_stats?.stats?.inactive_file ?? 0;
  const memoryUsage = Math.max(0, memUsage - cache);
  const memoryLimit = raw.memory_stats?.limit ?? 0;
  const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

  let networkRx = 0;
  let networkTx = 0;
  for (const iface of Object.values(raw.networks ?? {})) {
    networkRx += iface.rx_bytes ?? 0;
    networkTx += iface.tx_bytes ?? 0;
  }

  return {
    timestamp: raw.read,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryUsage,
    memoryLimit,
    memoryPercent: Math.round(memoryPercent * 10) / 10,
    networkRx,
    networkTx,
  };
}

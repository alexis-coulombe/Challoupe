import { docker, summarizeStats, type RawStats } from './docker.js';
import { cpuUsagePercent, diskUsage, ramUsage } from './hostStats.js';
import { hostManager } from './hostManager.js';
import { allHostIds } from './hosts.js';
import { settingsService, type ResourceAlertSettings } from './settings.js';
import { notificationService } from './integrations/notifications/notifications.js';

export interface HostSample {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
}

export interface ContainerSample {
  id: string;
  name: string;
  cpuPercent: number;
  memoryPercent: number;
}

export interface ResourceFinding {
  signature: string;
  message: string;
}

/**
 * Plain threshold comparison against already-sampled host/container usage, no AI involved.
 */
export function detectResourceAlerts(
  host: HostSample,
  containers: ContainerSample[],
  thresholds: ResourceAlertSettings
): ResourceFinding[] {
  const findings: ResourceFinding[] = [];
  if (host.cpuPercent >= thresholds.hostCpuPercent) {
    findings.push({
      signature: 'host:cpu',
      message: `Host CPU usage at ${host.cpuPercent}% (threshold ${thresholds.hostCpuPercent}%)`,
    });
  }
  if (host.memoryPercent >= thresholds.hostMemoryPercent) {
    findings.push({
      signature: 'host:memory',
      message: `Host memory usage at ${host.memoryPercent}% (threshold ${thresholds.hostMemoryPercent}%)`,
    });
  }
  if (host.diskPercent >= thresholds.hostDiskPercent) {
    findings.push({
      signature: 'host:disk',
      message: `Host disk usage at ${host.diskPercent}% (threshold ${thresholds.hostDiskPercent}%)`,
    });
  }
  for (const c of containers) {
    if (c.cpuPercent >= thresholds.containerCpuPercent) {
      findings.push({
        signature: `container:${c.id}:cpu`,
        message: `Container "${c.name}" CPU usage at ${c.cpuPercent}% (threshold ${thresholds.containerCpuPercent}%)`,
      });
    }
    if (c.memoryPercent >= thresholds.containerMemoryPercent) {
      findings.push({
        signature: `container:${c.id}:memory`,
        message: `Container "${c.name}" memory usage at ${c.memoryPercent}% (threshold ${thresholds.containerMemoryPercent}%)`,
      });
    }
  }
  return findings;
}

// Mirrors the audit watchdog's dedup window: a sustained overload sends one notification
// per hour rather than one per scheduler tick.
const ALERT_NOTIFY_COOLDOWN_MS = 60 * 60 * 1000;

export class ResourceWatchdogService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastNotifiedAt = new Map<string, number>();

  // Reads Challoupe's own machine via os/fs (hostStats.ts) — categorically local-only, since a
  // remote host's CPU/RAM/disk aren't reachable through the SSH-tunneled Docker Engine API.
  private async sampleHost(): Promise<HostSample> {
    const [info, cpuPercent] = await Promise.all([docker.info(), cpuUsagePercent()]);
    const ram = ramUsage();
    const disk = await diskUsage(info.DockerRootDir as string).catch(() => ({
      total: 0,
      used: 0,
      percent: 0,
    }));
    return { cpuPercent, memoryPercent: ram.percent, diskPercent: disk.percent };
  }

  // Container-level checks generalize across every registered host — unlike sampleHost() above,
  // this is a plain Engine-API call that rides the same SSH-tunneled client as everything else.
  private async sampleContainers(hostId: string): Promise<ContainerSample[]> {
    const client = await hostManager.getClient(hostId);
    if (!client) return [];
    const list = await client.listContainers({ filters: { status: ['running'] } });
    const samples = await Promise.all(
      list.map(async (c): Promise<ContainerSample | null> => {
        try {
          const raw = (await client.getContainer(c.Id).stats({ stream: false })) as RawStats;
          const stats = summarizeStats(raw);
          return {
            id: c.Id,
            name: (c.Names[0] ?? '').replace(/^\//, ''),
            cpuPercent: stats.cpuPercent,
            memoryPercent: stats.memoryPercent,
          };
        } catch {
          return null;
        }
      })
    );
    return samples.filter((s): s is ContainerSample => s !== null);
  }

  async checkNow(): Promise<void> {
    const { resourceAlerts } = settingsService.get();
    if (!resourceAlerts.enabled) return;

    const now = Date.now();
    const [host, containerLists] = await Promise.all([
      this.sampleHost(),
      Promise.all(allHostIds().map((hostId) => this.sampleContainers(hostId))),
    ]);
    const containers = containerLists.flat();
    const fresh = detectResourceAlerts(host, containers, resourceAlerts).filter((f) => {
      const last = this.lastNotifiedAt.get(f.signature);
      return last === undefined || now - last >= ALERT_NOTIFY_COOLDOWN_MS;
    });
    if (fresh.length === 0) return;

    for (const f of fresh) this.lastNotifiedAt.set(f.signature, now);
    await notificationService.notifyResourceThreshold(fresh.map((f) => f.message).join('; '));
  }

  restartScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const { resourceAlerts } = settingsService.get();
    if (!resourceAlerts.enabled) return;
    this.timer = setInterval(() => void this.checkNow(), resourceAlerts.checkIntervalMinutes * 60_000);
    this.timer.unref?.();
  }
}

export const resourceWatchdogService = new ResourceWatchdogService();

import os from 'node:os';
import fs from 'node:fs/promises';

export interface RamUsage {
  total: number;
  used: number;
  percent: number;
}

export function ramUsage(): RamUsage {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return { total, used, percent: total === 0 ? 0 : Math.round((used / total) * 1000) / 10 };
}

/**
 * Approximates instantaneous CPU usage by comparing tick counters across a short sample window.
 * @param sampleMs number
 * @returns number
 */
export function cpuUsagePercent(sampleMs = 100): Promise<number> {
  const start = os.cpus();
  return new Promise((resolve) => {
    setTimeout(() => {
      const end = os.cpus();
      let idleDiff = 0;
      let totalDiff = 0;
      for (let i = 0; i < start.length; i++) {
        const s = start[i].times;
        const e = end[i].times;
        const idle = e.idle - s.idle;
        const total = e.user - s.user + (e.nice - s.nice) + (e.sys - s.sys) + (e.irq - s.irq) + idle;
        idleDiff += idle;
        totalDiff += total;
      }
      resolve(totalDiff === 0 ? 0 : Math.round((1 - idleDiff / totalDiff) * 1000) / 10);
    }, sampleMs);
  });
}

export interface DiskUsage {
  total: number;
  used: number;
  percent: number;
}

/**
 * Disk usage of the filesystem backing the given path (e.g. Docker's data root).
 * @param path string
 * @returns DiskUsage
 */
export async function diskUsage(path: string): Promise<DiskUsage> {
  const stats = await fs.statfs(path);
  const total = stats.blocks * stats.bsize;
  const free = stats.bavail * stats.bsize;
  const used = total - free;
  return { total, used, percent: total === 0 ? 0 : Math.round((used / total) * 1000) / 10 };
}

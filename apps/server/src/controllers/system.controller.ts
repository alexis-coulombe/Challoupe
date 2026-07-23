import type { Request, Response } from 'express';
import { docker } from '../docker.js';
import { DATA_DIR, DOCKER_SOCK } from '../config.js';
import { cpuUsagePercent, diskUsage, ramUsage } from '../hostStats.js';

export class SystemController {
  info = async (_req: Request, res: Response): Promise<void> => {
    const [info, version, cpuPercent] = await Promise.all([
      docker.info(),
      docker.version(),
      cpuUsagePercent(),
    ]);
    const ram = ramUsage();
    // Reading the Docker root's disk usage requires that path to exist in *this* process's
    // filesystem view. True on a bare-metal/host install, but not when Challoupe itself runs
    // containerized without also bind-mounting the host's Docker root dir in (see README).
    // Degrade to zeroed storage stats rather than failing the whole endpoint over one
    // non-critical stat.
    const disk = await diskUsage(info.DockerRootDir as string).catch(() => ({
      total: 0,
      used: 0,
      percent: 0,
    }));
    res.json({
      name: info.Name,
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      containersPaused: info.ContainersPaused,
      containersStopped: info.ContainersStopped,
      images: info.Images,
      serverVersion: version.Version,
      apiVersion: version.ApiVersion,
      os: info.OperatingSystem,
      kernel: info.KernelVersion,
      arch: info.Architecture,
      cpus: info.NCPU,
      memory: info.MemTotal,
      cpuPercent,
      memoryUsed: ram.used,
      memoryPercent: ram.percent,
      storageUsed: disk.used,
      storageTotal: disk.total,
      storagePercent: disk.percent,
      dockerSock: DOCKER_SOCK,
      dataDir: DATA_DIR,
    });
  };
}

export const systemController = new SystemController();

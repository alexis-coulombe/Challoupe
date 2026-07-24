import type { Request, Response } from 'express';
import { DATA_DIR, DOCKER_SOCK } from '../config.js';
import { cpuUsagePercent, diskUsage, ramUsage } from '../hostStats.js';

export class SystemController {
  info = async (req: Request, res: Response): Promise<void> => {
    const [info, version] = await Promise.all([req.dockerClient!.info(), req.dockerClient!.version()]);

    const base = {
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
    };

    // Host-level CPU/memory/disk utilization comes from Challoupe's own OS via node:os/
    if (req.hostId !== 'local') {
      res.json({
        ...base,
        cpuPercent: null,
        memoryUsed: null,
        memoryPercent: null,
        storageUsed: null,
        storageTotal: null,
        storagePercent: null,
        dockerSock: null,
        dataDir: null,
      });
      return;
    }

    const cpuPercent = await cpuUsagePercent();
    const ram = ramUsage();

    const disk = await diskUsage(info.DockerRootDir as string).catch(() => ({
      total: 0,
      used: 0,
      percent: 0,
    }));
    res.json({
      ...base,
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

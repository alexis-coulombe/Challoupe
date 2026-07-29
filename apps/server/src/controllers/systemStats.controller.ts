import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { hostManager } from '../hostManager.js';
import { cpuUsagePercent, diskUsage, ramUsage } from '../hostStats.js';
import { systemStatsTokenRepository } from '../systemStatsToken.js';

const hostQuerySchema = z.object({ host: z.string().trim().min(1).default('local') });

export class SystemStatsController {
  getToken = (_req: Request, res: Response): void => {
    res.json(systemStatsTokenRepository.status());
  };

  /**
   * Generate new token
   * @param req Request
   * @param res Response
   */
  regenerateToken = (req: Request, res: Response): void => {
    const token = systemStatsTokenRepository.regenerate();
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'system-stats.token-regenerate',
      status: 'success',
      ip: req.ip,
    });
    res.json({ token });
  };

  /**
   * Revoke an existing token
   * @param req Request
   * @param res Response
   */
  revokeToken = (req: Request, res: Response): void => {
    systemStatsTokenRepository.revoke();
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'system-stats.token-revoke',
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };

  /**
   * Get system information endpoint
   * @param req Request<{ token: string }>
   * @param res Response
   * @returns void
   */
  fetch = async (req: Request<{ token: string }>, res: Response): Promise<void> => {
    if (!systemStatsTokenRepository.verify(req.params.token)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const { host } = hostQuerySchema.parse(req.query);
    const client = await hostManager.getClient(host);
    if (!client) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const [info, version] = await Promise.all([client.info(), client.version()]);
    const base = {
      host,
      serverVersion: version.Version,
      containersTotal: info.Containers,
      containersRunning: info.ContainersRunning,
      containersPaused: info.ContainersPaused,
      containersStopped: info.ContainersStopped,
      imagesTotal: info.Images,
      memoryTotal: info.MemTotal,
    };

    // Host-level CPU/memory/disk utilization comes from Challoupe's own OS,
    // It can't reach through the SSH-tunneled Engine API to a remote host's OS.
    if (host !== 'local') {
      res.json({
        ...base,
        cpuPercent: null,
        memoryUsed: null,
        memoryPercent: null,
        storageUsed: null,
        storageTotal: null,
        storagePercent: null,
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
    });
  };
}

export const systemStatsController = new SystemStatsController();

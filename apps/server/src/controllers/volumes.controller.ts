import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { docker } from '../docker.js';
import { DOCKER_NAME_RE } from '../validators.js';

const createSchema = z.object({
  name: z.string().regex(DOCKER_NAME_RE),
  driver: z.string().default('local'),
});

export class VolumesController {
  list = async (_req: Request, res: Response): Promise<void> => {
    const { Volumes } = await docker.listVolumes();
    res.json(
      (Volumes ?? []).map((v) => ({
        name: v.Name,
        driver: v.Driver,
        mountpoint: v.Mountpoint,
        created: (v as { CreatedAt?: string }).CreatedAt ?? null,
        labels: v.Labels ?? {},
      }))
    );
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = createSchema.parse(req.body);
    const volume = await docker.createVolume({ Name: body.name, Driver: body.driver });
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'volume.create',
      target: body.name,
      status: 'success',
      ip: req.ip,
    });
    res.status(201).json(volume);
  };

  remove = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    await docker.getVolume(req.params.name).remove({ force: req.query.force === 'true' });
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'volume.delete',
      target: req.params.name,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };

  prune = async (req: Request, res: Response): Promise<void> => {
    const result = await docker.pruneVolumes();
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'volume.prune',
      detail: `${result.SpaceReclaimed ?? 0} bytes reclaimed`,
      status: 'success',
      ip: req.ip,
    });
    res.json({ spaceReclaimed: result.SpaceReclaimed ?? 0 });
  };
}

export const volumesController = new VolumesController();

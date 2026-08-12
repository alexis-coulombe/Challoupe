import type { Request, Response } from 'express';
import { auditLog } from '../audit.js';
import { createSchema } from './schemas/volumes.schema.js';

class VolumesController {
  /**
   * List all volumes
   * @param req Request
   * @param res Response
   */
  list = async (req: Request, res: Response): Promise<void> => {
    const { Volumes } = await req.dockerClient!.listVolumes();

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

  /**
   * Create volume
   * @param req Request
   * @param res Response
   */
  create = async (req: Request, res: Response): Promise<void> => {
    const body = createSchema.parse(req.body);
    const volume = await req.dockerClient!.createVolume({
      Name: body.name,
      Driver: body.driver,
      DriverOpts: body.driverOpts,
    });
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

  /**
   * Remove volume
   * @param req Request<{ name: string }>
   * @param res Response
   */
  remove = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    await req.dockerClient!.getVolume(req.params.name).remove({ force: req.query.force === 'true' });
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

  /**
   * Prune volumes
   * @param req Request
   * @param res Response
   */
  prune = async (req: Request, res: Response): Promise<void> => {
    const result = await req.dockerClient!.pruneVolumes();
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

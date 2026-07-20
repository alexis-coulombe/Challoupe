import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth.js';
import { recordAudit } from '../audit.js';
import { docker } from '../docker.js';
import { DOCKER_NAME_RE } from '../validators.js';

const router = Router();

router.get('/', async (_req, res) => {
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
});

router.post('/', requirePermission('manageVolumes'), async (req, res) => {
  const body = z
    .object({
      name: z.string().regex(DOCKER_NAME_RE),
      driver: z.string().default('local'),
    })
    .parse(req.body);
  const volume = await docker.createVolume({ Name: body.name, Driver: body.driver });
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'volume.create',
    target: body.name,
    status: 'success',
    ip: req.ip,
  });
  res.status(201).json(volume);
});

router.delete<{ name: string }>('/:name', requirePermission('manageVolumes'), async (req, res) => {
  await docker.getVolume(req.params.name).remove({ force: req.query.force === 'true' });
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'volume.delete',
    target: req.params.name,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

router.post('/prune', requirePermission('manageVolumes'), async (req, res) => {
  const result = await docker.pruneVolumes();
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'volume.prune',
    detail: `${result.SpaceReclaimed ?? 0} bytes reclaimed`,
    status: 'success',
    ip: req.ip,
  });
  res.json({ spaceReclaimed: result.SpaceReclaimed ?? 0 });
});

export default router;

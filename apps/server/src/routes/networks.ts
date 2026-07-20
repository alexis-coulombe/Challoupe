import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth.js';
import { recordAudit } from '../audit.js';
import { docker } from '../docker.js';
import { DOCKER_NAME_RE } from '../validators.js';

const router = Router();

router.get('/', async (_req, res) => {
  const list = await docker.listNetworks();
  res.json(
    list.map((n) => ({
      id: n.Id,
      name: n.Name,
      driver: n.Driver,
      scope: n.Scope,
      internal: n.Internal,
      subnet: n.IPAM?.Config?.[0]?.Subnet ?? null,
    }))
  );
});

router.post('/', requirePermission('manageNetworks'), async (req, res) => {
  const body = z
    .object({
      name: z.string().regex(DOCKER_NAME_RE),
      driver: z.enum(['bridge', 'overlay', 'macvlan', 'ipvlan', 'host', 'none']).default('bridge'),
    })
    .parse(req.body);
  const network = await docker.createNetwork({ Name: body.name, Driver: body.driver });
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'network.create',
    target: body.name,
    status: 'success',
    ip: req.ip,
  });
  res.status(201).json({ id: network.id });
});

router.delete<{ id: string }>('/:id', requirePermission('manageNetworks'), async (req, res) => {
  await docker.getNetwork(req.params.id).remove();
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'network.delete',
    target: req.params.id,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

export default router;

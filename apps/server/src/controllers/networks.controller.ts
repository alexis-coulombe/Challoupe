import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { DOCKER_NAME_RE } from '../validators.js';

const createSchema = z.object({
  name: z.string().regex(DOCKER_NAME_RE),
  driver: z.enum(['bridge', 'overlay', 'macvlan', 'ipvlan', 'host', 'none']).default('bridge'),
});

export class NetworksController {
  list = async (req: Request, res: Response): Promise<void> => {
    const list = await req.dockerClient!.listNetworks();
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
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = createSchema.parse(req.body);
    const network = await req.dockerClient!.createNetwork({ Name: body.name, Driver: body.driver });
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'network.create',
      target: body.name,
      status: 'success',
      ip: req.ip,
    });
    res.status(201).json({ id: network.id });
  };

  remove = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await req.dockerClient!.getNetwork(req.params.id).remove();
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'network.delete',
      target: req.params.id,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };
}

export const networksController = new NetworksController();

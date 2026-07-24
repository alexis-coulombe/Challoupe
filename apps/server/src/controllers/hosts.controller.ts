import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { auditLog } from '../audit.js';
import { hostRepository } from '../hosts.js';
import { hostManager } from '../hostManager.js';
import { dockerEventBroadcaster } from '../dockerEvents.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sshHost: z.string().trim().min(1).max(255),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUsername: z.string().trim().min(1).max(100),
  sshPrivateKey: z.string().min(1).max(16_000),
  sshPassphrase: z.string().max(500).default(''),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    sshHost: z.string().trim().min(1).max(255),
    sshPort: z.number().int().min(1).max(65535),
    sshUsername: z.string().trim().min(1).max(100),
    sshPrivateKey: z.string().max(16_000),
    sshPassphrase: z.string().max(500),
  })
  .partial();

const testSchema = z.object({
  sshHost: z.string().trim().min(1).max(255),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUsername: z.string().trim().min(1).max(100),
  sshPrivateKey: z.string().min(1).max(16_000),
  sshPassphrase: z.string().max(500).default(''),
});

export class HostsController {
  list = (_req: Request, res: Response): void => {
    res.json(hostRepository.list());
  };

  create = (req: Request, res: Response): void => {
    const body = createSchema.parse(req.body);
    if (db.prepare('SELECT 1 FROM hosts WHERE name = ?').get(body.name)) {
      res.status(409).json({ error: 'A host with this name already exists' });
      return;
    }
    const host = hostRepository.create({ ...body, createdBy: req.user!.id });
    // Starts watching for crashes/OOM-kills on this host immediately, rather than waiting for
    // the next /ws/events subscriber to trigger a full allHostIds() sweep.
    dockerEventBroadcaster.startHost(String(host.id));
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'host.create',
      target: host.name,
      detail: `${body.sshUsername}@${body.sshHost}:${body.sshPort}`,
      status: 'success',
      ip: req.ip,
    });
    res.status(201).json(host);
  };

  update = (req: Request, res: Response): void => {
    const id = Number(req.params.id);
    const target = hostRepository.getSummary(id);
    if (!target) {
      res.status(404).json({ error: 'Host not found' });
      return;
    }
    const body = updateSchema.parse(req.body);
    if (body.name && body.name !== target.name && db.prepare('SELECT 1 FROM hosts WHERE name = ?').get(body.name)) {
      res.status(409).json({ error: 'A host with this name already exists' });
      return;
    }
    const updated = hostRepository.update(id, body);
    hostManager.invalidate(String(id));
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'host.update',
      target: target.name,
      status: 'success',
      ip: req.ip,
    });
    res.json(updated);
  };

  remove = (req: Request, res: Response): void => {
    const id = Number(req.params.id);
    const target = hostRepository.getSummary(id);
    if (!target) {
      res.status(404).json({ error: 'Host not found' });
      return;
    }
    hostRepository.remove(id);
    hostManager.invalidate(String(id));
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'host.delete',
      target: target.name,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };

  // Tests connection details before they've been saved (or re-tests an existing host's
  // stored credentials, via testExisting below) without ever caching the resulting client.
  test = async (req: Request, res: Response): Promise<void> => {
    const body = testSchema.parse(req.body);
    const result = await hostManager.testConnection(body);
    res.json(result);
  };

  testExisting = async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    const conn = hostRepository.getConnection(id);
    if (!conn) {
      res.status(404).json({ error: 'Host not found' });
      return;
    }
    const result = await hostManager.testConnection(conn);
    res.json(result);
  };
}

export const hostsController = new HostsController();

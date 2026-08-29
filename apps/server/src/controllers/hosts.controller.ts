import type { Request, Response } from 'express';
import { db } from '../db.js';
import { auditLog } from '../audit.js';
import { hostRepository } from '../hosts.js';
import { hostManager } from '../hostManager.js';
import { dockerEventBroadcaster } from '../dockerEvents.js';
import { createSchema, testSchema, updateSchema } from './schemas/hosts.schema.js';

class HostsController {
  /**
   * List all hosts
   * @param _req Request
   * @param res Response
   */
  list = (_req: Request, res: Response): void => {
    res.json(hostRepository.list());
  };

  /**
   * Create new SSH host
   * @param req Request
   * @param res Response
   * @returns 
   */
  create = (req: Request, res: Response): void => {
    const body = createSchema.parse(req.body);

    if (db.prepare('SELECT 1 FROM hosts WHERE name = ?').get(body.name)) {
      res.status(409).json({ error: 'A host with this name already exists' });
      return;
    }

    const host = hostRepository.create({ ...body, createdBy: req.user!.id });
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

  /**
   * Get host
   * @param req Request
   * @param res Response
   * @returns void
   */
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

  /**
   * Remove host
   * @param req Request
   * @param res Response
   * @returns void
   */
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

  /**
   * Tests connection details of host
   * @param req Request
   * @param res Response
   */
  test = async (req: Request, res: Response): Promise<void> => {
    const body = testSchema.parse(req.body);
    const result = await hostManager.testConnection(body);

    res.json(result);
  };

  /**
   * Tests connection of existing host
   * @param req Request
   * @param res Response
   */
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

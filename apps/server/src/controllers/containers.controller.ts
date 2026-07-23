import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { demuxLogs, docker, pullImage } from '../docker.js';
import { RESTART_POLICIES, settingsService } from '../settings.js';
import { imageUpdateService } from '../imageUpdates.js';
import { DOCKER_NAME_RE, KEY_VALUE_RE, parseKeyValueList } from '../validators.js';

const createSchema = z.object({
  name: z.string().regex(DOCKER_NAME_RE).optional(),
  image: z.string().min(1),
  network: z.string().regex(DOCKER_NAME_RE).optional(),
  command: z.array(z.string()).default([]),
  workingDir: z.string().max(255).optional(),
  user: z
    .string()
    .max(64)
    .regex(/^[a-zA-Z0-9_.:-]*$/)
    .optional(),
  labels: z.array(z.string().regex(KEY_VALUE_RE)).default([]),
  env: z.array(z.string().regex(KEY_VALUE_RE)).default([]),
  ports: z
    .array(
      z.object({
        host: z.number().int().min(1).max(65535),
        container: z.number().int().min(1).max(65535),
        protocol: z.enum(['tcp', 'udp']).default('tcp'),
      })
    )
    .default([]),
  volumes: z
    .array(z.object({ host: z.string().min(1), container: z.string().min(1) }))
    .default([]),
  restartPolicy: z.enum(RESTART_POLICIES).optional(),
  privileged: z.boolean().default(false),
  autoRemove: z.boolean().default(false),
  memoryMb: z.number().int().positive().max(1024 * 1024).optional(),
  cpus: z.number().positive().max(256).optional(),
});

const ACTIONS = ['start', 'stop', 'restart', 'kill', 'pause', 'unpause'] as const;
type ContainerAction = (typeof ACTIONS)[number];

export class ContainersController {
  list = async (_req: Request, res: Response): Promise<void> => {
    const list = await docker.listContainers({ all: true });
    res.json(
      list.map((c) => {
        const cached = imageUpdateService.getCachedStatus(c.Image);
        return {
          id: c.Id,
          name: (c.Names[0] ?? '').replace(/^\//, ''),
          image: c.Image,
          state: c.State,
          status: c.Status,
          created: c.Created,
          ports: c.Ports,
          composeProject: c.Labels['com.docker.compose.project'] ?? null,
          updateAvailable: cached?.updateAvailable ?? null,
        };
      })
    );
  };

  // Container creation can grant privileged mode and arbitrary host bind-mounts —
  // effectively root on the host via the Docker socket.
  create = async (req: Request, res: Response): Promise<void> => {
    const body = createSchema.parse(req.body);
    const settings = settingsService.get();
    const restartPolicy = body.restartPolicy ?? settings.defaultRestartPolicy;

    if (body.autoRemove && restartPolicy !== 'no') {
      res
        .status(400)
        .json({ error: "Auto-remove cannot be combined with a restart policy other than 'Never'" });
      return;
    }

    // Admins are never capped; a "user"-role account is bound by the configured quota
    // (when one is set) — a request over quota is rejected, and one left unset is
    // clamped to the quota so a quota can never be silently bypassed by omission.
    let memoryMb = body.memoryMb;
    let cpus = body.cpus;
    if (req.user!.role !== 'admin') {
      const { maxContainerMemoryMb, maxContainerCpus } = settings;
      if (maxContainerMemoryMb != null) {
        if (memoryMb != null && memoryMb > maxContainerMemoryMb) {
          res.status(400).json({ error: `Memory limit exceeds your quota of ${maxContainerMemoryMb} MB` });
          return;
        }
        memoryMb = memoryMb ?? maxContainerMemoryMb;
      }
      if (maxContainerCpus != null) {
        if (cpus != null && cpus > maxContainerCpus) {
          res.status(400).json({ error: `CPU limit exceeds your quota of ${maxContainerCpus} cores` });
          return;
        }
        cpus = cpus ?? maxContainerCpus;
      }
    }

    const exposedPorts: Record<string, object> = {};
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    for (const p of body.ports) {
      const key = `${p.container}/${p.protocol}`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: String(p.host) }];
    }

    const labels = parseKeyValueList(body.labels);

    const options = {
      name: body.name,
      Image: body.image,
      Cmd: body.command.length ? body.command : undefined,
      WorkingDir: body.workingDir || undefined,
      User: body.user || undefined,
      Labels: Object.keys(labels).length ? labels : undefined,
      Env: body.env,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Binds: body.volumes.map((v) => `${v.host}:${v.container}`),
        RestartPolicy: { Name: restartPolicy },
        Privileged: body.privileged,
        AutoRemove: body.autoRemove,
        Memory: memoryMb ? memoryMb * 1024 * 1024 : undefined,
        NanoCpus: cpus ? Math.round(cpus * 1e9) : undefined,
      },
      NetworkingConfig: body.network
        ? { EndpointsConfig: { [body.network]: {} } }
        : undefined,
    };

    let container;
    try {
      container = await docker.createContainer(options);
    } catch (err) {
      // Image not present locally: pull it and retry.
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
      await pullImage(body.image);
      container = await docker.createContainer(options);
    }
    await container.start();
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'container.create',
      target: body.name || container.id,
      detail: `image ${body.image}`,
      status: 'success',
      ip: req.ip,
    });
    res.status(201).json({ id: container.id });
  };

  getOne = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    res.json(await docker.getContainer(req.params.id).inspect());
  };

  logs = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const tail = Math.min(Number(req.query.tail) || 200, 5000);
    const container = docker.getContainer(req.params.id);
    const info = await container.inspect();
    const buf = (await container.logs({
      stdout: true,
      stderr: true,
      tail,
      follow: false,
    })) as unknown as Buffer;
    res.type('text/plain').send(info.Config.Tty ? buf.toString('utf8') : demuxLogs(buf));
  };

  action = async (req: Request<{ id: string; action: string }>, res: Response): Promise<void> => {
    const action = req.params.action as ContainerAction;
    if (!ACTIONS.includes(action)) {
      res.status(400).json({ error: `Unknown action: ${req.params.action}` });
      return;
    }
    const container = docker.getContainer(req.params.id);
    await (container[action] as () => Promise<unknown>)();
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: `container.${action}`,
      target: req.params.id,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };

  remove = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await docker.getContainer(req.params.id).remove({ force: req.query.force === 'true' });
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'container.delete',
      target: req.params.id,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };
}

export const containersController = new ContainersController();

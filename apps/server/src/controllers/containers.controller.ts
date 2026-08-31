import type { Request, Response } from 'express';
import type Docker from 'dockerode';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { containerToCompose } from '../containerCompose.js';
import { demuxLogs, pullImage } from '../docker.js';
import { settingsService } from '../settings.js';
import { imageUpdateService } from '../imageUpdates.js';
import { parseKeyValueList } from '../validators.js';
import { createSchema } from './schemas/containers.schema.js';

const ACTIONS = ['start', 'stop', 'restart', 'kill', 'pause', 'unpause'] as const;
type ContainerAction = (typeof ACTIONS)[number];

class ContainersController {
  /**
   * List all containers
   * @param req Request
   * @param res Response
   */
  list = async (req: Request, res: Response): Promise<void> => {
    const list = await req.dockerClient!.listContainers({ all: true });

    res.json(
      list.map((c) => {
        const cached = imageUpdateService.getCachedStatus(req.hostId!, c.Image);
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

  /**
   * Create container
   * @param req Request
   * @param res Response
   * @returns void
   */
  create = async (req: Request, res: Response): Promise<void> => {
    const body = createSchema.parse(req.body);
    const settings = settingsService.get();
    const restartPolicy = body.restartPolicy ?? settings.defaultRestartPolicy;

    if (body.autoRemove && restartPolicy !== 'no') {
      res.status(400).json({ error: "Auto-remove cannot be combined with a restart policy other than 'Never'" });
      return;
    }

    let memoryMb = body.memoryMb;
    let cpus = body.cpus;
    // Admins are never capped
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
      NetworkingConfig: body.network ? { EndpointsConfig: { [body.network]: {} } } : undefined,
    };

    let container;
    try {
      container = await req.dockerClient!.createContainer(options);
    } catch (err) {
      // Image not present locally: pull it and retry.
      if ((err as { statusCode?: number }).statusCode !== 404) {
        throw err;
      }

      await pullImage(req.dockerClient!, body.image);
      container = await req.dockerClient!.createContainer(options);
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

  /**
   * Get a container by id
   * @param req Request<{ id: string }>
   * @param res Response
   */
  getOne = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    res.json(await req.dockerClient!.getContainer(req.params.id).inspect());
  };

  /**
   * Translate a container into a single-service compose file the Stacks editor can pick up.
   * Read-only; the resulting stack still goes through the manageStacks-gated create endpoint.
   * @param req Request<{ id: string }>
   * @param res Response
   */
  compose = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const info = await req.dockerClient!.getContainer(req.params.id).inspect();
    let image: Docker.ImageInspectInfo | undefined;
    try {
      image = await req.dockerClient!.getImage(info.Config.Image).inspect();
    } catch {
      // Image removed or retagged out from under the container: fall back to a
      // straight translation without the image-diff cleanup.
    }
    res.json(containerToCompose(info, image));
  };

  /**
   * Get container logs
   * @param req Request<{ id: string }>
   * @param res Response
   */
  logs = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const tail = Math.min(Number(req.query.tail) || 200, 5000);
    const container = req.dockerClient!.getContainer(req.params.id);
    const info = await container.inspect();
    const buf = (await container.logs({
      stdout: true,
      stderr: true,
      tail,
      follow: false,
    })) as unknown as Buffer;

    res.type('text/plain').send(info.Config.Tty ? buf.toString('utf8') : demuxLogs(buf));
  };

  /**
   * Do action on the container
   * @param req Request<{ id: string; action: string }>
   * @param res Response
   * @returns void
   */
  action = async (req: Request<{ id: string; action: string }>, res: Response): Promise<void> => {
    const action = req.params.action as ContainerAction;

    if (!ACTIONS.includes(action)) {
      res.status(400).json({ error: `Unknown action: ${req.params.action}` });
      return;
    }

    const container = req.dockerClient!.getContainer(req.params.id);
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

  /**
   * Remove container
   * @param req Request<{ id: string }>
   * @param res Response
   */
  remove = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await req.dockerClient!.getContainer(req.params.id).remove({ force: req.query.force === 'true' });
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

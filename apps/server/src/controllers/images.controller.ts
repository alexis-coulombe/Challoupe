import type { Request, Response } from 'express';
import { auditLog } from '../audit.js';
import { buildImageFromGit, pullImage } from '../docker.js';
import { imageUpdateService } from '../imageUpdates.js';
import { parseKeyValueList } from '../validators.js';
import { buildFromGitSchema, checkUpdatesSchema, imageRefSchema, pullSchema } from './schemas/images.schema.js';

/**
 * Strips any embedded userinfo before a Git URL is written to the audit log
 * @param url string
 * @returns string
 */
function redactGitCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '';
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

class ImagesController {
  /**
   * List all images
   * @param req Request
   * @param res Response
   */
  list = async (req: Request, res: Response): Promise<void> => {
    const list = await req.dockerClient!.listImages();

    res.json(
      list.map((i) => {
        const tags = i.RepoTags?.filter((t) => t !== '<none>:<none>') ?? [];
        const cached = tags[0] ? imageUpdateService.getCachedStatus(req.hostId!, tags[0]) : undefined;
        return {
          id: i.Id,
          tags,
          size: i.Size,
          created: i.Created,
          containers: i.Containers,
          updateAvailable: cached?.updateAvailable ?? null,
          updateCheckedAt: cached?.checkedAt ?? null,
        };
      })
    );
  };

  
  /**
   * Check all images for upate
   * @param req Request
   * @param res Response
   */
  checkUpdates = async (req: Request, res: Response): Promise<void> => {
    const body = checkUpdatesSchema.parse(req.body ?? {});
    const result = await imageUpdateService.checkAll(req.hostId!, req.dockerClient!, body.ids);

    res.json(result);
  };

  /**
   * Check an image for update
   * @param req Request<{ id: string }>
   * @param res Response
   * @returns void
   */
  checkUpdate = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const info = await req.dockerClient!.getImage(req.params.id).inspect();
    const reference = info.RepoTags?.find((t) => t !== '<none>:<none>');

    if (!reference) {
      res.status(400).json({ error: 'This image has no tag to check against a registry' });
      return;
    }

    const status = await imageUpdateService.checkOne(req.hostId!, reference, info.RepoDigests);
    res.json({ reference, ...status });
  };

  /**
   * Builds an image from a Dockerfile hosted in a Git repository
   * @param req Request
   * @param res Response
   * @returns void
   */
  buildFromGit = async (req: Request, res: Response): Promise<void> => {
    const body = buildFromGitSchema.parse(req.body);
    const buildArgs = parseKeyValueList(body.buildArgs);

    const result = await buildImageFromGit(req.dockerClient!, body.repoUrl, body.tag, {
      ref: body.ref,
      subdir: body.subdir,
      dockerfile: body.dockerfile,
      buildArgs: Object.keys(buildArgs).length ? buildArgs : undefined,
    });

    if (result.error) {
      auditLog.record({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'image.build',
        target: body.tag,
        detail: result.error,
        status: 'failure',
        ip: req.ip,
      });

      res.json({ ok: false, tag: body.tag, log: result.log, error: result.error });
      return;
    }

    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'image.build',
      target: body.tag,
      detail: `from ${redactGitCredentials(body.repoUrl)}${body.ref ? `#${body.ref}` : ''}`,
      status: 'success',
      ip: req.ip,
    });

    res.json({ ok: true, tag: body.tag, log: result.log });
  };

  /**
   * Pull image from registry
   * @param req Request
   * @param res Response
   */
  pull = async (req: Request, res: Response): Promise<void> => {
    const body = pullSchema.parse(req.body);
    await pullImage(req.dockerClient!, body.reference);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'image.pull',
      target: body.reference,
      status: 'success',
      ip: req.ip,
    });

    res.json({ ok: true });
  };

  /**
   * Remove image
   * @param req Request
   * @param res Response
   */
  remove = async (req: Request, res: Response): Promise<void> => {
    const ref = imageRefSchema.parse(req.query.ref);
    await req.dockerClient!.getImage(ref).remove({ force: req.query.force === 'true' });
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'image.delete',
      target: ref,
      status: 'success',
      ip: req.ip,
    });

    res.json({ ok: true });
  };

  /**
   * Prune images
   * @param req Request
   * @param res Response
   */
  prune = async (req: Request, res: Response): Promise<void> => {
    const result = await req.dockerClient!.pruneImages({ filters: { dangling: { true: true } } });
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'image.prune',
      detail: `${result.SpaceReclaimed ?? 0} bytes reclaimed`,
      status: 'success',
      ip: req.ip,
    });
    
    res.json({ spaceReclaimed: result.SpaceReclaimed ?? 0 });
  };
}

export const imagesController = new ImagesController();

import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { buildImageFromGit, pullImage } from '../docker.js';
import { imageUpdateService } from '../imageUpdates.js';
import { GIT_REF_OR_PATH_RE, KEY_VALUE_RE, parseKeyValueList } from '../validators.js';

// Strips any embedded userinfo (https://<token>@host/...) before a Git URL is written to
// the audit log, so a credential never lands in a place a lower-privileged admin could read.
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

const checkUpdatesSchema = z.object({ ids: z.array(z.string()).optional() });

const buildFromGitSchema = z.object({
  repoUrl: z.string().url().max(500),
  ref: z.string().max(200).regex(GIT_REF_OR_PATH_RE).optional(),
  subdir: z.string().max(200).regex(GIT_REF_OR_PATH_RE).optional(),
  dockerfile: z.string().max(200).optional(),
  tag: z.string().trim().min(1).max(200),
  buildArgs: z.array(z.string().regex(KEY_VALUE_RE)).default([]),
});

const pullSchema = z.object({ reference: z.string().trim().min(1) });

export class ImagesController {
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

  // Triggers an on-demand registry check for one image (or, with no :id, every locally
  // tagged image). The manual counterpart to the optional background scheduler in
  // imageUpdates.ts. Gated behind manageImages since it's outbound network activity, same
  // bar as pull/prune.
  checkUpdates = async (req: Request, res: Response): Promise<void> => {
    const body = checkUpdatesSchema.parse(req.body ?? {});
    const result = await imageUpdateService.checkAll(req.hostId!, req.dockerClient!, body.ids);
    res.json(result);
  };

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

  // Builds an image from a Dockerfile hosted in a Git repository (GitHub, GitLab, Gitea, or
  // any host reachable from the Docker daemon). See buildImageFromGit() for how the clone
  // itself is delegated to the daemon. Always responds 200: whether the Dockerfile itself
  // built successfully is a business result (`ok`), distinct from a malformed request or an
  // unreachable daemon (which still surface as the usual HTTP error statuses).
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

  // The reference may contain slashes (registries): pass it as a query param.
  remove = async (req: Request, res: Response): Promise<void> => {
    const ref = z.string().min(1).parse(req.query.ref);
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

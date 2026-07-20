import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth.js';
import { recordAudit } from '../audit.js';
import { buildImageFromGit, docker, pullImage } from '../docker.js';
import { checkImageUpdate, checkImageUpdates, getCachedUpdateStatus } from '../imageUpdates.js';
import { GIT_REF_OR_PATH_RE, KEY_VALUE_RE, parseKeyValueList } from '../validators.js';

const router = Router();

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

router.get('/', async (_req, res) => {
  const list = await docker.listImages();
  res.json(
    list.map((i) => {
      const tags = i.RepoTags?.filter((t) => t !== '<none>:<none>') ?? [];
      const cached = tags[0] ? getCachedUpdateStatus(tags[0]) : undefined;
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
});

// Triggers an on-demand registry check for one image (or, with no :id, every locally
// tagged image) — the manual counterpart to the optional background scheduler in
// imageUpdates.ts. Gated behind manageImages since it's outbound network activity, same
// bar as pull/prune.
router.post('/check-updates', requirePermission('manageImages'), async (req, res) => {
  const body = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
  const result = await checkImageUpdates(body.ids);
  res.json(result);
});

router.post<{ id: string }>('/:id/check-update', requirePermission('manageImages'), async (req, res) => {
  const info = await docker.getImage(req.params.id).inspect();
  const reference = info.RepoTags?.find((t) => t !== '<none>:<none>');
  if (!reference) {
    res.status(400).json({ error: 'This image has no tag to check against a registry' });
    return;
  }
  const status = await checkImageUpdate(reference, info.RepoDigests);
  res.json({ reference, ...status });
});

const buildFromGitSchema = z.object({
  repoUrl: z.string().url().max(500),
  ref: z.string().max(200).regex(GIT_REF_OR_PATH_RE).optional(),
  subdir: z.string().max(200).regex(GIT_REF_OR_PATH_RE).optional(),
  dockerfile: z.string().max(200).optional(),
  tag: z.string().trim().min(1).max(200),
  buildArgs: z.array(z.string().regex(KEY_VALUE_RE)).default([]),
});

// Builds an image from a Dockerfile hosted in a Git repository (GitHub, GitLab, Gitea, or
// any host reachable from the Docker daemon) — see buildImageFromGit() for how the clone
// itself is delegated to the daemon. Always responds 200: whether the Dockerfile itself
// built successfully is a business result (`ok`), distinct from a malformed request or an
// unreachable daemon (which still surface as the usual HTTP error statuses).
router.post('/build-from-git', requirePermission('manageImages'), async (req, res) => {
  const body = buildFromGitSchema.parse(req.body);
  const buildArgs = parseKeyValueList(body.buildArgs);

  const result = await buildImageFromGit(body.repoUrl, body.tag, {
    ref: body.ref,
    subdir: body.subdir,
    dockerfile: body.dockerfile,
    buildArgs: Object.keys(buildArgs).length ? buildArgs : undefined,
  });

  if (result.error) {
    recordAudit({
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

  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'image.build',
    target: body.tag,
    detail: `from ${redactGitCredentials(body.repoUrl)}${body.ref ? `#${body.ref}` : ''}`,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true, tag: body.tag, log: result.log });
});

router.post('/pull', requirePermission('manageImages'), async (req, res) => {
  const body = z.object({ reference: z.string().trim().min(1) }).parse(req.body);
  await pullImage(body.reference);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'image.pull',
    target: body.reference,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

// The reference may contain slashes (registries): pass it as a query param.
router.delete('/', requirePermission('manageImages'), async (req, res) => {
  const ref = z.string().min(1).parse(req.query.ref);
  await docker.getImage(ref).remove({ force: req.query.force === 'true' });
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'image.delete',
    target: ref,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

router.post('/prune', requirePermission('manageImages'), async (req, res) => {
  const result = await docker.pruneImages({ filters: { dangling: { true: true } } });
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'image.prune',
    detail: `${result.SpaceReclaimed ?? 0} bytes reclaimed`,
    status: 'success',
    ip: req.ip,
  });
  res.json({ spaceReclaimed: result.SpaceReclaimed ?? 0 });
});

export default router;

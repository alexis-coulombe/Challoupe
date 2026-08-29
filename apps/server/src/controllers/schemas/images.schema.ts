import { z } from 'zod';
import { GIT_REF_OR_PATH_RE, KEY_VALUE_RE } from '../../validators.js';

export const checkUpdatesSchema = z.object({ ids: z.array(z.string()).optional() });

export const buildFromGitSchema = z.object({
  repoUrl: z.string().url().max(500),
  ref: z.string().max(200).regex(GIT_REF_OR_PATH_RE).optional(),
  subdir: z.string().max(200).regex(GIT_REF_OR_PATH_RE).optional(),
  dockerfile: z.string().max(200).optional(),
  tag: z.string().trim().min(1).max(200),
  buildArgs: z.array(z.string().regex(KEY_VALUE_RE)).default([]),
});

export const pullSchema = z.object({ reference: z.string().trim().min(1) });

export const imageRefSchema = z.string().min(1);

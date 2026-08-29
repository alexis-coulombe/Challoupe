import { z } from 'zod';
import { RESTART_POLICIES } from '../../settings.js';
import { DOCKER_NAME_RE, KEY_VALUE_RE } from '../../validators.js';

export const createSchema = z.object({
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

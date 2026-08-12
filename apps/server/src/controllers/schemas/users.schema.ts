import { z } from 'zod';
import { PERMISSIONS, type Permission } from '../../permissions.js';

export const permissionsSchema = z
  .object(Object.fromEntries(PERMISSIONS.map((p) => [p, z.boolean()])) as Record<Permission, z.ZodBoolean>)
  .partial();

export const createSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(128),
  role: z.enum(['admin', 'user']).default('user'),
  permissions: permissionsSchema.default({}),
});

export const updateSchema = z.object({
  password: z.string().min(8).max(128).optional(),
  role: z.enum(['admin', 'user']).optional(),
  permissions: permissionsSchema.optional(),
});

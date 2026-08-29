import { z } from 'zod';
import { STACK_NAME_RE } from '../../stacks.js';

export const createSchema = z.object({
  name: z.string().regex(STACK_NAME_RE, 'Lowercase letters, digits, - and _ only'),
  compose: z.string().min(1),
  deploy: z.boolean().default(false),
});

export const portainerCredsSchema = z.object({
  baseUrl: z.string().trim().url(),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const portainerImportSchema = portainerCredsSchema.extend({
  id: z.number().int(),
  name: z.string().regex(STACK_NAME_RE, 'Lowercase letters, digits, - and _ only'),
});

export const updateSchema = z.object({ compose: z.string().min(1) });

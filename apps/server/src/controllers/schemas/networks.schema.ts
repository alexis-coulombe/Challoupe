import { z } from 'zod';
import { DOCKER_NAME_RE } from '../../validators.js';

export const createSchema = z.object({
  name: z.string().regex(DOCKER_NAME_RE),
  driver: z.enum(['bridge', 'overlay', 'macvlan', 'ipvlan', 'host', 'none']).default('bridge'),
});

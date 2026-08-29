import { z } from 'zod';

export const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sshHost: z.string().trim().min(1).max(255),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUsername: z.string().trim().min(1).max(100),
  sshPrivateKey: z.string().min(1).max(16_000),
  sshPassphrase: z.string().max(500).default(''),
});

export const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    sshHost: z.string().trim().min(1).max(255),
    sshPort: z.number().int().min(1).max(65535),
    sshUsername: z.string().trim().min(1).max(100),
    sshPrivateKey: z.string().max(16_000),
    sshPassphrase: z.string().max(500),
  })
  .partial();

export const testSchema = z.object({
  sshHost: z.string().trim().min(1).max(255),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUsername: z.string().trim().min(1).max(100),
  sshPrivateKey: z.string().min(1).max(16_000),
  sshPassphrase: z.string().max(500).default(''),
});

import { z } from 'zod';
import { RESTART_POLICIES } from '../../settings.js';

export const updateSchema = z
  .object({
    defaultRestartPolicy: z.enum(RESTART_POLICIES),
    refreshIntervalMs: z.number().int().min(1000).max(300_000),
    defaultLogTail: z.number().int().min(10).max(10_000),
    defaultTerminalShell: z.enum(['/bin/bash', '/bin/sh', '/bin/ash']),
    ollamaBaseUrl: z.string().url().max(200),
    ollamaModel: z.string().max(100),
    trivyImage: z.string().max(200),
    maxContainerMemoryMb: z.number().int().positive().max(1024 * 1024).nullable(),
    maxContainerCpus: z.number().positive().max(256).nullable(),
    featureFlags: z
      .object({ aiAssistant: z.boolean(), vulnerabilityScanner: z.boolean(), auditLog: z.boolean() })
      .partial(),
    oidc: z
      .object({
        enabled: z.boolean(),
        issuerUrl: z.string().max(300).refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid URL'),
        clientId: z.string().max(200),
        clientSecret: z.string().max(500),
        buttonLabel: z.string().max(60),
        providerId: z.string().max(50),
      })
      .partial(),
    imageUpdateCheck: z
      .object({
        enabled: z.boolean(),
        intervalHours: z.number().int().min(1).max(24 * 30),
      })
      .partial(),
    scheduledBackup: z
      .object({
        enabled: z.boolean(),
        intervalHours: z.number().int().min(1).max(24 * 30),
        keepCount: z.number().int().min(1).max(100),
      })
      .partial(),
    terminalTheme: z
      .object({
        background: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color'),
        foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color'),
        cursor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color'),
      })
      .partial(),
    notifyEvents: z
      .object({
        onContainerCrash: z.boolean(),
        onImageUpdate: z.boolean(),
        onBackupFailure: z.boolean(),
        onAuditAnomaly: z.boolean(),
        onResourceThreshold: z.boolean(),
      })
      .partial(),
    notifications: z
      .object({
        enabled: z.boolean(),
        webhookUrl: z.string().max(500).refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid URL'),
        format: z.enum(['generic', 'discord', 'slack']),
      })
      .partial(),
    ntfy: z
      .object({
        enabled: z.boolean(),
        serverUrl: z.string().url().max(300),
        topic: z.string().max(100),
        username: z.string().max(200),
        password: z.string().max(500),
      })
      .partial(),
    aiWatchdog: z
      .object({
        enabled: z.boolean(),
        checkContainerEvents: z.boolean(),
        checkAuditLog: z.boolean(),
        auditCheckIntervalMinutes: z.number().int().min(1).max(24 * 60),
      })
      .partial(),
    resourceAlerts: z
      .object({
        enabled: z.boolean(),
        checkIntervalMinutes: z.number().int().min(1).max(24 * 60),
        hostCpuPercent: z.number().min(1).max(100),
        hostMemoryPercent: z.number().min(1).max(100),
        hostDiskPercent: z.number().min(1).max(100),
        containerCpuPercent: z.number().min(1).max(100),
        containerMemoryPercent: z.number().min(1).max(100),
      })
      .partial(),
    appLinks: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(60),
          url: z
            .string()
            .max(500)
            .refine((v) => /^https?:\/\//.test(v.trim()), 'Must start with http:// or https://'),
        })
      )
      .max(12),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one setting is required' });

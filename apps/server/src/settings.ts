import type Database from 'better-sqlite3';
import { db } from './db.js';

export const RESTART_POLICIES = ['no', 'always', 'unless-stopped', 'on-failure'] as const;
export type RestartPolicy = (typeof RESTART_POLICIES)[number];
export type TerminalShell = '/bin/bash' | '/bin/sh' | '/bin/ash';

/**
 * Feature flags booleans
 */
export interface FeatureFlags {
  aiAssistant: boolean;
  vulnerabilityScanner: boolean;
  auditLog: boolean;
}

const FEATURE_FLAG_DEFAULTS: FeatureFlags = {
  aiAssistant: true,
  vulnerabilityScanner: true,
  auditLog: true,
};

/**
 * SSO via an external OpenID Connect provider, in addition to local username/password login.
 */
export interface OidcSettings {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  providerId: string;
}

const OIDC_DEFAULTS: OidcSettings = {
  enabled: false,
  issuerUrl: '',
  clientId: '',
  clientSecret: '',
  buttonLabel: 'Single Sign-On',
  providerId: '',
};

/**
 * Whether to periodically check pulled images against their registry for a newer digest
 */
export interface ImageUpdateCheckSettings {
  enabled: boolean;
  intervalHours: number;
}

const IMAGE_UPDATE_CHECK_DEFAULTS: ImageUpdateCheckSettings = {
  enabled: false,
  intervalHours: 24,
};

/**
 * Whether to periodically write a full backup to disk
 */
export interface ScheduledBackupSettings {
  enabled: boolean;
  intervalHours: number;
  keepCount: number;
}

const SCHEDULED_BACKUP_DEFAULTS: ScheduledBackupSettings = {
  enabled: false,
  intervalHours: 24,
  keepCount: 7,
};

/**
 * Colors applied to every container's Terminal tab
 */
export interface TerminalThemeSettings {
  background: string;
  foreground: string;
  cursor: string;
}

const TERMINAL_THEME_DEFAULTS: TerminalThemeSettings = {
  background: '#0b0e14',
  foreground: '#c9d1d9',
  cursor: '#3b82f6',
};

export type NotificationFormat = 'generic' | 'discord' | 'slack';

export interface NotificationEvents {
  onContainerCrash: boolean;
  onImageUpdate: boolean;
  onBackupFailure: boolean;
  onAuditAnomaly: boolean;
}

const NOTIFICATION_EVENTS_DEFAULTS: NotificationEvents = {
  onContainerCrash: true,
  onImageUpdate: true,
  onBackupFailure: true,
  onAuditAnomaly: true,
};

/**
 * A webhook that gets posted to for background events
 */
export interface NotificationSettings {
  enabled: boolean;
  webhookUrl: string;
  format: NotificationFormat;
}

const NOTIFICATION_DEFAULTS: NotificationSettings = {
  enabled: false,
  webhookUrl: '',
  format: 'generic',
};

/**
 * A ntfy (https://ntfy.sh) topic that gets posted to for background events
 */
export interface NtfySettings {
  enabled: boolean;
  serverUrl: string;
  topic: string;
  username: string;
  password: string;
}

const NTFY_DEFAULTS: NtfySettings = {
  enabled: false,
  serverUrl: 'https://ntfy.sh',
  topic: '',
  username: '',
  password: '',
};

/**
 * Uses the local Ollama model to look at containers that just crashed or restarted, and a
 * scheduled rule-based scan of the audit log, to flag things worth a human's attention.
 * Requires featureFlags.aiAssistant for the container check (it calls Ollama); the audit
 * check is plain SQL and doesn't.
 */
export interface AiWatchdogSettings {
  enabled: boolean;
  checkContainerEvents: boolean;
  checkAuditLog: boolean;
  auditCheckIntervalMinutes: number;
}

const AI_WATCHDOG_DEFAULTS: AiWatchdogSettings = {
  enabled: false,
  checkContainerEvents: true,
  checkAuditLog: true,
  auditCheckIntervalMinutes: 15,
};

export interface AppSettings {
  defaultRestartPolicy: RestartPolicy;
  refreshIntervalMs: number;
  defaultLogTail: number;
  defaultTerminalShell: TerminalShell;
  ollamaBaseUrl: string;
  ollamaModel: string;
  trivyImage: string;
  // Caps applied to non-admin ("user" role) container creation; null = unlimited
  // (the default, matching pre-existing behavior).
  maxContainerMemoryMb: number | null;
  maxContainerCpus: number | null;
  oidc: OidcSettings;
  featureFlags: FeatureFlags;
  imageUpdateCheck: ImageUpdateCheckSettings;
  scheduledBackup: ScheduledBackupSettings;
  terminalTheme: TerminalThemeSettings;
  notifyEvents: NotificationEvents;
  notifications: NotificationSettings;
  ntfy: NtfySettings;
  aiWatchdog: AiWatchdogSettings;
}

const NESTED_KEYS = [
  'featureFlags',
  'oidc',
  'imageUpdateCheck',
  'scheduledBackup',
  'terminalTheme',
  'notifyEvents',
  'notifications',
  'ntfy',
  'aiWatchdog',
] as const;

const DEFAULTS: Omit<AppSettings, (typeof NESTED_KEYS)[number]> = {
  defaultRestartPolicy: 'no',
  refreshIntervalMs: 5000,
  defaultLogTail: 200,
  defaultTerminalShell: '/bin/sh',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: '',
  trivyImage: 'aquasec/trivy:latest',
  maxContainerMemoryMb: null,
  maxContainerCpus: null,
};

export type SettingsUpdate = Partial<Omit<AppSettings, (typeof NESTED_KEYS)[number]>> & {
  featureFlags?: Partial<FeatureFlags>;
  oidc?: Partial<OidcSettings>;
  imageUpdateCheck?: Partial<ImageUpdateCheckSettings>;
  scheduledBackup?: Partial<ScheduledBackupSettings>;
  terminalTheme?: Partial<TerminalThemeSettings>;
  notifyEvents?: Partial<NotificationEvents>;
  notifications?: Partial<NotificationSettings>;
  ntfy?: Partial<NtfySettings>;
  aiWatchdog?: Partial<AiWatchdogSettings>;
};

/**
 * Reads/writes the flat key-value `settings` table, applying defaults for anything not
 * yet stored.
 */
export class SettingsService {
  constructor(private readonly db: Database.Database) {}

  get(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    const featureFlags = { ...FEATURE_FLAG_DEFAULTS };
    for (const flag of Object.keys(featureFlags) as Array<keyof FeatureFlags>) {
      const raw = stored[`featureFlags.${flag}`];
      if (raw !== undefined) featureFlags[flag] = raw === 'true';
    }

    const oidc = { ...OIDC_DEFAULTS };
    for (const field of Object.keys(oidc) as Array<keyof OidcSettings>) {
      const raw = stored[`oidc.${field}`];
      if (raw === undefined) continue;
      if (field === 'enabled') oidc.enabled = raw === 'true';
      else oidc[field] = raw;
    }

    const imageUpdateCheck = { ...IMAGE_UPDATE_CHECK_DEFAULTS };
    if (stored['imageUpdateCheck.enabled'] !== undefined) {
      imageUpdateCheck.enabled = stored['imageUpdateCheck.enabled'] === 'true';
    }
    if (stored['imageUpdateCheck.intervalHours'] !== undefined) {
      imageUpdateCheck.intervalHours = Number(stored['imageUpdateCheck.intervalHours']);
    }

    const scheduledBackup = { ...SCHEDULED_BACKUP_DEFAULTS };
    if (stored['scheduledBackup.enabled'] !== undefined) {
      scheduledBackup.enabled = stored['scheduledBackup.enabled'] === 'true';
    }
    if (stored['scheduledBackup.intervalHours'] !== undefined) {
      scheduledBackup.intervalHours = Number(stored['scheduledBackup.intervalHours']);
    }
    if (stored['scheduledBackup.keepCount'] !== undefined) {
      scheduledBackup.keepCount = Number(stored['scheduledBackup.keepCount']);
    }

    const terminalTheme = { ...TERMINAL_THEME_DEFAULTS };
    for (const field of Object.keys(terminalTheme) as Array<keyof TerminalThemeSettings>) {
      const raw = stored[`terminalTheme.${field}`];
      if (raw !== undefined) terminalTheme[field] = raw;
    }

    const notifyEvents = { ...NOTIFICATION_EVENTS_DEFAULTS };
    for (const field of Object.keys(notifyEvents) as Array<keyof NotificationEvents>) {
      const raw = stored[`notifyEvents.${field}`];
      if (raw !== undefined) notifyEvents[field] = raw === 'true';
    }

    const notifications = { ...NOTIFICATION_DEFAULTS };
    for (const field of Object.keys(notifications) as Array<keyof NotificationSettings>) {
      const raw = stored[`notifications.${field}`];
      if (raw === undefined) continue;
      if (field === 'format') notifications.format = raw as NotificationFormat;
      else if (field === 'webhookUrl') notifications.webhookUrl = raw;
      else notifications[field] = raw === 'true';
    }

    const ntfy = { ...NTFY_DEFAULTS };
    for (const field of Object.keys(ntfy) as Array<keyof NtfySettings>) {
      const raw = stored[`ntfy.${field}`];
      if (raw === undefined) continue;
      if (field === 'serverUrl' || field === 'topic' || field === 'username' || field === 'password') {
        ntfy[field] = raw;
      } else {
        ntfy[field] = raw === 'true';
      }
    }

    const aiWatchdog = { ...AI_WATCHDOG_DEFAULTS };
    if (stored['aiWatchdog.enabled'] !== undefined) {
      aiWatchdog.enabled = stored['aiWatchdog.enabled'] === 'true';
    }
    if (stored['aiWatchdog.checkContainerEvents'] !== undefined) {
      aiWatchdog.checkContainerEvents = stored['aiWatchdog.checkContainerEvents'] === 'true';
    }
    if (stored['aiWatchdog.checkAuditLog'] !== undefined) {
      aiWatchdog.checkAuditLog = stored['aiWatchdog.checkAuditLog'] === 'true';
    }
    if (stored['aiWatchdog.auditCheckIntervalMinutes'] !== undefined) {
      aiWatchdog.auditCheckIntervalMinutes = Number(stored['aiWatchdog.auditCheckIntervalMinutes']);
    }

    return {
      defaultRestartPolicy: (stored.defaultRestartPolicy as RestartPolicy) ?? DEFAULTS.defaultRestartPolicy,
      refreshIntervalMs: stored.refreshIntervalMs
        ? Number(stored.refreshIntervalMs)
        : DEFAULTS.refreshIntervalMs,
      defaultLogTail: stored.defaultLogTail ? Number(stored.defaultLogTail) : DEFAULTS.defaultLogTail,
      defaultTerminalShell: (stored.defaultTerminalShell as TerminalShell) ?? DEFAULTS.defaultTerminalShell,
      ollamaBaseUrl: stored.ollamaBaseUrl ?? DEFAULTS.ollamaBaseUrl,
      ollamaModel: stored.ollamaModel ?? DEFAULTS.ollamaModel,
      trivyImage: stored.trivyImage ?? DEFAULTS.trivyImage,
      maxContainerMemoryMb: stored.maxContainerMemoryMb ? Number(stored.maxContainerMemoryMb) : null,
      maxContainerCpus: stored.maxContainerCpus ? Number(stored.maxContainerCpus) : null,
      featureFlags,
      oidc,
      imageUpdateCheck,
      scheduledBackup,
      terminalTheme,
      notifyEvents,
      notifications,
      ntfy,
      aiWatchdog,
    };
  }

  update(values: SettingsUpdate): AppSettings {
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const clear = this.db.prepare('DELETE FROM settings WHERE key = ?');
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      if (key === 'featureFlags') {
        for (const [flag, enabled] of Object.entries(value as Partial<FeatureFlags>)) {
          if (enabled !== undefined) upsert.run(`featureFlags.${flag}`, String(enabled));
        }
        continue;
      }
      if (key === 'oidc') {
        for (const [field, val] of Object.entries(value as Partial<OidcSettings>)) {
          if (val === undefined) continue;
          if (field === 'clientSecret' && val === '') continue; // blank = leave the stored secret unchanged
          upsert.run(`oidc.${field}`, String(val));
        }
        continue;
      }
      if (key === 'imageUpdateCheck') {
        for (const [field, val] of Object.entries(value as Partial<ImageUpdateCheckSettings>)) {
          if (val === undefined) continue;
          upsert.run(`imageUpdateCheck.${field}`, String(val));
        }
        continue;
      }
      if (key === 'scheduledBackup') {
        for (const [field, val] of Object.entries(value as Partial<ScheduledBackupSettings>)) {
          if (val === undefined) continue;
          upsert.run(`scheduledBackup.${field}`, String(val));
        }
        continue;
      }
      if (key === 'terminalTheme') {
        for (const [field, val] of Object.entries(value as Partial<TerminalThemeSettings>)) {
          if (val === undefined) continue;
          upsert.run(`terminalTheme.${field}`, String(val));
        }
        continue;
      }
      if (key === 'notifyEvents') {
        for (const [field, val] of Object.entries(value as Partial<NotificationEvents>)) {
          if (val === undefined) continue;
          upsert.run(`notifyEvents.${field}`, String(val));
        }
        continue;
      }
      if (key === 'notifications') {
        for (const [field, val] of Object.entries(value as Partial<NotificationSettings>)) {
          if (val === undefined) continue;
          if (field === 'webhookUrl' && val === '') continue; // blank = leave the stored URL unchanged
          upsert.run(`notifications.${field}`, String(val));
        }
        continue;
      }
      if (key === 'ntfy') {
        for (const [field, val] of Object.entries(value as Partial<NtfySettings>)) {
          if (val === undefined) continue;
          if (field === 'password' && val === '') continue; // blank = leave the stored password unchanged
          upsert.run(`ntfy.${field}`, String(val));
        }
        continue;
      }
      if (key === 'aiWatchdog') {
        for (const [field, val] of Object.entries(value as Partial<AiWatchdogSettings>)) {
          if (val === undefined) continue;
          upsert.run(`aiWatchdog.${field}`, String(val));
        }
        continue;
      }
      if (value === null) {
        clear.run(key);
        continue;
      }
      upsert.run(key, String(value));
    }
    return this.get();
  }

  reset(): AppSettings {
    this.db.exec('DELETE FROM settings');
    return this.get();
  }
}

export const settingsService = new SettingsService(db);

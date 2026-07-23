import { db } from './db.js';

export const RESTART_POLICIES = ['no', 'always', 'unless-stopped', 'on-failure'] as const;
export type RestartPolicy = (typeof RESTART_POLICIES)[number];
export type TerminalShell = '/bin/bash' | '/bin/sh' | '/bin/ash';

// The feature-flag registry: one boolean per gated feature. Adding a new flag is a
// one-line addition here (plus a zod field in routes/settings.ts and a UI toggle) —
// each flag is stored under its own `featureFlags.<name>` key, so the flat settings
// table never needs a schema change to grow this list.
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

// SSO via an external OpenID Connect provider, in addition to local username/password
// login. `clientSecret` is write-only from the API's point of view — see getSettings().
// `providerId` is purely a UI hint (which preset template — google/microsoft/okta/etc. —
// the admin picked in Settings) so the picker can be restored on reload; the server never
// looks at it, since discovery works generically off `issuerUrl` alone.
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

// Whether to periodically check pulled images against their registry for a newer digest
// (see imageUpdates.ts). Off by default — a manifest check counts toward a registry's pull
// rate limit (Docker Hub's anonymous quota in particular), so background polling is opt-in.
export interface ImageUpdateCheckSettings {
  enabled: boolean;
  intervalHours: number;
}

const IMAGE_UPDATE_CHECK_DEFAULTS: ImageUpdateCheckSettings = {
  enabled: false,
  intervalHours: 24,
};

// Whether to periodically write a full backup (settings/users/stacks) to disk under
// data/backups/ (see scheduledBackups.ts). `keepCount` bounds disk usage by pruning the
// oldest files after each run — off by default since a manual export/download already
// covers the occasional case, and this is aimed at unattended installs.
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

// Colors applied to every container's Terminal tab (xterm.js theme). Defaults match
// xterm's own dark palette previously hardcoded in ContainerTerminal.tsx.
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
}

const DEFAULTS: Omit<
  AppSettings,
  'featureFlags' | 'oidc' | 'imageUpdateCheck' | 'scheduledBackup' | 'terminalTheme'
> = {
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

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
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
  };
}

export type SettingsUpdate = Partial<
  Omit<AppSettings, 'featureFlags' | 'oidc' | 'imageUpdateCheck' | 'scheduledBackup' | 'terminalTheme'>
> & {
  featureFlags?: Partial<FeatureFlags>;
  oidc?: Partial<OidcSettings>;
  imageUpdateCheck?: Partial<ImageUpdateCheckSettings>;
  scheduledBackup?: Partial<ScheduledBackupSettings>;
  terminalTheme?: Partial<TerminalThemeSettings>;
};

export function setSettings(values: SettingsUpdate): AppSettings {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const clear = db.prepare('DELETE FROM settings WHERE key = ?');
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
    if (value === null) {
      clear.run(key);
      continue;
    }
    upsert.run(key, String(value));
  }
  return getSettings();
}

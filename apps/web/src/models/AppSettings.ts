import type { TerminalShell } from './docker';
import type { TerminalThemeSettings } from './TerminalThemeSettings';
import type { NotificationFormat } from './NotificationFormat';

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure';

export interface FeatureFlags {
  aiAssistant: boolean;
  vulnerabilityScanner: boolean;
  auditLog: boolean;
}

export interface ImageUpdateCheckSettings {
  enabled: boolean;
  intervalHours: number;
}

export interface ScheduledBackupSettings {
  enabled: boolean;
  intervalHours: number;
  keepCount: number;
}

// clientSecret is always returned blank by the API
export interface OidcSettings {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  providerId: string;
}

// Which background events are worth notifying about, shared by every channel below.
export interface NotificationEvents {
  onContainerCrash: boolean;
  onImageUpdate: boolean;
  onBackupFailure: boolean;
  onAuditAnomaly: boolean;
  onResourceThreshold: boolean;
}

// webhookUrl is always returned blank by the API
export interface NotificationSettings {
  enabled: boolean;
  webhookUrl: string;
  format: NotificationFormat;
}

// password is always returned blank by the API
export interface NtfySettings {
  enabled: boolean;
  serverUrl: string;
  topic: string;
  username: string;
  password: string;
}

export interface AiWatchdogSettings {
  enabled: boolean;
  checkContainerEvents: boolean;
  checkAuditLog: boolean;
  auditCheckIntervalMinutes: number;
}

export interface ResourceAlertSettings {
  enabled: boolean;
  checkIntervalMinutes: number;
  hostCpuPercent: number;
  hostMemoryPercent: number;
  hostDiskPercent: number;
  containerCpuPercent: number;
  containerMemoryPercent: number;
}

// A link to another self-hosted app's URL, shown in the app-switcher grid in the header.
export interface AppLink {
  label: string;
  url: string;
}

export interface AppSettings {
  defaultRestartPolicy: RestartPolicy;
  refreshIntervalMs: number;
  defaultLogTail: number;
  defaultTerminalShell: TerminalShell;
  ollamaBaseUrl: string;
  ollamaModel: string;
  trivyImage: string;
  maxContainerMemoryMb: number | null;
  maxContainerCpus: number | null;
  featureFlags: FeatureFlags;
  oidc: OidcSettings;
  imageUpdateCheck: ImageUpdateCheckSettings;
  scheduledBackup: ScheduledBackupSettings;
  terminalTheme: TerminalThemeSettings;
  notifyEvents: NotificationEvents;
  notifications: NotificationSettings;
  ntfy: NtfySettings;
  aiWatchdog: AiWatchdogSettings;
  resourceAlerts: ResourceAlertSettings;
  appLinks: AppLink[];
}

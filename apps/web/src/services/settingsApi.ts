import { api } from '../api';
import type {
  AppSettings,
  FeatureFlags,
  ImageUpdateCheckSettings,
  NotificationSettings,
  NtfySettings,
  OidcSettings,
  ScheduledBackupSettings,
  TerminalThemeSettings,
} from '../api';

const NESTED_KEYS = [
  'featureFlags',
  'oidc',
  'imageUpdateCheck',
  'scheduledBackup',
  'terminalTheme',
  'notifications',
  'ntfy',
] as const;

// Mirrors the server's SettingsUpdate (routes/settings.ts): every field, including nested
// objects, is independently optional. The API only applies whichever ones are sent.
export type SettingsUpdate = Partial<Omit<AppSettings, (typeof NESTED_KEYS)[number]>> & {
  featureFlags?: Partial<FeatureFlags>;
  oidc?: Partial<OidcSettings>;
  imageUpdateCheck?: Partial<ImageUpdateCheckSettings>;
  scheduledBackup?: Partial<ScheduledBackupSettings>;
  terminalTheme?: Partial<TerminalThemeSettings>;
  notifications?: Partial<NotificationSettings>;
  ntfy?: Partial<NtfySettings>;
};

export class SettingsApi {
  get() {
    return api.get<AppSettings>('/settings');
  }

  update(values: SettingsUpdate) {
    return api.put<AppSettings>('/settings', values);
  }

  reset() {
    return api.post<AppSettings>('/settings/reset');
  }
}

export const settingsApi = new SettingsApi();

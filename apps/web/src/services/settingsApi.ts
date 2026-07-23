import { api } from '../api';
import type {
  AppSettings,
  FeatureFlags,
  ImageUpdateCheckSettings,
  OidcSettings,
  ScheduledBackupSettings,
  TerminalThemeSettings,
} from '../api';

// Mirrors the server's SettingsUpdate (routes/settings.ts): every field, including nested
// objects, is independently optional — the API only applies whichever ones are sent.
export type SettingsUpdate = Partial<
  Omit<AppSettings, 'featureFlags' | 'oidc' | 'imageUpdateCheck' | 'scheduledBackup' | 'terminalTheme'>
> & {
  featureFlags?: Partial<FeatureFlags>;
  oidc?: Partial<OidcSettings>;
  imageUpdateCheck?: Partial<ImageUpdateCheckSettings>;
  scheduledBackup?: Partial<ScheduledBackupSettings>;
  terminalTheme?: Partial<TerminalThemeSettings>;
};

export class SettingsApi {
  get() {
    return api.get<AppSettings>('/settings');
  }

  update(values: SettingsUpdate) {
    return api.put<AppSettings>('/settings', values);
  }
}

export const settingsApi = new SettingsApi();

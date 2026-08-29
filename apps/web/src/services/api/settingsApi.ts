import { api } from '../../api';
import type { AppSettings } from '../../models/AppSettings';

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
  'resourceAlerts',
] as const;

// Mirrors the server's SettingsUpdate (routes/settings.ts): every field, including nested
// objects, is independently optional. The API only applies whichever ones are sent.
export type SettingsUpdate = Partial<Omit<AppSettings, (typeof NESTED_KEYS)[number]>> & {
  [K in (typeof NESTED_KEYS)[number]]?: Partial<AppSettings[K]>;
};

class SettingsApi {
  /**
   * Get all settings
   * @returns Settings reponse
   */
  get() {
    return api.get<AppSettings>('/settings');
  }

  /**
   * Update settings
   * @param values SettingsUpdate
   * @returns Update response
   */
  update(values: SettingsUpdate) {
    return api.put<AppSettings>('/settings', values);
  }

  /**
   * Factory reset settings
   * @returns Factory reset response
   */
  reset() {
    return api.post<AppSettings>('/settings/reset');
  }
}

export const settingsApi = new SettingsApi();

import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.js';
import { getSettings, setSettings } from './settings.js';

const DEFAULTS = {
  defaultRestartPolicy: 'no',
  refreshIntervalMs: 5000,
  defaultLogTail: 200,
  defaultTerminalShell: '/bin/sh',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: '',
  trivyImage: 'aquasec/trivy:latest',
  maxContainerMemoryMb: null,
  maxContainerCpus: null,
  featureFlags: { aiAssistant: true, vulnerabilityScanner: true, auditLog: true },
  oidc: {
    enabled: false,
    issuerUrl: '',
    clientId: '',
    clientSecret: '',
    buttonLabel: 'Single Sign-On',
    providerId: '',
  },
  imageUpdateCheck: { enabled: false, intervalHours: 24 },
  scheduledBackup: { enabled: false, intervalHours: 24, keepCount: 7 },
};

beforeEach(() => {
  db.exec('DELETE FROM settings');
});

describe('settings', () => {
  it('falls back to defaults when nothing is stored', () => {
    expect(getSettings()).toEqual(DEFAULTS);
  });

  it('persists an updated value and returns it on read, leaving other defaults intact', () => {
    setSettings({ defaultRestartPolicy: 'unless-stopped' });
    expect(getSettings()).toEqual({ ...DEFAULTS, defaultRestartPolicy: 'unless-stopped' });
  });

  it('overwrites a previously stored value rather than duplicating it', () => {
    setSettings({ defaultRestartPolicy: 'always' });
    setSettings({ defaultRestartPolicy: 'on-failure' });
    expect(getSettings()).toEqual({ ...DEFAULTS, defaultRestartPolicy: 'on-failure' });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('persists numeric settings and reads them back as numbers', () => {
    setSettings({ refreshIntervalMs: 10_000, defaultLogTail: 1000 });
    expect(getSettings()).toEqual({ ...DEFAULTS, refreshIntervalMs: 10_000, defaultLogTail: 1000 });
  });

  it('persists the default terminal shell', () => {
    setSettings({ defaultTerminalShell: '/bin/bash' });
    expect(getSettings().defaultTerminalShell).toBe('/bin/bash');
  });

  it('persists the Ollama base URL and model', () => {
    setSettings({ ollamaBaseUrl: 'http://192.168.1.50:11434', ollamaModel: 'llama3.1' });
    expect(getSettings()).toEqual({
      ...DEFAULTS,
      ollamaBaseUrl: 'http://192.168.1.50:11434',
      ollamaModel: 'llama3.1',
    });
  });

  it('defaults every feature flag to enabled', () => {
    expect(getSettings().featureFlags).toEqual({ aiAssistant: true, vulnerabilityScanner: true, auditLog: true });
  });

  it('persists a disabled feature flag independently of the other settings', () => {
    setSettings({ featureFlags: { aiAssistant: false } });
    expect(getSettings()).toEqual({
      ...DEFAULTS,
      featureFlags: { aiAssistant: false, vulnerabilityScanner: true, auditLog: true },
    });
  });

  it('re-enables a feature flag on a later update', () => {
    setSettings({ featureFlags: { aiAssistant: false } });
    setSettings({ featureFlags: { aiAssistant: true } });
    expect(getSettings().featureFlags).toEqual({ aiAssistant: true, vulnerabilityScanner: true, auditLog: true });
  });

  it('persists the Trivy image independently, and each feature flag independently', () => {
    setSettings({ trivyImage: 'aquasec/trivy:0.50.0', featureFlags: { vulnerabilityScanner: false } });
    expect(getSettings()).toEqual({
      ...DEFAULTS,
      trivyImage: 'aquasec/trivy:0.50.0',
      featureFlags: { aiAssistant: true, vulnerabilityScanner: false, auditLog: true },
    });
  });

  it('persists a numeric container quota, and clears it back to unlimited (null) on request', () => {
    setSettings({ maxContainerMemoryMb: 512, maxContainerCpus: 2 });
    expect(getSettings()).toEqual({ ...DEFAULTS, maxContainerMemoryMb: 512, maxContainerCpus: 2 });

    setSettings({ maxContainerMemoryMb: null });
    expect(getSettings().maxContainerMemoryMb).toBeNull();
    expect(getSettings().maxContainerCpus).toBe(2); // untouched field survives
  });

  it('persists OIDC settings, including the client secret when read directly (not via the API)', () => {
    setSettings({ oidc: { enabled: true, issuerUrl: 'https://accounts.example.com', clientId: 'c', clientSecret: 's' } });
    expect(getSettings().oidc).toEqual({
      enabled: true,
      issuerUrl: 'https://accounts.example.com',
      clientId: 'c',
      clientSecret: 's',
      buttonLabel: 'Single Sign-On',
      providerId: '',
    });
  });

  it('persists which SSO provider template the admin picked, as a plain UI hint', () => {
    setSettings({ oidc: { providerId: 'okta', issuerUrl: 'https://dev-1234.okta.com' } });
    expect(getSettings().oidc.providerId).toBe('okta');
    setSettings({ oidc: { providerId: '' } });
    expect(getSettings().oidc.providerId).toBe('');
  });

  it('leaves a stored client secret unchanged when a later update sends a blank one', () => {
    setSettings({ oidc: { clientSecret: 'first' } });
    setSettings({ oidc: { clientSecret: '', buttonLabel: 'New label' } });
    expect(getSettings().oidc.clientSecret).toBe('first');
    expect(getSettings().oidc.buttonLabel).toBe('New label');
  });

  it('persists the image update check settings independently of the other settings', () => {
    setSettings({ imageUpdateCheck: { enabled: true, intervalHours: 6 } });
    expect(getSettings()).toEqual({
      ...DEFAULTS,
      imageUpdateCheck: { enabled: true, intervalHours: 6 },
    });
  });

  it('persists the scheduled backup settings independently of the other settings', () => {
    setSettings({ scheduledBackup: { enabled: true, intervalHours: 12, keepCount: 3 } });
    expect(getSettings()).toEqual({
      ...DEFAULTS,
      scheduledBackup: { enabled: true, intervalHours: 12, keepCount: 3 },
    });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { settingsService } from '../src/settings.js';

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
  terminalTheme: { background: '#0b0e14', foreground: '#c9d1d9', cursor: '#3b82f6' },
  notifyEvents: {
    onContainerCrash: true,
    onImageUpdate: true,
    onBackupFailure: true,
    onAuditAnomaly: true,
    onResourceThreshold: true,
  },
  notifications: {
    enabled: false,
    webhookUrl: '',
    format: 'generic',
  },
  ntfy: {
    enabled: false,
    serverUrl: 'https://ntfy.sh',
    topic: '',
    username: '',
    password: '',
  },
  aiWatchdog: {
    enabled: false,
    checkContainerEvents: true,
    checkAuditLog: true,
    auditCheckIntervalMinutes: 15,
  },
  resourceAlerts: {
    enabled: false,
    checkIntervalMinutes: 5,
    hostCpuPercent: 90,
    hostMemoryPercent: 90,
    hostDiskPercent: 90,
    containerCpuPercent: 90,
    containerMemoryPercent: 90,
  },
};

beforeEach(() => {
  db.exec('DELETE FROM settings');
});

describe('settings', () => {
  it('falls back to defaults when nothing is stored', () => {
    expect(settingsService.get()).toEqual(DEFAULTS);
  });

  it('persists an updated value and returns it on read, leaving other defaults intact', () => {
    settingsService.update({ defaultRestartPolicy: 'unless-stopped' });
    expect(settingsService.get()).toEqual({ ...DEFAULTS, defaultRestartPolicy: 'unless-stopped' });
  });

  it('overwrites a previously stored value rather than duplicating it', () => {
    settingsService.update({ defaultRestartPolicy: 'always' });
    settingsService.update({ defaultRestartPolicy: 'on-failure' });
    expect(settingsService.get()).toEqual({ ...DEFAULTS, defaultRestartPolicy: 'on-failure' });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('persists numeric settings and reads them back as numbers', () => {
    settingsService.update({ refreshIntervalMs: 10_000, defaultLogTail: 1000 });
    expect(settingsService.get()).toEqual({ ...DEFAULTS, refreshIntervalMs: 10_000, defaultLogTail: 1000 });
  });

  it('persists the default terminal shell', () => {
    settingsService.update({ defaultTerminalShell: '/bin/bash' });
    expect(settingsService.get().defaultTerminalShell).toBe('/bin/bash');
  });

  it('persists the Ollama base URL and model', () => {
    settingsService.update({ ollamaBaseUrl: 'http://192.168.1.50:11434', ollamaModel: 'llama3.1' });
    expect(settingsService.get()).toEqual({
      ...DEFAULTS,
      ollamaBaseUrl: 'http://192.168.1.50:11434',
      ollamaModel: 'llama3.1',
    });
  });

  it('defaults every feature flag to enabled', () => {
    expect(settingsService.get().featureFlags).toEqual({ aiAssistant: true, vulnerabilityScanner: true, auditLog: true });
  });

  it('persists a disabled feature flag independently of the other settings', () => {
    settingsService.update({ featureFlags: { aiAssistant: false } });
    expect(settingsService.get()).toEqual({
      ...DEFAULTS,
      featureFlags: { aiAssistant: false, vulnerabilityScanner: true, auditLog: true },
    });
  });

  it('re-enables a feature flag on a later update', () => {
    settingsService.update({ featureFlags: { aiAssistant: false } });
    settingsService.update({ featureFlags: { aiAssistant: true } });
    expect(settingsService.get().featureFlags).toEqual({ aiAssistant: true, vulnerabilityScanner: true, auditLog: true });
  });

  it('persists the Trivy image independently, and each feature flag independently', () => {
    settingsService.update({ trivyImage: 'aquasec/trivy:0.50.0', featureFlags: { vulnerabilityScanner: false } });
    expect(settingsService.get()).toEqual({
      ...DEFAULTS,
      trivyImage: 'aquasec/trivy:0.50.0',
      featureFlags: { aiAssistant: true, vulnerabilityScanner: false, auditLog: true },
    });
  });

  it('persists a numeric container quota, and clears it back to unlimited (null) on request', () => {
    settingsService.update({ maxContainerMemoryMb: 512, maxContainerCpus: 2 });
    expect(settingsService.get()).toEqual({ ...DEFAULTS, maxContainerMemoryMb: 512, maxContainerCpus: 2 });

    settingsService.update({ maxContainerMemoryMb: null });
    expect(settingsService.get().maxContainerMemoryMb).toBeNull();
    expect(settingsService.get().maxContainerCpus).toBe(2); // untouched field survives
  });

  it('persists OIDC settings, including the client secret when read directly (not via the API)', () => {
    settingsService.update({ oidc: { enabled: true, issuerUrl: 'https://accounts.example.com', clientId: 'c', clientSecret: 's' } });
    expect(settingsService.get().oidc).toEqual({
      enabled: true,
      issuerUrl: 'https://accounts.example.com',
      clientId: 'c',
      clientSecret: 's',
      buttonLabel: 'Single Sign-On',
      providerId: '',
    });
  });

  it('persists which SSO provider template the admin picked, as a plain UI hint', () => {
    settingsService.update({ oidc: { providerId: 'okta', issuerUrl: 'https://dev-1234.okta.com' } });
    expect(settingsService.get().oidc.providerId).toBe('okta');
    settingsService.update({ oidc: { providerId: '' } });
    expect(settingsService.get().oidc.providerId).toBe('');
  });

  it('leaves a stored client secret unchanged when a later update sends a blank one', () => {
    settingsService.update({ oidc: { clientSecret: 'first' } });
    settingsService.update({ oidc: { clientSecret: '', buttonLabel: 'New label' } });
    expect(settingsService.get().oidc.clientSecret).toBe('first');
    expect(settingsService.get().oidc.buttonLabel).toBe('New label');
  });

  it('persists the image update check settings independently of the other settings', () => {
    settingsService.update({ imageUpdateCheck: { enabled: true, intervalHours: 6 } });
    expect(settingsService.get()).toEqual({
      ...DEFAULTS,
      imageUpdateCheck: { enabled: true, intervalHours: 6 },
    });
  });

  it('persists the scheduled backup settings independently of the other settings', () => {
    settingsService.update({ scheduledBackup: { enabled: true, intervalHours: 12, keepCount: 3 } });
    expect(settingsService.get()).toEqual({
      ...DEFAULTS,
      scheduledBackup: { enabled: true, intervalHours: 12, keepCount: 3 },
    });
  });

  it('persists a partial terminal theme update, leaving the other colors at their default', () => {
    settingsService.update({ terminalTheme: { background: '#ffffff' } });
    expect(settingsService.get()).toEqual({
      ...DEFAULTS,
      terminalTheme: { background: '#ffffff', foreground: '#c9d1d9', cursor: '#3b82f6' },
    });
  });

  it('persists the notification settings, including the webhook URL when read directly', () => {
    settingsService.update({
      notifications: { enabled: true, webhookUrl: 'https://hooks.example.com/x', format: 'slack' },
    });
    expect(settingsService.get().notifications).toEqual({
      enabled: true,
      webhookUrl: 'https://hooks.example.com/x',
      format: 'slack',
    });
  });

  it('leaves a stored webhook URL unchanged when a later update sends a blank one', () => {
    settingsService.update({ notifications: { webhookUrl: 'https://hooks.example.com/x' } });
    settingsService.update({ notifications: { webhookUrl: '' } });
    expect(settingsService.get().notifications.webhookUrl).toBe('https://hooks.example.com/x');
  });

  it('persists the ntfy settings, including the password when read directly', () => {
    settingsService.update({
      ntfy: { enabled: true, serverUrl: 'https://ntfy.example.com', topic: 'challoupe', username: 'admin', password: 'shh' },
    });
    expect(settingsService.get().ntfy).toEqual({
      enabled: true,
      serverUrl: 'https://ntfy.example.com',
      topic: 'challoupe',
      username: 'admin',
      password: 'shh',
    });
  });

  it('leaves a stored ntfy password unchanged when a later update sends a blank one', () => {
    settingsService.update({ ntfy: { password: 'first-password' } });
    settingsService.update({ ntfy: { password: '' } });
    expect(settingsService.get().ntfy.password).toBe('first-password');
  });

  it('persists which events to notify about, shared by every channel', () => {
    settingsService.update({ notifyEvents: { onBackupFailure: false } });
    expect(settingsService.get().notifyEvents).toEqual({
      onContainerCrash: true,
      onImageUpdate: true,
      onBackupFailure: false,
      onAuditAnomaly: true,
      onResourceThreshold: true,
    });
  });

  it('persists the AI watchdog settings independently of the other settings', () => {
    settingsService.update({
      aiWatchdog: { enabled: true, checkContainerEvents: false, auditCheckIntervalMinutes: 60 },
    });
    expect(settingsService.get().aiWatchdog).toEqual({
      enabled: true,
      checkContainerEvents: false,
      checkAuditLog: true,
      auditCheckIntervalMinutes: 60,
    });
  });

  it('persists the resource alert settings independently of the other settings', () => {
    settingsService.update({
      resourceAlerts: { enabled: true, hostCpuPercent: 80, containerMemoryPercent: 75 },
    });
    expect(settingsService.get().resourceAlerts).toEqual({
      enabled: true,
      checkIntervalMinutes: 5,
      hostCpuPercent: 80,
      hostMemoryPercent: 90,
      hostDiskPercent: 90,
      containerCpuPercent: 90,
      containerMemoryPercent: 75,
    });
  });

  it('reset() clears every stored setting back to its default', () => {
    settingsService.update({
      defaultRestartPolicy: 'always',
      oidc: { enabled: true, clientSecret: 'shh' },
      notifyEvents: { onBackupFailure: false },
      notifications: { enabled: true, webhookUrl: 'https://hooks.example.com/x' },
      ntfy: { enabled: true, topic: 'challoupe', password: 'shh' },
      aiWatchdog: { enabled: true, checkAuditLog: false },
      resourceAlerts: { enabled: true, hostCpuPercent: 80 },
    });
    expect(settingsService.reset()).toEqual(DEFAULTS);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    expect(rows.n).toBe(0);
  });
});

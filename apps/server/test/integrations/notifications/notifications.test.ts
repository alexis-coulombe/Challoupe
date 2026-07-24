import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db.js';
import { settingsService } from '../../../src/settings.js';
import { notificationService } from '../../../src/integrations/notifications/notifications.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  db.exec('DELETE FROM settings');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetchOk(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('NotificationService', () => {
  it('does nothing when notifications are disabled', async () => {
    const fetchMock = mockFetchOk();
    await notificationService.notifyContainerEvent('app', 'crashed (exit code 1)');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when no webhook URL is configured', async () => {
    const fetchMock = mockFetchOk();
    settingsService.update({ notifications: { enabled: true } });
    await notificationService.notifyContainerEvent('app', 'crashed (exit code 1)');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects the per-event toggle even when enabled with a URL', async () => {
    const fetchMock = mockFetchOk();
    settingsService.update({
      notifications: { enabled: true, webhookUrl: 'https://hooks.example.com/x', onContainerCrash: false },
    });
    await notificationService.notifyContainerEvent('app', 'crashed (exit code 1)');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a generic JSON payload by default', async () => {
    const fetchMock = mockFetchOk();
    settingsService.update({
      notifications: { enabled: true, webhookUrl: 'https://hooks.example.com/x' },
    });
    await notificationService.notifyContainerEvent('app', 'crashed (exit code 1)');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/x',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ source: 'challoupe', message: 'Container "app" crashed (exit code 1).' });
  });

  it('posts a Discord-shaped payload when the format is discord', async () => {
    const fetchMock = mockFetchOk();
    settingsService.update({
      notifications: { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/x', format: 'discord' },
    });
    await notificationService.notifyImageUpdates(2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ content: '**Challoupe** 2 image updates available.' });
  });

  it('posts a Slack-shaped payload when the format is slack', async () => {
    const fetchMock = mockFetchOk();
    settingsService.update({
      notifications: { enabled: true, webhookUrl: 'https://hooks.slack.com/services/x', format: 'slack' },
    });
    await notificationService.notifyBackupFailure('disk full');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ text: '*Challoupe* Scheduled backup failed: disk full' });
  });

  it('swallows a webhook failure instead of throwing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    settingsService.update({
      notifications: { enabled: true, webhookUrl: 'https://hooks.example.com/x' },
    });
    await expect(notificationService.notifyContainerEvent('app', 'crashed')).resolves.toBeUndefined();
  });

  describe('sendTest', () => {
    it('posts regardless of the enabled/per-event settings', async () => {
      const fetchMock = mockFetchOk();
      await notificationService.sendTest({ webhookUrl: 'https://hooks.example.com/x', format: 'generic' });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('propagates a failure to the caller instead of swallowing it', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 500 })) as unknown as typeof fetch;
      await expect(
        notificationService.sendTest({ webhookUrl: 'https://hooks.example.com/x', format: 'generic' })
      ).rejects.toThrow('Webhook responded with 500');
    });
  });

  describe('ntfy channel', () => {
    it('does nothing when no topic is configured', async () => {
      const fetchMock = mockFetchOk();
      settingsService.update({ ntfy: { enabled: true } });
      await notificationService.notifyContainerEvent('app', 'crashed (exit code 1)');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('respects its own per-event toggle', async () => {
      const fetchMock = mockFetchOk();
      settingsService.update({ ntfy: { enabled: true, topic: 'challoupe', onContainerCrash: false } });
      await notificationService.notifyContainerEvent('app', 'crashed (exit code 1)');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts the plain-text message to <serverUrl>/<topic>, without auth when no username is set', async () => {
      const fetchMock = mockFetchOk();
      settingsService.update({ ntfy: { enabled: true, serverUrl: 'https://ntfy.example.com', topic: 'challoupe' } });
      await notificationService.notifyBackupFailure('disk full');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://ntfy.example.com/challoupe',
        expect.objectContaining({
          method: 'POST',
          body: 'Scheduled backup failed: disk full',
          headers: { Title: 'Challoupe' },
        })
      );
    });

    it('adds a Basic auth header when a username is configured', async () => {
      const fetchMock = mockFetchOk();
      settingsService.update({
        ntfy: { enabled: true, serverUrl: 'https://ntfy.example.com', topic: 'challoupe', username: 'admin', password: 'shh' },
      });
      await notificationService.notifyImageUpdates(1);
      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Basic ${Buffer.from('admin:shh').toString('base64')}`);
    });

    it('fires independently of the webhook channel: both, either, or neither', async () => {
      const fetchMock = mockFetchOk();
      settingsService.update({
        notifications: { enabled: true, webhookUrl: 'https://hooks.example.com/x' },
        ntfy: { enabled: true, topic: 'challoupe' },
      });
      await notificationService.notifyContainerEvent('app', 'crashed');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith('https://hooks.example.com/x', expect.anything());
      expect(fetchMock).toHaveBeenCalledWith('https://ntfy.sh/challoupe', expect.anything());
    });

    it('swallows an ntfy failure instead of throwing, independently of the webhook', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      settingsService.update({ ntfy: { enabled: true, topic: 'challoupe' } });
      await expect(notificationService.notifyContainerEvent('app', 'crashed')).resolves.toBeUndefined();
    });

    describe('sendNtfyTest', () => {
      it('posts regardless of the enabled/per-event settings', async () => {
        const fetchMock = mockFetchOk();
        await notificationService.sendNtfyTest({
          serverUrl: 'https://ntfy.sh',
          topic: 'challoupe',
          username: '',
          password: '',
        });
        expect(fetchMock).toHaveBeenCalledOnce();
      });

      it('propagates a failure to the caller instead of swallowing it', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 500 })) as unknown as typeof fetch;
        await expect(
          notificationService.sendNtfyTest({ serverUrl: 'https://ntfy.sh', topic: 'challoupe', username: '', password: '' })
        ).rejects.toThrow('ntfy responded with 500');
      });
    });
  });
});

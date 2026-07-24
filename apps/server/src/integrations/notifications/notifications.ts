import { settingsService, type NotificationFormat, type SettingsService } from '../../settings.js';

export interface WebhookTarget {
  webhookUrl: string;
  format: NotificationFormat;
}

export interface NtfyTarget {
  serverUrl: string;
  topic: string;
  username: string;
  password: string;
}

type NotificationKind = 'onContainerCrash' | 'onImageUpdate' | 'onBackupFailure' | 'onAuditAnomaly';

function buildPayload(format: NotificationFormat, message: string): unknown {
  if (format === 'discord') return { content: `**Challoupe** ${message}` };
  if (format === 'slack') return { text: `*Challoupe* ${message}` };
  return { source: 'challoupe', message };
}

/**
 * Posts container/image/backup events to an admin-configured webhook (Discord, Slack, or a
 * plain JSON endpoint) and/or a ntfy topic, for whichever kinds are turned on in Settings.
 */
export class NotificationService {
  constructor(private readonly settings: SettingsService) {}

  private async post(target: WebhookTarget, message: string): Promise<void> {
    const res = await fetch(target.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(target.format, message)),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Webhook responded with ${res.status}`);
  }

  private async postNtfy(target: NtfyTarget, message: string): Promise<void> {
    const url = `${target.serverUrl.replace(/\/+$/, '')}/${target.topic}`;
    const headers: Record<string, string> = { Title: 'Challoupe' };
    if (target.username) {
      headers.Authorization = `Basic ${Buffer.from(`${target.username}:${target.password}`).toString('base64')}`;
    }
    const res = await fetch(url, { method: 'POST', headers, body: message, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`ntfy responded with ${res.status}`);
  }

  private targetFor(kind: NotificationKind): WebhookTarget | null {
    const { notifications, notifyEvents } = this.settings.get();
    if (!notifications.enabled || !notifications.webhookUrl || !notifyEvents[kind]) return null;
    return { webhookUrl: notifications.webhookUrl, format: notifications.format };
  }

  private ntfyTargetFor(kind: NotificationKind): NtfyTarget | null {
    const { ntfy, notifyEvents } = this.settings.get();
    if (!ntfy.enabled || !ntfy.topic || !notifyEvents[kind]) return null;
    return { serverUrl: ntfy.serverUrl, topic: ntfy.topic, username: ntfy.username, password: ntfy.password };
  }

  private async send(kind: NotificationKind, message: string): Promise<void> {
    const webhook = this.targetFor(kind);
    if (webhook) {
      try {
        await this.post(webhook, message);
      } catch (err) {
        console.error('Failed to send notification webhook:', err);
      }
    }

    const ntfy = this.ntfyTargetFor(kind);
    if (ntfy) {
      try {
        await this.postNtfy(ntfy, message);
      } catch (err) {
        console.error('Failed to send ntfy notification:', err);
      }
    }
  }

  notifyContainerEvent(containerName: string, detail: string): Promise<void> {
    return this.send('onContainerCrash', `Container "${containerName}" ${detail}.`);
  }

  notifyImageUpdates(count: number): Promise<void> {
    return this.send('onImageUpdate', `${count} image update${count === 1 ? '' : 's'} available.`);
  }

  notifyBackupFailure(error: string): Promise<void> {
    return this.send('onBackupFailure', `Scheduled backup failed: ${error}`);
  }

  notifyAuditAnomaly(summary: string): Promise<void> {
    return this.send('onAuditAnomaly', `Audit log watchdog: ${summary}.`);
  }

  // Bypasses the enabled/per-event settings so a value can be tested before it's saved;
  // errors propagate so the caller can report failure.
  sendTest(target: WebhookTarget): Promise<void> {
    return this.post(target, 'Test notification from Challoupe.');
  }

  sendNtfyTest(target: NtfyTarget): Promise<void> {
    return this.postNtfy(target, 'Test notification from Challoupe.');
  }
}

export const notificationService = new NotificationService(settingsService);

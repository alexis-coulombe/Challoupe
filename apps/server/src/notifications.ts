import { settingsService, type NotificationFormat, type SettingsService } from './settings.js';

export interface WebhookTarget {
  webhookUrl: string;
  format: NotificationFormat;
}

type NotificationKind = 'onContainerCrash' | 'onImageUpdate' | 'onBackupFailure';

function buildPayload(format: NotificationFormat, message: string): unknown {
  if (format === 'discord') return { content: `**Challoupe** ${message}` };
  if (format === 'slack') return { text: `*Challoupe* ${message}` };
  return { source: 'challoupe', message };
}

/**
 * Posts container/image/backup events to an admin-configured webhook (Discord, Slack, or a
 * plain JSON endpoint), for whichever kinds are turned on in Settings.
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

  private targetFor(kind: NotificationKind): WebhookTarget | null {
    const { notifications } = this.settings.get();
    if (!notifications.enabled || !notifications.webhookUrl || !notifications[kind]) return null;
    return { webhookUrl: notifications.webhookUrl, format: notifications.format };
  }

  private async send(kind: NotificationKind, message: string): Promise<void> {
    const target = this.targetFor(kind);
    if (!target) return;
    try {
      await this.post(target, message);
    } catch (err) {
      console.error('Failed to send notification webhook:', err);
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

  // Bypasses the enabled/per-event settings so a value can be tested before it's saved;
  // errors propagate so the caller can report failure.
  sendTest(target: WebhookTarget): Promise<void> {
    return this.post(target, 'Test notification from Challoupe.');
  }
}

export const notificationService = new NotificationService(settingsService);

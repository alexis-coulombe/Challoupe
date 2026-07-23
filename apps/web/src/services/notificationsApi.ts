import { api } from '../api';
import type { NotificationFormat } from '../api';

export class NotificationsApi {
  test(webhookUrl: string, format: NotificationFormat) {
    return api.post<{ ok: true }>('/notifications/test', { webhookUrl, format });
  }
}

export const notificationsApi = new NotificationsApi();

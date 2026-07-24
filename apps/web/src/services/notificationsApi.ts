import { api } from '../api';
import type { NotificationFormat } from '../api';

export class NotificationsApi {
  test(webhookUrl: string, format: NotificationFormat) {
    return api.post<{ ok: true }>('/notifications/test', { webhookUrl, format });
  }

  testNtfy(serverUrl: string, topic: string, username: string, password: string) {
    return api.post<{ ok: true }>('/notifications/test-ntfy', { serverUrl, topic, username, password });
  }
}

export const notificationsApi = new NotificationsApi();

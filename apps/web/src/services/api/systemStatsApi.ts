import { api } from '../api';

export interface SystemStatsTokenStatus {
  configured: boolean;
  createdAt?: string;
}

export class SystemStatsApi {
  getToken() {
    return api.get<SystemStatsTokenStatus>('/system-stats-token');
  }

  regenerateToken() {
    return api.post<{ token: string }>('/system-stats-token');
  }

  revokeToken() {
    return api.delete('/system-stats-token');
  }
}

export const systemStatsApi = new SystemStatsApi();

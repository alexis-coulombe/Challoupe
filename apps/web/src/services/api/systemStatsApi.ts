import { api } from '../../api';

interface SystemStatsTokenStatus {
  configured: boolean;
  createdAt?: string;
}

class SystemStatsApi {
  /**
   * Get token
   * @returns Token response
   */
  getToken() {
    return api.get<SystemStatsTokenStatus>('/system-stats-token');
  }

  /**
   * Regenerate token
   * @returns Regenerate response
   */
  regenerateToken() {
    return api.post<{ token: string }>('/system-stats-token');
  }

  /**
   * Revoke token
   * @returns Revoke response
   */
  revokeToken() {
    return api.delete('/system-stats-token');
  }
}

export const systemStatsApi = new SystemStatsApi();

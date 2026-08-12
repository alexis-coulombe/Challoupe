import { api } from '../../api';
import type { AuditLogEntry } from '../../models/AuditLogEntry';

class AuditLogApi {
  /**
   * Get audit logs list
   * @returns Audit logs list
   */
  list() {
    return api.get<AuditLogEntry[]>('/audit-log');
  }

  /**
   * Delete all audit logs
   * @returns void
   */
  clear() {
    return api.delete<void>('/audit-log');
  }
}

export const auditLogApi = new AuditLogApi();

import { api } from '../api';
import type { AuditLogEntry } from '../api';

export class AuditLogApi {
  list() {
    return api.get<AuditLogEntry[]>('/audit-log');
  }

  clear() {
    return api.delete<void>('/audit-log');
  }
}

export const auditLogApi = new AuditLogApi();

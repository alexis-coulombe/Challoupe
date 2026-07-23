import { api } from '../api';
import type { AuditLogEntry } from '../api';

export class AuditLogApi {
  list() {
    return api.get<AuditLogEntry[]>('/audit-log');
  }
}

export const auditLogApi = new AuditLogApi();

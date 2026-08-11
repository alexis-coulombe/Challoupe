import { api } from '../api';
import type { BackupFile, ScheduledBackupFile } from '../api';

export class BackupApi {
  restore(data: BackupFile) {
    return api.post('/backup/restore', data);
  }

  listScheduled() {
    return api.get<ScheduledBackupFile[]>('/backup/scheduled');
  }

  runScheduled() {
    return api.post<{ filename: string }>('/backup/scheduled/run');
  }

  removeScheduled(filename: string) {
    return api.delete(`/backup/scheduled/${filename}`);
  }
}

export const backupApi = new BackupApi();

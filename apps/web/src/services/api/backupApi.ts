import { api } from '../../api';
import type { BackupFile } from '../../models/BackupFile';

export interface ScheduledBackupFile {
  filename: string;
  size: number;
  createdAt: string;
}

class BackupApi {
  /**
   * Restore backup from file
   * @param data BackupFile
   * @returns 
   */
  restore(data: BackupFile) {
    return api.post('/backup/restore', data);
  }

  /**
   * List all scheduled backups
   * @returns Schedules backups
   */
  listScheduled() {
    return api.get<ScheduledBackupFile[]>('/backup/scheduled');
  }

  /**
   * Run a scheduled backup
   * @returns Schedule backup response
   */
  runScheduled() {
    return api.post<{ filename: string }>('/backup/scheduled/run');
  }

  /**
   * Remove a schedules backup
   * @param filename string
   * @returns void
   */
  removeScheduled(filename: string) {
    return api.delete(`/backup/scheduled/${filename}`);
  }
}

export const backupApi = new BackupApi();

export interface BackupFile {
  version: 1;
  exportedAt: string;
  settings: Array<{ key: string; value: string }>;
  users: Array<Record<string, unknown>>;
  stacks: Array<{ name: string; compose: string }>;
}

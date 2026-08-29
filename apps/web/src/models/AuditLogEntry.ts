export interface AuditLogEntry {
  id: number;
  created_at: string;
  user_id: number | null;
  username: string;
  action: string;
  target: string | null;
  detail: string | null;
  status: 'success' | 'failure';
  ip: string | null;
}

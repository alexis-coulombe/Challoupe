export interface HostSummary {
  id: number;
  name: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  hasPassphrase: boolean;
  createdAt: string;
}

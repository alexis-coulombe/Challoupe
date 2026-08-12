export interface HostFormValues {
  name: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPrivateKey: string;
  sshPassphrase?: string;
}

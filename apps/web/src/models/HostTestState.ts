export interface HostTestState {
  status: 'idle' | 'testing' | 'ok' | 'error';
  error?: string;
}

export interface StackSummary {
  name: string;
  services: number;
  running: number;
  status: 'running' | 'partial' | 'stopped' | 'inactive';
  drifted: boolean;
}

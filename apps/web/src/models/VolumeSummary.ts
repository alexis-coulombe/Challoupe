export interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint: string;
  created: string | null;
  labels: Record<string, string>;
}

export interface ImageSummary {
  id: string;
  tags: string[];
  size: number;
  created: number;
  containers: number;
  updateAvailable: boolean | null;
  updateCheckedAt: string | null;
}

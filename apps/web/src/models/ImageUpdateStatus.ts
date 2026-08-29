export interface ImageUpdateStatus {
  reference: string;
  updateAvailable: boolean | null;
  checkedAt: string;
  error?: string;
}

export interface NetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnet: string | null;
}

import { api } from '../../api';
import type { TrivySeverity } from '../../models/TrivySeverity';

interface TrivyVulnerability {
  id: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion: string;
  severity: TrivySeverity;
  title: string;
  url: string;
}

interface TrivyScanResult {
  image: string;
  scannedAt: string;
  counts: Record<TrivySeverity, number>;
  vulnerabilities: TrivyVulnerability[];
}

class TrivyApi {
  /**
   * Scan for Trivy vulnerabilities
   * @param image string
   * @returns Scan response
   */
  scan(image: string) {
    return api.post<TrivyScanResult>('/trivy/scan', { image });
  }
}

export const trivyApi = new TrivyApi();

import { PassThrough } from 'node:stream';
import { mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { docker, pullImage } from './docker.js';
import { TRIVY_CACHE_DIR, DOCKER_SOCK } from './config.js';

function trivyRunAsUser(): string | undefined {
  if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') return undefined;
  try {
    return `${process.getuid()}:${statSync(DOCKER_SOCK).gid}`;
  } catch {
    return undefined;
  }
}

export type TrivySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface TrivyVulnerability {
  id: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion: string;
  severity: TrivySeverity;
  title: string;
  url: string;
}

export interface TrivyScanResult {
  image: string;
  scannedAt: string;
  counts: Record<TrivySeverity, number>;
  vulnerabilities: TrivyVulnerability[];
}

interface RawTrivyVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: TrivySeverity;
  Title?: string;
  PrimaryURL?: string;
}

interface RawTrivyOutput {
  Results?: Array<{ Vulnerabilities?: RawTrivyVulnerability[] }>;
}

// Comfortably above any real scan's output
const MAX_COLLECT_BYTES = 50 * 1024 * 1024;

/**
 * Collect Trivy output
 * @param stream PassThrough
 * @returns string
 */
function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_COLLECT_BYTES) {
        stream.destroy();
        reject(new Error(`Trivy produced more than ${MAX_COLLECT_BYTES / (1024 * 1024)}MB of output`));
        return;
      }
      data += chunk.toString('utf8');
    });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

/**
 * Ensure that the Trivy image is pulled
 * @param reference 
 */
async function ensureImagePulled(reference: string): Promise<void> {
  try {
    await docker.getImage(reference).inspect();
  } catch {
    await pullImage(reference);
  }
}

const SEVERITY_ORDER: TrivySeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

/**
 * Scan the reference image with Trivy
 * @param imageRef string
 * @param trivyImage string
 * @returns TrivyScanResult
 */
export async function scanImage(imageRef: string, trivyImage: string): Promise<TrivyScanResult> {
  await mkdir(TRIVY_CACHE_DIR, { recursive: true });
  await ensureImagePulled(trivyImage);

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutPromise = collect(stdout);
  const stderrPromise = collect(stderr);

  const [result] = await docker.run(
    trivyImage,
    ['image', '--format', 'json', '--quiet', '--scanners', 'vuln', '--', imageRef],
    [stdout, stderr],
    {
      Tty: false,
      Env: ['TRIVY_CACHE_DIR=/trivy-cache', `DOCKER_HOST=unix://${DOCKER_SOCK}`],
      User: trivyRunAsUser(),
      HostConfig: {
        Binds: [`${DOCKER_SOCK}:${DOCKER_SOCK}`, `${TRIVY_CACHE_DIR}:/trivy-cache`],
        AutoRemove: true,
      },
    }
  );

  const [output, errorOutput] = await Promise.all([stdoutPromise, stderrPromise]);
  if (result.StatusCode !== 0) {
    throw new Error(errorOutput.trim().slice(-300) || `Trivy exited with code ${result.StatusCode}`);
  }

  const parsed = JSON.parse(output) as RawTrivyOutput;
  const vulnerabilities: TrivyVulnerability[] = [];
  for (const target of parsed.Results ?? []) {
    for (const v of target.Vulnerabilities ?? []) {
      vulnerabilities.push({
        id: v.VulnerabilityID,
        pkgName: v.PkgName,
        installedVersion: v.InstalledVersion,
        fixedVersion: v.FixedVersion ?? '',
        severity: v.Severity,
        title: v.Title ?? '',
        url: v.PrimaryURL ?? '',
      });
    }
  }
  vulnerabilities.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  const counts: Record<TrivySeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const v of vulnerabilities) counts[v.severity]++;

  return {
    image: imageRef,
    scannedAt: new Date().toISOString(),
    counts,
    vulnerabilities,
  };
}

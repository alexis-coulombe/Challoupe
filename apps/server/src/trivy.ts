import { PassThrough } from 'node:stream';
import { mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { docker, pullImage } from './docker.js';
import { TRIVY_CACHE_DIR, DOCKER_SOCK } from './config.js';

// Run the scanner as the same uid as this process, but with the docker socket's own gid —
// the same trick that lets a non-root host user reach /var/run/docker.sock via the "docker"
// group. Without this Trivy (which defaults to root) leaves root-owned files in the bind-mounted
// cache dir, which this process then can't ever clean up itself.
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

// Comfortably above any real scan's output (even a very vulnerable image's JSON report is
// a few MB at most) — just a backstop against a misconfigured/compromised Trivy image
// writing unbounded data to stdout/stderr and growing server memory without limit.
const MAX_COLLECT_BYTES = 50 * 1024 * 1024;

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

async function ensureImagePulled(reference: string): Promise<void> {
  try {
    await docker.getImage(reference).inspect();
  } catch {
    await pullImage(reference);
  }
}

const SEVERITY_ORDER: TrivySeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

export async function scanImage(imageRef: string, trivyImage: string): Promise<TrivyScanResult> {
  await mkdir(TRIVY_CACHE_DIR, { recursive: true });
  await ensureImagePulled(trivyImage);

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutPromise = collect(stdout);
  const stderrPromise = collect(stderr);

  const [result] = await docker.run(
    trivyImage,
    // The `--` separator is defense-in-depth: it tells Trivy's (cobra/pflag-based) CLI parser
    // that nothing after it is a flag, in case an unvalidated value ever reaches this call
    // — the route-level zod regex is the primary defense (see validators.ts's IMAGE_REF_RE).
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

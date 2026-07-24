import type { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDocker = { run: vi.fn(), getImage: vi.fn() };
const mockPullImage = vi.fn();

vi.mock('../../../src/docker.js', () => ({
  docker: mockDocker,
  pullImage: mockPullImage,
}));

const { scanImage } = await import('../../../src/integrations/trivy/trivy.js');

function trivyOutput(vulnerabilities: unknown[]): string {
  return JSON.stringify({ Results: [{ Vulnerabilities: vulnerabilities }] });
}

function mockRun(stdoutData: string, stderrData: string, statusCode = 0): void {
  mockDocker.run.mockImplementation(async (_image: string, _cmd: string[], streams: PassThrough[]) => {
    streams[0].end(stdoutData);
    streams[1].end(stderrData);
    return [{ StatusCode: statusCode }];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scanImage', () => {
  it('pulls the trivy image when not present locally, then parses the scan result', async () => {
    mockDocker.getImage.mockReturnValue({ inspect: vi.fn().mockRejectedValue(new Error('no such image')) });
    mockRun(
      trivyOutput([
        {
          VulnerabilityID: 'CVE-2024-1',
          PkgName: 'openssl',
          InstalledVersion: '1.0',
          FixedVersion: '1.1',
          Severity: 'CRITICAL',
          Title: 'bad',
          PrimaryURL: 'http://example.com/CVE-2024-1',
        },
        { VulnerabilityID: 'CVE-2024-2', PkgName: 'libc', InstalledVersion: '2.0', Severity: 'LOW' },
      ]),
      ''
    );

    const result = await scanImage('nginx:alpine', 'aquasec/trivy:latest');

    expect(mockPullImage).toHaveBeenCalledWith(expect.anything(), 'aquasec/trivy:latest');
    expect(result.image).toBe('nginx:alpine');
    expect(result.counts).toEqual({ CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 1, UNKNOWN: 0 });
    expect(result.vulnerabilities[0]).toEqual({
      id: 'CVE-2024-1',
      pkgName: 'openssl',
      installedVersion: '1.0',
      fixedVersion: '1.1',
      severity: 'CRITICAL',
      title: 'bad',
      url: 'http://example.com/CVE-2024-1',
    });
    expect(result.vulnerabilities[1].fixedVersion).toBe('');
  });

  it('skips pulling when the trivy image is already present locally', async () => {
    mockDocker.getImage.mockReturnValue({ inspect: vi.fn().mockResolvedValue({}) });
    mockRun(trivyOutput([]), '');

    await scanImage('nginx:alpine', 'aquasec/trivy:latest');

    expect(mockPullImage).not.toHaveBeenCalled();
  });

  it('sorts vulnerabilities from most to least severe', async () => {
    mockDocker.getImage.mockReturnValue({ inspect: vi.fn().mockResolvedValue({}) });
    mockRun(
      trivyOutput([
        { VulnerabilityID: 'low-one', PkgName: 'a', InstalledVersion: '1', Severity: 'LOW' },
        { VulnerabilityID: 'crit-one', PkgName: 'b', InstalledVersion: '1', Severity: 'CRITICAL' },
        { VulnerabilityID: 'high-one', PkgName: 'c', InstalledVersion: '1', Severity: 'HIGH' },
      ]),
      ''
    );

    const result = await scanImage('nginx:alpine', 'aquasec/trivy:latest');

    expect(result.vulnerabilities.map((v) => v.id)).toEqual(['crit-one', 'high-one', 'low-one']);
  });

  it('passes a "--" separator before the image reference, so it can never be read as a CLI flag', async () => {
    mockDocker.getImage.mockReturnValue({ inspect: vi.fn().mockResolvedValue({}) });
    mockRun(trivyOutput([]), '');

    await scanImage('nginx:alpine', 'aquasec/trivy:latest');

    const args = mockDocker.run.mock.calls[0][1] as string[];
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('nginx:alpine');
  });

  it('throws using the trivy stderr output when the scan exits non-zero', async () => {
    mockDocker.getImage.mockReturnValue({ inspect: vi.fn().mockResolvedValue({}) });
    mockRun('', 'image not found: nginx:doesnotexist', 1);

    await expect(scanImage('nginx:doesnotexist', 'aquasec/trivy:latest')).rejects.toThrow(
      'image not found: nginx:doesnotexist'
    );
  });
});

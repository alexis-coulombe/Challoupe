// Builds a same-origin ws:// or wss:// URL, matching the page's protocol.
export function wsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws${path}`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (res.status === 401 && !path.startsWith('/auth')) {
    window.location.href = '/login';
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export const PERMISSIONS = [
  'manageContainers',
  'manageImages',
  'manageVolumes',
  'manageNetworks',
  'manageStacks',
  'exec',
  'useAi',
  'useSecurityScanner',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Permissions = Record<Permission, boolean>;

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  created_at: string;
  authProvider: 'local' | 'oidc';
  permissions: Permissions;
  totpEnabled: boolean;
}

export function hasPermission(user: User | null | undefined, permission: Permission): boolean {
  return user?.role === 'admin' || !!user?.permissions[permission];
}

export interface AuthStatus {
  setupRequired: boolean;
  user: User | null;
}

export interface LoginResult {
  user?: User;
  requiresTotp?: boolean;
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface ContainerPort {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  ports: ContainerPort[];
  composeProject: string | null;
  updateAvailable: boolean | null;
}

export interface ImageSummary {
  id: string;
  tags: string[];
  size: number;
  created: number;
  containers: number;
  updateAvailable: boolean | null;
  updateCheckedAt: string | null;
}

export interface ImageUpdateStatus {
  reference: string;
  updateAvailable: boolean | null;
  checkedAt: string;
  error?: string;
}

export interface ImageUpdateCheckSummary {
  checked: number;
  updatesAvailable: number;
  errors: string[];
}

export interface GitBuildRequest {
  repoUrl: string;
  ref?: string;
  subdir?: string;
  dockerfile?: string;
  tag: string;
  buildArgs?: string[];
}

export interface GitBuildResult {
  ok: boolean;
  tag: string;
  log: string;
  error?: string;
}

export interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint: string;
  created: string | null;
  labels: Record<string, string>;
}

export interface NetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnet: string | null;
}

export interface StackSummary {
  name: string;
  services: number;
  running: number;
  status: 'running' | 'partial' | 'stopped' | 'inactive';
  drifted: boolean;
}

export interface ComposeResult {
  ok: boolean;
  output: string;
}

export interface StackDriftResult {
  inSync: boolean;
  missingServices: string[];
  orphanedContainers: Array<{ id: string; name: string; service: string | null }>;
  imageMismatches: Array<{ service: string; expectedImage: string; actualImage: string }>;
}

export interface SystemInfo {
  name: string;
  containers: number;
  containersRunning: number;
  containersPaused: number;
  containersStopped: number;
  images: number;
  serverVersion: string;
  apiVersion: string;
  os: string;
  kernel: string;
  arch: string;
  cpus: number;
  memory: number;
  cpuPercent: number;
  memoryUsed: number;
  memoryPercent: number;
  storageUsed: number;
  storageTotal: number;
  storagePercent: number;
  dockerSock: string;
  dataDir: string;
}

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure';
export type TerminalShell = '/bin/bash' | '/bin/sh' | '/bin/ash';

export interface FeatureFlags {
  aiAssistant: boolean;
  vulnerabilityScanner: boolean;
  auditLog: boolean;
}

export interface ImageUpdateCheckSettings {
  enabled: boolean;
  intervalHours: number;
}

export interface ScheduledBackupSettings {
  enabled: boolean;
  intervalHours: number;
  keepCount: number;
}

// clientSecret is always returned blank by the API — see routes/settings.ts. providerId is
// a UI-only hint (which preset template was picked in Settings) — the server never reads it.
export interface OidcSettings {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  providerId: string;
}

export interface PortainerStackRef {
  id: number;
  name: string;
  endpointId: number;
}

export interface AppSettings {
  defaultRestartPolicy: RestartPolicy;
  refreshIntervalMs: number;
  defaultLogTail: number;
  defaultTerminalShell: TerminalShell;
  ollamaBaseUrl: string;
  ollamaModel: string;
  trivyImage: string;
  maxContainerMemoryMb: number | null;
  maxContainerCpus: number | null;
  featureFlags: FeatureFlags;
  oidc: OidcSettings;
  imageUpdateCheck: ImageUpdateCheckSettings;
  scheduledBackup: ScheduledBackupSettings;
}

export interface OidcLoginConfig {
  enabled: boolean;
  buttonLabel: string;
}

export interface BackupFile {
  version: 1;
  exportedAt: string;
  settings: Array<{ key: string; value: string }>;
  users: Array<Record<string, unknown>>;
  stacks: Array<{ name: string; compose: string }>;
}

export interface ScheduledBackupFile {
  filename: string;
  size: number;
  createdAt: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

export interface StatsSample {
  timestamp: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
}

export interface AuditLogEntry {
  id: number;
  created_at: string;
  user_id: number | null;
  username: string;
  action: string;
  target: string | null;
  detail: string | null;
  status: 'success' | 'failure';
  ip: string | null;
}

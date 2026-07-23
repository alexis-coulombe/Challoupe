import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { STACKS_DIR } from './config.js';
import { docker } from './docker.js';
import { computeStackDrift, type StackDriftResult } from './stackDrift.js';

const execFileAsync = promisify(execFile);

export const STACK_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

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

function stackDir(name: string): string {
  return path.join(STACKS_DIR, name);
}

export function composePath(name: string): string {
  return path.join(stackDir(name), 'docker-compose.yml');
}

export async function stackExists(name: string): Promise<boolean> {
  try {
    await fs.access(composePath(name));
    return true;
  } catch {
    return false;
  }
}

export async function listStackNames(): Promise<string[]> {
  await fs.mkdir(STACKS_DIR, { recursive: true });
  const entries = await fs.readdir(STACKS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && STACK_NAME_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

export async function listStacks(): Promise<StackSummary[]> {
  const names = await listStackNames();
  const containers = await docker.listContainers({ all: true });
  return Promise.all(
    names.map(async (name) => {
      const own = containers.filter((c) => c.Labels['com.docker.compose.project'] === name);
      const running = own.filter((c) => c.State === 'running').length;
      const status: StackSummary['status'] =
        own.length === 0
          ? 'inactive'
          : running === own.length
            ? 'running'
            : running === 0
              ? 'stopped'
              : 'partial';
      // A stack that's never been deployed isn't "drifted"
      let drifted = false;
      if (own.length > 0) {
        try {
          drifted = !computeStackDrift(await readStack(name), own).inSync;
        } catch {
          // Compose file unreadable mid-listing
        }
      }
      return { name, services: own.length, running, status, drifted };
    })
  );
}

export async function readStack(name: string): Promise<string> {
  return fs.readFile(composePath(name), 'utf8');
}

/**
 * Get stack drift of specified stack
 * @param name string
 * @returns StackDriftResult
 */
export async function getStackDrift(name: string): Promise<StackDriftResult> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${name}`] },
  });

  if (containers.length === 0) {
    return { inSync: true, missingServices: [], orphanedContainers: [], imageMismatches: [] };
  }
  return computeStackDrift(await readStack(name), containers);
}

/**
 * Create stack
 * @param name string
 * @param compose string
 */
export async function writeStack(name: string, compose: string): Promise<void> {
  const parsed: unknown = YAML.parse(compose);
  if (!parsed || typeof parsed !== 'object' || !('services' in parsed)) {
    throw Object.assign(new Error('The compose file must define at least "services"'), {
      statusCode: 400,
    });
  }
  await fs.mkdir(stackDir(name), { recursive: true });
  await fs.writeFile(composePath(name), compose, 'utf8');
}

async function compose(name: string, args: string[]): Promise<ComposeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'docker',
      ['compose', '-p', name, '-f', composePath(name), ...args],
      { timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }
    );
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: ((e.stdout ?? '') + (e.stderr ?? '')).trim() || e.message || String(err),
    };
  }
}

export function deployStack(name: string): Promise<ComposeResult> {
  return compose(name, ['up', '-d', '--remove-orphans']);
}

export function downStack(name: string): Promise<ComposeResult> {
  return compose(name, ['down']);
}

export async function deleteStack(name: string): Promise<void> {
  await downStack(name); // best effort: ignore failure if the stack never ran
  await fs.rm(stackDir(name), { recursive: true, force: true });
}

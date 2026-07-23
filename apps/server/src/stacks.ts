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

/**
 * Filesystem + `docker compose` operations for a stack (a docker-compose.yml under
 * STACKS_DIR), plus the drift/summary views built on top of them.
 */
export class StackService {
  private stackDir(name: string): string {
    return path.join(STACKS_DIR, name);
  }

  composePath(name: string): string {
    return path.join(this.stackDir(name), 'docker-compose.yml');
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.access(this.composePath(name));
      return true;
    } catch {
      return false;
    }
  }

  async listNames(): Promise<string[]> {
    await fs.mkdir(STACKS_DIR, { recursive: true });
    const entries = await fs.readdir(STACKS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && STACK_NAME_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  async list(): Promise<StackSummary[]> {
    const names = await this.listNames();
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
            drifted = !computeStackDrift(await this.read(name), own).inSync;
          } catch {
            // Compose file unreadable mid-listing
          }
        }
        return { name, services: own.length, running, status, drifted };
      })
    );
  }

  async read(name: string): Promise<string> {
    return fs.readFile(this.composePath(name), 'utf8');
  }

  /**
   * Get stack drift of specified stack
   * @param name string
   * @returns StackDriftResult
   */
  async drift(name: string): Promise<StackDriftResult> {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [`com.docker.compose.project=${name}`] },
    });

    if (containers.length === 0) {
      return { inSync: true, missingServices: [], orphanedContainers: [], imageMismatches: [] };
    }
    return computeStackDrift(await this.read(name), containers);
  }

  /**
   * Create stack
   * @param name string
   * @param compose string
   */
  async write(name: string, compose: string): Promise<void> {
    const parsed: unknown = YAML.parse(compose);
    if (!parsed || typeof parsed !== 'object' || !('services' in parsed)) {
      throw Object.assign(new Error('The compose file must define at least "services"'), {
        statusCode: 400,
      });
    }
    await fs.mkdir(this.stackDir(name), { recursive: true });
    await fs.writeFile(this.composePath(name), compose, 'utf8');
  }

  private async compose(name: string, args: string[]): Promise<ComposeResult> {
    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['compose', '-p', name, '-f', this.composePath(name), ...args],
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

  deploy(name: string): Promise<ComposeResult> {
    return this.compose(name, ['up', '-d', '--remove-orphans']);
  }

  down(name: string): Promise<ComposeResult> {
    return this.compose(name, ['down']);
  }

  async delete(name: string): Promise<void> {
    await this.down(name); // best effort: ignore failure if the stack never ran
    await fs.rm(this.stackDir(name), { recursive: true, force: true });
  }
}

export const stackService = new StackService();

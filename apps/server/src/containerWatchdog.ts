import { docker, demuxLogs } from './docker.js';
import { settingsService } from './settings.js';
import { ollamaChat } from './integrations/ollama/ollama.js';

const LOG_TAIL_LINES = 200;
const LOG_CHAR_LIMIT = 6000;

// Bounds how often a single container gets a fresh AI look: a crash-looping container
// would otherwise trigger a full Ollama call on every single restart.
const COOLDOWN_MS = 15 * 60 * 1000;

export class ContainerWatchdog {
  private readonly lastCheckedAt = new Map<string, number>();

  private onCooldown(containerId: string): boolean {
    const last = this.lastCheckedAt.get(containerId);
    return last !== undefined && Date.now() - last < COOLDOWN_MS;
  }

  async diagnose(containerId: string, containerName: string, detail: string): Promise<string | null> {
    if (this.onCooldown(containerId)) return null;
    this.lastCheckedAt.set(containerId, Date.now());

    const { ollamaBaseUrl, ollamaModel } = settingsService.get();
    if (!ollamaModel) return null;

    try {
      const container = docker.getContainer(containerId);
      const info = await container.inspect();
      const raw = (await container.logs({ follow: false, stdout: true, stderr: true, tail: LOG_TAIL_LINES })) as unknown as Buffer;
      const text = info.Config.Tty ? raw.toString('utf8') : demuxLogs(raw);

      const prompt = `You are monitoring self-hosted Docker containers for problems. Container "${containerName}" (image ${info.Config.Image}) just ${detail}. It has restarted ${info.RestartCount} time(s).

Recent logs:
\`\`\`
${text.slice(-LOG_CHAR_LIMIT) || '(no log output)'}
\`\`\`

Respond with exactly "OK" if this looks like a normal or expected stop or "ISSUE: <one concise sentence>" if the logs point to a real problem worth a human's attention. Don't invent a problem that isn't shown in the logs.`;

      const reply = (await ollamaChat(ollamaBaseUrl, ollamaModel, [{ role: 'user', content: prompt }])).trim();
      const match = /^issue:\s*(.+)/is.exec(reply);
      return match ? match[1].trim() : null;
    } catch (err) {
      console.error(`Container watchdog check failed for ${containerName}:`, err);
      return null;
    }
  }
}

export const containerWatchdog = new ContainerWatchdog();

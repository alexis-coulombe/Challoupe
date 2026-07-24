import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInspect = vi.fn();
const mockLogs = vi.fn();
const mockGetContainer = vi.fn(() => ({ inspect: mockInspect, logs: mockLogs }));

vi.mock('../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/docker.js')>();
  return { ...actual, docker: { getContainer: mockGetContainer } };
});

const mockOllamaChat = vi.fn();
vi.mock('../src/integrations/ollama/ollama.js', () => ({ ollamaChat: mockOllamaChat }));

const { db } = await import('../src/db.js');
const { settingsService } = await import('../src/settings.js');
const { ContainerWatchdog } = await import('../src/containerWatchdog.js');

beforeEach(() => {
  db.exec('DELETE FROM settings');
  vi.clearAllMocks();
  mockInspect.mockResolvedValue({ Config: { Tty: true, Image: 'nginx:alpine' }, RestartCount: 0 });
  mockLogs.mockResolvedValue(Buffer.from('some log output'));
});

describe('ContainerWatchdog', () => {
  it('returns null when no Ollama model is configured', async () => {
    const watchdog = new ContainerWatchdog();
    const result = await watchdog.diagnose('abc', 'app', 'crashed (exit code 1)');
    expect(result).toBeNull();
    expect(mockOllamaChat).not.toHaveBeenCalled();
  });

  it('returns null when the model says things look OK', async () => {
    settingsService.update({ ollamaModel: 'llama3.1' });
    mockOllamaChat.mockResolvedValue('OK');
    const watchdog = new ContainerWatchdog();
    expect(await watchdog.diagnose('abc', 'app', 'crashed (exit code 1)')).toBeNull();
  });

  it('returns the one-sentence summary when the model flags an issue', async () => {
    settingsService.update({ ollamaModel: 'llama3.1' });
    mockOllamaChat.mockResolvedValue('ISSUE: the database connection string is invalid');
    const watchdog = new ContainerWatchdog();
    expect(await watchdog.diagnose('abc', 'app', 'crashed (exit code 1)')).toBe(
      'the database connection string is invalid'
    );
  });

  it('does not re-check the same container again within the cooldown window', async () => {
    settingsService.update({ ollamaModel: 'llama3.1' });
    mockOllamaChat.mockResolvedValue('ISSUE: bad config');
    const watchdog = new ContainerWatchdog();
    await watchdog.diagnose('abc', 'app', 'crashed (exit code 1)');
    const second = await watchdog.diagnose('abc', 'app', 'crashed again (exit code 1)');
    expect(second).toBeNull();
    expect(mockOllamaChat).toHaveBeenCalledOnce();
  });

  it("checks a different container independently of another one's cooldown", async () => {
    settingsService.update({ ollamaModel: 'llama3.1' });
    mockOllamaChat.mockResolvedValue('ISSUE: bad config');
    const watchdog = new ContainerWatchdog();
    await watchdog.diagnose('abc', 'app', 'crashed (exit code 1)');
    expect(await watchdog.diagnose('xyz', 'worker', 'crashed (exit code 1)')).toBe('bad config');
  });

  it('swallows an Ollama failure and returns null instead of throwing', async () => {
    settingsService.update({ ollamaModel: 'llama3.1' });
    mockOllamaChat.mockRejectedValue(new Error('connection refused'));
    const watchdog = new ContainerWatchdog();
    await expect(watchdog.diagnose('abc', 'app', 'crashed (exit code 1)')).resolves.toBeNull();
  });

  it('swallows a missing/removed container and returns null instead of throwing', async () => {
    settingsService.update({ ollamaModel: 'llama3.1' });
    mockInspect.mockRejectedValue(new Error('no such container'));
    const watchdog = new ContainerWatchdog();
    await expect(watchdog.diagnose('abc', 'app', 'crashed (exit code 1)')).resolves.toBeNull();
  });
});

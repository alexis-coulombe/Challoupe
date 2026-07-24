import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOllamaModels, streamOllamaChat } from '../../../src/integrations/ollama/ollama.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('listOllamaModels', () => {
  it('returns model names from /api/tags', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'llama3.1' }, { name: 'mistral' }] }), { status: 200 })
    ) as unknown as typeof fetch;

    const models = await listOllamaModels('http://localhost:11434');
    expect(models).toEqual(['llama3.1', 'mistral']);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('strips a trailing slash from the configured base URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 })) as unknown as typeof fetch;
    await listOllamaModels('http://localhost:11434/');
    expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.anything());
  });

  it('throws when Ollama is unreachable or errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(listOllamaModels('http://localhost:11434')).rejects.toThrow('500');
  });
});

describe('streamOllamaChat', () => {
  it('yields assistant tokens from newline-delimited JSON chunks', async () => {
    const body = ['{"message":{"content":"Hel"}}\n', '{"message":{"content":"lo"}}\n', '{"done":true}\n'].join('');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body, { status: 200 })) as unknown as typeof fetch;

    const tokens: string[] = [];
    for await (const token of streamOllamaChat('http://localhost:11434', 'llama3.1', [
      { role: 'user', content: 'hi' },
    ])) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['Hel', 'lo']);
  });

  it('throws if Ollama responds with an error status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 })) as unknown as typeof fetch;
    const iterate = async () => {
      for await (const _ of streamOllamaChat('http://localhost:11434', 'missing-model', [])) {
        // draining the generator
      }
    };
    await expect(iterate()).rejects.toThrow('404');
  });
});

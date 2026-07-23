export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * List ollama models from url
 * @param baseUrl string
 * @returns string[]
 */
export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${trimBaseUrl(baseUrl)}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) {
    throw new Error(`Ollama responded with ${res.status}`);
  }

  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}

// Bounds how long a chat stream can run before we give up on it
const CHAT_STREAM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Streams assistant tokens as they arrive from Ollama's newline-delimited-JSON chat endpoint.
 * @param baseUrl string
 * @param model string
 * @param messages OllamaChatMessage[]
 * @returns string
 */
export async function* streamOllamaChat(
  baseUrl: string,
  model: string,
  messages: OllamaChatMessage[]
): AsyncGenerator<string> {
  const res = await fetch(`${trimBaseUrl(baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(CHAT_STREAM_TIMEOUT_MS),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama responded with ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    
    if (done) {
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
      if (parsed.error) {
        throw new Error(parsed.error);
      }

      if (parsed.message?.content) {
        yield parsed.message.content;
      }

      if (parsed.done) {
        return;
      }
    }
  }
}

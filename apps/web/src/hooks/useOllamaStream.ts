import { useCallback, useEffect, useRef, useState } from 'react';
import { wsUrl } from '../api';

export type OllamaStreamStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error';

// Drives a one-shot Ollama response over WebSocket: connect, optionally send an initial
// message, accumulate streamed tokens into `text`. Used for log diagnosis and stack
// generation — each is a single request/response per connection.
export function useOllamaStream() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<OllamaStreamStatus>('idle');
  const [error, setError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  const start = useCallback((path: string, initialMessage?: unknown) => {
    wsRef.current?.close();
    setText('');
    setError('');
    setStatus('connecting');

    const ws = new WebSocket(wsUrl(path));
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('streaming');
      if (initialMessage !== undefined) ws.send(JSON.stringify(initialMessage));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: string; content?: string; message?: string };
      if (msg.type === 'token') setText((t) => t + (msg.content ?? ''));
      else if (msg.type === 'done') setStatus('done');
      else if (msg.type === 'error') {
        setError(msg.message ?? 'Unknown error');
        setStatus('error');
      }
    };
    ws.onerror = () => setStatus((s) => (s === 'done' ? s : 'error'));
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  return { text, status, error, start };
}

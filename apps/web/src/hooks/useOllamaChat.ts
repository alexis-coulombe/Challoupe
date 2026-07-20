import { useCallback, useEffect, useRef, useState } from 'react';
import { wsUrl, type AiChatMessage } from '../api';

// Drives the multi-turn AI assistant chat: keeps a single WebSocket open across turns
// (unlike useOllamaStream's one-shot connections) so conversation context is cheap to
// continue — the server re-sends full history each turn, the socket just avoids the
// reconnect round-trip.
export function useOllamaChat() {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesRef = useRef<AiChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => () => wsRef.current?.close(), []);

  const attach = useCallback((ws: WebSocket) => {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: string; content?: string; message?: string };
      if (msg.type === 'token') {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + (msg.content ?? '') };
          return next;
        });
      } else if (msg.type === 'done') {
        setStreaming(false);
      } else if (msg.type === 'error') {
        setError(msg.message ?? 'Unknown error');
        setStreaming(false);
      }
    };
    ws.onerror = () => setStreaming(false);
  }, []);

  const send = useCallback(
    (text: string) => {
      setError('');
      setStreaming(true);
      const history = [...messagesRef.current, { role: 'user' as const, content: text }];
      setMessages([...history, { role: 'assistant' as const, content: '' }]);

      const existing = wsRef.current;
      if (existing && existing.readyState === WebSocket.OPEN) {
        existing.send(JSON.stringify({ type: 'message', messages: history }));
        return;
      }
      const ws = new WebSocket(wsUrl('/ai/chat'));
      wsRef.current = ws;
      attach(ws);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'message', messages: history }));
    },
    [attach]
  );

  const reset = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setMessages([]);
    setError('');
    setStreaming(false);
  }, []);

  return { messages, streaming, error, send, reset };
}

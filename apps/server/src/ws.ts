import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type Dockerode from 'dockerode';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { authenticateUpgrade } from './wsAuth.js';
import { hasPermission } from './auth.js';
import { LogDemuxer, demuxLogs, docker, summarizeStats } from './docker.js';
import { dockerEventBroadcaster } from './dockerEvents.js';
import { settingsService, type TerminalShell } from './settings.js';
import { streamOllamaChat, type OllamaChatMessage } from './ollama.js';

type Destroyable = { destroy?: () => void };

const ALLOWED_SHELLS: TerminalShell[] = ['/bin/bash', '/bin/sh', '/bin/ash'];

function isSameOriginUpgrade(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }
  
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function attachWebSocketServer(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!isSameOriginUpgrade(req)) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '', 'http://internal');
    const containerMatch = url.pathname.match(/^\/ws\/containers\/([^/]+)\/(stats|logs|exec)$/);
    const aiMatch = url.pathname.match(/^\/ws\/ai\/(diagnose\/([^/]+)|generate-stack|chat)$/);
    const eventsMatch = url.pathname === '/ws/events';
    if (!containerMatch && !aiMatch && !eventsMatch) {
      socket.destroy();
      return;
    }

    authenticateUpgrade(req)
      .then((user) => {
        if (!user) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
          socket.end();
          return;
        }
        if (aiMatch && (!settingsService.get().featureFlags.aiAssistant || !hasPermission(user, 'useAi'))) {
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
          socket.end();
          return;
        }
        // A shell inside any container is as powerful as the Docker socket itself.
        if (containerMatch && containerMatch[2] === 'exec' && !hasPermission(user, 'exec')) {
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
          socket.end();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          if (containerMatch) {
            const [, containerId, kind] = containerMatch;
            if (kind === 'stats') handleStats(ws, containerId);
            else if (kind === 'logs') {
              // Same 5000-line cap as the REST endpoint (routes/containers.ts). Without it
              // a client can ask for an unbounded backlog and force the whole thing into memory.
              const tail = Math.min(Number(url.searchParams.get('tail')) || 200, 5000);
              handleLogs(ws, containerId, tail);
            }
            else handleExec(ws, containerId, url.searchParams.get('shell'));
          } else if (aiMatch) {
            if (aiMatch[1].startsWith('diagnose/')) handleDiagnose(ws, aiMatch[2]);
            else if (aiMatch[1] === 'generate-stack') handleGenerateStack(ws);
            else handleChat(ws);
          } else if (eventsMatch) {
            dockerEventBroadcaster.subscribe(ws);
          }
        });
      })
      .catch(() => socket.destroy());
  });
}

function handleStats(ws: WebSocket, containerId: string): void {
  const container = docker.getContainer(containerId);
  let stream: (NodeJS.ReadableStream & Destroyable) | null = null;
  let closed = false;

  container.stats({ stream: true }, (err, s) => {
    if (closed) {
      (s as unknown as Destroyable | undefined)?.destroy?.();
      return;
    }
    if (err || !s) {
      ws.close(1011, 'Failed to attach stats stream');
      return;
    }
    stream = s as NodeJS.ReadableStream & Destroyable;
    let buffer = '';
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const sample = summarizeStats(JSON.parse(line));
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(sample));
        } catch {
          // Ignore a line that didn't parse as a complete stats object.
        }
      }
    });
    stream.on('error', () => ws.close(1011, 'Stats stream error'));
    stream.on('end', () => ws.close());
  });

  ws.on('close', () => {
    closed = true;
    stream?.destroy?.();
  });
}

function handleLogs(ws: WebSocket, containerId: string, tail: number): void {
  const container = docker.getContainer(containerId);
  const demux = new LogDemuxer();
  let stream: (NodeJS.ReadableStream & Destroyable) | null = null;
  let closed = false;

  (async () => {
    const info = await container.inspect();
    if (closed) return;
    const tty = info.Config.Tty;
    const raw = await container.logs({ follow: true, stdout: true, stderr: true, tail });
    if (closed) {
      (raw as unknown as Destroyable).destroy?.();
      return;
    }
    stream = raw as unknown as NodeJS.ReadableStream & Destroyable;
    stream.on('data', (chunk: Buffer) => {
      const text = tty ? chunk.toString('utf8') : demux.push(chunk);
      if (text && ws.readyState === ws.OPEN) ws.send(text);
    });
    stream.on('error', () => ws.close(1011, 'Log stream error'));
    stream.on('end', () => ws.close());
  })().catch(() => ws.close(1011, 'Failed to attach log stream'));

  ws.on('close', () => {
    closed = true;
    stream?.destroy?.();
  });
}

function handleExec(ws: WebSocket, containerId: string, requestedShell: string | null): void {
  const shell = ALLOWED_SHELLS.includes(requestedShell as TerminalShell)
    ? (requestedShell as TerminalShell)
    : settingsService.get().defaultTerminalShell;
  const container = docker.getContainer(containerId);
  let exec: Dockerode.Exec | null = null;
  let stream: (NodeJS.ReadWriteStream & Destroyable) | null = null;
  let closed = false;
  // The exec stream isn't attached until after an async round-trip to Docker;
  // input/resize that arrives before then would otherwise be silently dropped.
  let pendingInput = '';
  let pendingResize: { cols: number; rows: number } | null = null;

  (async () => {
    const e = await container.exec({
      Cmd: [shell],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    // A client that disconnected during the exec-create round trip above doesn't need a
    // shell process started for it at all, so skip the resize + start Docker calls entirely.
    // The exec instance itself already exists at the daemon, but is otherwise inert.
    if (closed) return;
    exec = e;
    const initialResize = pendingResize as { cols: number; rows: number } | null;
    if (initialResize) await e.resize({ w: initialResize.cols, h: initialResize.rows }).catch(() => {});
    const execStream = await e.start({ hijack: true, stdin: true, Tty: true });
    if (closed) {
      (execStream as unknown as Destroyable).destroy?.();
      return;
    }
    stream = execStream as unknown as NodeJS.ReadWriteStream & Destroyable;
    if (pendingInput) stream.write(pendingInput);
    stream.on('data', (chunk: Buffer) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk.toString('utf8'));
    });
    stream.on('error', () => ws.close(1011, 'Exec stream error'));
    stream.on('end', () => ws.close());
  })().catch((err) => ws.close(1011, `Failed to start shell: ${(err as Error).message}`.slice(0, 120)));

  ws.on('message', (data: RawData) => {
    let msg: { type?: string; data?: string; cols?: number; rows?: number };
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      if (stream) stream.write(msg.data);
      else pendingInput += msg.data;
    } else if (msg.type === 'resize' && msg.cols && msg.rows) {
      if (exec) exec.resize({ w: msg.cols, h: msg.rows }).catch(() => {});
      else pendingResize = { cols: msg.cols, rows: msg.rows };
    }
  });

  ws.on('close', () => {
    closed = true;
    stream?.end();
  });
}

// Streams Ollama's response as {type:'token'} frames, ending with {type:'done'} or
// {type:'error'}. One-shot callers (diagnose, generate-stack) close the socket once the
// response completes; chat keeps it open across turns.
async function runOllamaStream(
  ws: WebSocket,
  messages: OllamaChatMessage[],
  opts: { closeOnDone?: boolean } = {}
): Promise<void> {
  const closeOnDone = opts.closeOnDone !== false;
  const { ollamaBaseUrl, ollamaModel } = settingsService.get();
  if (!ollamaModel) {
    ws.send(JSON.stringify({ type: 'error', message: 'No Ollama model configured, set one in Settings.' }));
    if (closeOnDone) ws.close();
    return;
  }
  try {
    for await (const token of streamOllamaChat(ollamaBaseUrl, ollamaModel, messages)) {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify({ type: 'token', content: token }));
    }
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'done' }));
  } catch (err) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
    }
  } finally {
    if (closeOnDone && ws.readyState === ws.OPEN) ws.close();
  }
}

function handleDiagnose(ws: WebSocket, containerId: string): void {
  (async () => {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const raw = (await container.logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail: 300,
    })) as unknown as Buffer;
    const text = info.Config.Tty ? raw.toString('utf8') : demuxLogs(raw);
    const name = info.Name.replace(/^\//, '');
    const state = info.State;
    const prompt = `You are a Docker troubleshooting assistant embedded in a container manager UI. Container "${name}" (image ${info.Config.Image}) is currently in state "${state.Status}"${state.ExitCode ? ` with exit code ${state.ExitCode}` : ''}.

Recent logs (most recent ${300} lines):
\`\`\`
${text.slice(-8000) || '(no log output)'}
\`\`\`

In a few concise sentences, explain in plain language what's happening. If something looks wrong, say what's most likely causing it and how to fix it. If everything looks healthy, just say so briefly. Don't invent problems.`;
    await runOllamaStream(ws, [{ role: 'user', content: prompt }]);
  })().catch((err) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
    }
    ws.close();
  });
}

function handleGenerateStack(ws: WebSocket): void {
  const prompt = `You are an expert at writing docker-compose.yml files. Given a short description of a desired application stack, respond with ONLY a valid docker-compose.yml (top-level "services:" key, optionally "volumes:"), nothing else. No explanation, no markdown code fences. Prefer official images, sensible defaults, named volumes for persistent data, and "restart: unless-stopped".`;
  ws.on('message', (data: RawData) => {
    let msg: { type?: string; text?: string };
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg.type !== 'prompt' || typeof msg.text !== 'string' || !msg.text.trim()) return;
    void runOllamaStream(ws, [
      { role: 'system', content: prompt },
      { role: 'user', content: msg.text.slice(0, 2000) },
    ]);
  });
}

async function buildInfraContext(): Promise<string> {
  const containers = await docker.listContainers({ all: true });
  const lines = containers.map(
    (c) => `- ${(c.Names[0] ?? '').replace(/^\//, '')} (${c.Image}): ${c.State} — ${c.Status}`
  );
  return `You are an assistant embedded in a self-hosted Docker manager. Answer questions about the user's Docker environment concisely and helpfully. Current containers:\n${
    lines.join('\n') || '(none)'
  }`;
}

function handleChat(ws: WebSocket): void {
  ws.on('message', (data: RawData) => {
    let msg: { type?: string; messages?: OllamaChatMessage[] };
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg.type !== 'message' || !Array.isArray(msg.messages)) return;
    (async () => {
      const context = await buildInfraContext();
      await runOllamaStream(ws, [{ role: 'system', content: context }, ...msg.messages!], {
        closeOnDone: false,
      });
    })().catch((err) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      }
    });
  });
}

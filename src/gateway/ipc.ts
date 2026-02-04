import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { getConfigDir } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { SessionManager } from '../engine/manager.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { Store } from '../store/sqlite.js';
import type { ChannelAdapter } from '../channels/base.js';

const log = createLogger('ipc');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpcDeps {
  sessionManager: SessionManager;
  agentRegistry: AgentRegistry;
  store: Store;
  channels: Map<string, ChannelAdapter>;
}

export interface IpcServer {
  socketPath: string;
  close(): Promise<void>;
}

export interface IpcRequest {
  type: string;
  [key: string]: unknown;
}

export interface IpcResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Message dispatcher (exported for testing)
// ---------------------------------------------------------------------------

export async function dispatchIpcMessage(
  msg: IpcRequest,
  deps: IpcDeps,
): Promise<IpcResponse> {
  try {
    switch (msg.type) {
      case 'sessions.list':
        return handleSessionsList(deps);

      case 'sessions.spawn':
        return await handleSessionsSpawn(msg, deps);

      case 'sessions.send':
        return await handleSessionsSend(msg, deps);

      case 'sessions.status':
        return handleSessionsStatus(msg, deps);

      case 'agents.list':
        return handleAgentsList(deps);

      case 'messaging.send':
        return await handleMessagingSend(msg, deps);

      case 'messaging.typing':
        return await handleMessagingTyping(msg, deps);

      case 'messaging.channel_info':
        return handleChannelInfo(msg, deps);

      default:
        return { ok: false, error: `Unknown IPC message type: ${msg.type}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('IPC handler error', { type: msg.type, error: message });
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleSessionsList(deps: IpcDeps): IpcResponse {
  const rows = deps.store.listSessions();
  const sessions = rows.map((r) => ({
    sessionId: r.id,
    agentId: r.agent_id,
    channel: r.channel ?? 'unknown',
    status: r.status,
    lastActive: r.last_active_at,
  }));
  return { ok: true, sessions };
}

async function handleSessionsSpawn(
  msg: IpcRequest,
  deps: IpcDeps,
): Promise<IpcResponse> {
  const agentId = msg.agentId as string | undefined;
  const prompt = msg.prompt as string | undefined;

  if (!agentId || typeof agentId !== 'string') {
    return { ok: false, error: 'agentId is required' };
  }
  if (!prompt || typeof prompt !== 'string') {
    return { ok: false, error: 'prompt is required' };
  }
  if (!deps.agentRegistry.has(agentId)) {
    return { ok: false, error: `Agent "${agentId}" not found` };
  }

  const result = await deps.sessionManager.sendMessage(
    agentId,
    prompt,
    'ipc',
  );

  return {
    ok: true,
    sessionId: result.sessionId,
    response: result.text,
  };
}

async function handleSessionsSend(
  msg: IpcRequest,
  deps: IpcDeps,
): Promise<IpcResponse> {
  const sessionId = msg.sessionId as string | undefined;
  const message = msg.message as string | undefined;

  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId is required' };
  }
  if (!message || typeof message !== 'string') {
    return { ok: false, error: 'message is required' };
  }

  const session = deps.store.getSession(sessionId);
  if (!session) {
    return { ok: false, error: `Session "${sessionId}" not found` };
  }

  const result = await deps.sessionManager.resumeSession(sessionId, message);

  return {
    ok: true,
    sessionId: result.sessionId,
    response: result.text,
  };
}

function handleSessionsStatus(
  msg: IpcRequest,
  deps: IpcDeps,
): IpcResponse {
  const sessionId = msg.sessionId as string | undefined;
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId is required' };
  }

  const session = deps.store.getSession(sessionId);
  if (!session) {
    return { ok: false, error: `Session "${sessionId}" not found` };
  }

  return {
    ok: true,
    sessionId: session.id,
    agentId: session.agent_id,
    channel: session.channel,
    status: session.status,
    createdAt: session.created_at,
    lastActive: session.last_active_at,
  };
}

function handleAgentsList(deps: IpcDeps): IpcResponse {
  const agents = deps.agentRegistry.list().map((a) => ({
    id: a.id,
    name: a.config.name,
    description: a.config.description ?? '',
    toolPreset: a.config.toolPreset,
    skills: a.config.skills ?? [],
  }));
  return { ok: true, agents };
}

async function handleMessagingSend(
  msg: IpcRequest,
  deps: IpcDeps,
): Promise<IpcResponse> {
  const channel = msg.channel as string | undefined;
  const to = msg.to as string | undefined;
  const text = msg.text as string | undefined;
  const threadId = msg.threadId as string | undefined;

  if (!channel || typeof channel !== 'string') {
    return { ok: false, error: 'channel is required' };
  }
  if (!to || typeof to !== 'string') {
    return { ok: false, error: 'to is required' };
  }
  if (!text || typeof text !== 'string') {
    return { ok: false, error: 'text is required' };
  }

  const adapter = deps.channels.get(channel);
  if (!adapter) {
    return { ok: false, error: `Channel "${channel}" not found or not connected` };
  }

  await adapter.sendMessage(to, text, threadId ? { threadId } : undefined);
  return { ok: true };
}

async function handleMessagingTyping(
  msg: IpcRequest,
  deps: IpcDeps,
): Promise<IpcResponse> {
  const channel = msg.channel as string | undefined;
  const to = msg.to as string | undefined;

  if (!channel || typeof channel !== 'string') {
    return { ok: false, error: 'channel is required' };
  }
  if (!to || typeof to !== 'string') {
    return { ok: false, error: 'to is required' };
  }

  const adapter = deps.channels.get(channel);
  if (!adapter) {
    return { ok: false, error: `Channel "${channel}" not found or not connected` };
  }

  await adapter.sendTyping(to);
  return { ok: true };
}

function handleChannelInfo(
  msg: IpcRequest,
  deps: IpcDeps,
): IpcResponse {
  const channel = msg.channel as string | undefined;
  if (!channel || typeof channel !== 'string') {
    return { ok: false, error: 'channel is required' };
  }

  const adapter = deps.channels.get(channel);
  if (!adapter) {
    return { ok: false, error: `Channel "${channel}" not found` };
  }

  return {
    ok: true,
    connected: adapter.isConnected(),
    type: adapter.name,
  };
}

// ---------------------------------------------------------------------------
// Socket server lifecycle
// ---------------------------------------------------------------------------

/**
 * Remove stale IPC socket files from a previous process that didn't clean up.
 */
function cleanupStaleSockets(homeDir: string): void {
  try {
    const entries = readdirSync(homeDir);
    for (const entry of entries) {
      if (entry.startsWith('ipc-') && entry.endsWith('.sock')) {
        const sockPath = join(homeDir, entry);
        try {
          unlinkSync(sockPath);
          log.debug('Removed stale IPC socket', { path: sockPath });
        } catch {
          // Another process may still own it — ignore
        }
      }
    }
  } catch {
    // homeDir may not exist yet — that's fine
  }
}

/**
 * Create a Unix domain socket IPC server for inter-process communication
 * between MCP server subprocesses and the main Clade gateway.
 */
export async function createIpcServer(deps: IpcDeps): Promise<IpcServer> {
  const homeDir = getConfigDir();
  cleanupStaleSockets(homeDir);

  const socketPath = join(homeDir, `ipc-${process.pid}.sock`);

  // Remove any leftover socket at this path
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch { /* ignore */ }
  }

  const server: Server = createServer((conn) => {
    let data = '';

    conn.on('data', (chunk) => {
      data += chunk.toString();
    });

    conn.on('end', () => {
      (async () => {
        try {
          const msg = JSON.parse(data) as IpcRequest;
          log.debug('IPC request', { type: msg.type });
          const response = await dispatchIpcMessage(msg, deps);
          conn.write(JSON.stringify(response));
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.error('IPC parse/dispatch error', { error });
          conn.write(JSON.stringify({ ok: false, error }));
        } finally {
          conn.end();
        }
      })();
    });

    conn.on('error', (err) => {
      log.debug('IPC connection error', { error: err.message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  log.info('IPC server listening', { socketPath });

  // Cleanup on process exit
  const cleanup = () => {
    try {
      server.close();
      if (existsSync(socketPath)) unlinkSync(socketPath);
    } catch { /* best-effort */ }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return {
    socketPath,
    async close() {
      return new Promise<void>((resolve) => {
        server.close(() => {
          if (existsSync(socketPath)) {
            try { unlinkSync(socketPath); } catch { /* ignore */ }
          }
          resolve();
        });
      });
    },
  };
}

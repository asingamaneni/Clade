import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { ConfigSchema } from '../config/schema.js';
import { WebChatAdapter } from '../channels/webchat.js';
import { createLogger } from '../utils/logger.js';
import {
  getReflectionStatus,
  getReflectionHistory,
  getReflectionHistoryEntry,
  runReflectionCycle,
} from '../agents/reflection.js';
import {
  saveVersion,
  getVersionHistory,
  getVersionContent,
} from '../agents/versioning.js';
import { getUserMdPath, getUserHistoryDir, getAgentsDir } from '../config/index.js';
import { DEFAULT_USER_MD, DEFAULT_TOOLS_MD } from '../config/defaults.js';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Config } from '../config/schema.js';
import type { SessionManager } from '../engine/manager.js';
import type { Store } from '../store/sqlite.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { ChannelAdapter } from '../channels/base.js';
import { createIpcServer, type IpcServer } from './ipc.js';

const log = createLogger('gateway');

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface GatewayDeps {
  config: Config;
  sessionManager: SessionManager;
  store: Store;
  agentRegistry: AgentRegistry;
  channels: Map<string, ChannelAdapter>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Admin WebSocket management (module-scoped singleton)
// ═══════════════════════════════════════════════════════════════════════════

const adminClients = new Set<WebSocket>();

/**
 * Broadcast an event to every connected admin WebSocket client.
 * Safe to call at any time -- dead sockets are pruned automatically.
 */
export function broadcastAdmin(event: { type: string; [key: string]: unknown }): void {
  if (adminClients.size === 0) return;
  const payload = JSON.stringify(event);
  for (const ws of adminClients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(payload);
    } else {
      adminClients.delete(ws);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Chat types & storage helpers
// ═══════════════════════════════════════════════════════════════════════════

interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  url: string;
}

interface ChatMessage {
  id: string;
  agentId: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  sessionId?: string;
  attachments?: ChatAttachment[];
}

interface Conversation {
  id: string;
  agentId: string;
  label: string;
  messages: ChatMessage[];
  createdAt: string;
  lastActiveAt: string;
}

interface AgentChatData {
  conversations: Record<string, Conversation>;
  order: string[]; // conversation IDs, most recent first
}

/** In-memory cache of chat data, keyed by agentId */
const chatCache = new Map<string, AgentChatData>();

function chatDir(cladeHome: string): string {
  return join(cladeHome, 'data', 'chats');
}

function chatFilePath(cladeHome: string, agentId: string): string {
  return join(chatDir(cladeHome), `${agentId}.json`);
}

function emptyAgentChatData(): AgentChatData {
  return { conversations: {}, order: [] };
}

/** Generate a short label from the first user message */
function generateLabel(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 30) return cleaned;
  const truncated = cleaned.slice(0, 30);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 15 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/** Load agent chat data with auto-migration from old flat array format */
function loadAgentChatData(cladeHome: string, agentId: string): AgentChatData {
  if (chatCache.has(agentId)) return chatCache.get(agentId)!;
  const filePath = chatFilePath(cladeHome, agentId);
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Detect old flat array format and auto-migrate
    if (Array.isArray(parsed)) {
      const messages = parsed as ChatMessage[];
      if (messages.length === 0) {
        const data = emptyAgentChatData();
        chatCache.set(agentId, data);
        return data;
      }
      const convId = 'conv_' + randomUUID().slice(0, 12);
      const firstUserMsg = messages.find(m => m.role === 'user');
      const conv: Conversation = {
        id: convId,
        agentId,
        label: firstUserMsg ? generateLabel(firstUserMsg.text) : 'Imported chat',
        messages,
        createdAt: messages[0]?.timestamp || new Date().toISOString(),
        lastActiveAt: messages[messages.length - 1]?.timestamp || new Date().toISOString(),
      };
      const data: AgentChatData = {
        conversations: { [convId]: conv },
        order: [convId],
      };
      chatCache.set(agentId, data);
      saveAgentChatData(cladeHome, agentId, data);
      return data;
    }
    // New format
    const data = parsed as AgentChatData;
    if (!data.conversations) data.conversations = {};
    if (!data.order) data.order = [];
    chatCache.set(agentId, data);
    return data;
  } catch {
    const data = emptyAgentChatData();
    chatCache.set(agentId, data);
    return data;
  }
}

/** Write full AgentChatData to disk */
function saveAgentChatData(cladeHome: string, agentId: string, data: AgentChatData): void {
  const dir = chatDir(cladeHome);
  mkdirSync(dir, { recursive: true });
  chatCache.set(agentId, data);
  writeFileSync(chatFilePath(cladeHome, agentId), JSON.stringify(data, null, 2), 'utf-8');
}

/** Create a new conversation for an agent */
function createConversation(cladeHome: string, agentId: string, label?: string): Conversation {
  const data = loadAgentChatData(cladeHome, agentId);
  const convId = 'conv_' + randomUUID().slice(0, 12);
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: convId,
    agentId,
    label: label || 'New chat',
    messages: [],
    createdAt: now,
    lastActiveAt: now,
  };
  data.conversations[convId] = conv;
  data.order = [convId, ...data.order];
  saveAgentChatData(cladeHome, agentId, data);
  return conv;
}

// ═══════════════════════════════════════════════════════════════════════════
// Gateway factory
// ═══════════════════════════════════════════════════════════════════════════

export async function createGateway(deps: GatewayDeps) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Serve admin UI static files (built React app goes into dist/ui)
  const uiPath = join(__dirname, '..', '..', 'ui', 'dist');
  if (existsSync(uiPath)) {
    await app.register(fastifyStatic, {
      root: uiPath,
      prefix: '/admin/',
      decorateReply: true,
    });
  }

  // Serve admin UI: prefer React build, fall back to legacy admin.html
  const uiIndexPath = join(uiPath, 'index.html');
  const adminHtmlPath = join(__dirname, 'admin.html');
  const adminHtmlSrcPath = join(__dirname, '..', 'gateway', 'admin.html');
  const resolvedAdminPath = existsSync(adminHtmlPath) ? adminHtmlPath : existsSync(adminHtmlSrcPath) ? adminHtmlSrcPath : null;

  app.get('/admin', async (_req, reply) => {
    // Prefer React UI build
    if (existsSync(uiIndexPath)) {
      return reply.redirect('/admin/');
    }
    // Fall back to legacy admin.html
    if (resolvedAdminPath) {
      const html = readFileSync(resolvedAdminPath, 'utf-8');
      reply.type('text/html').send(html);
    } else {
      reply.type('text/html').send(`<!DOCTYPE html><html><head><title>Clade Admin</title></head><body style="background:#0f1117;color:#e6edf3;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>Clade Admin</h1><p style="color:#8b949e">Dashboard UI is loading. Refresh in a moment.</p><p style="color:#8b949e;font-size:0.875rem">API available at <a href="/health" style="color:#58a6ff">/health</a></p></div></body></html>`);
    }
  });

  // Redirect root to admin
  app.get('/', async (_req, reply) => {
    reply.redirect('/admin');
  });

  // ── Health check ─────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeSessions: deps.store.listSessions({ status: 'active' }).length,
    channels: Object.fromEntries(
      Array.from(deps.channels.entries()).map(([name, ch]) => [name, ch.isConnected()]),
    ),
  }));

  // Legacy admin.html accessible at /admin/legacy
  if (resolvedAdminPath) {
    app.get('/admin/legacy', async (_req, reply) => {
      const html = readFileSync(resolvedAdminPath, 'utf-8');
      reply.type('text/html').send(html);
    });
  }

  // ── Register API route groups ──────────────────────────────────
  registerAgentRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerMemoryRoutes(app, deps);
  registerMcpRoutes(app, deps);
  registerSkillRoutes(app, deps);
  registerChannelRoutes(app, deps);
  registerCronRoutes(app, deps);
  registerConfigRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerUserRoutes(app, deps);
  registerToolsMdRoutes(app, deps);

  // ── WebSocket: WebChat ─────────────────────────────────────────
  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket, req) => {
      const query = req.query as Record<string, string | undefined>;
      const clientId = query['clientId'] ?? randomUUID();
      const webchat = deps.channels.get('webchat');

      if (!(webchat instanceof WebChatAdapter)) {
        socket.close(1011, 'WebChat adapter not available');
        return;
      }

      webchat.addClient(clientId, socket);
      log.info('WebChat client connected', { clientId });

      broadcastAdmin({
        type: 'webchat:connect',
        clientId,
        timestamp: new Date().toISOString(),
      });

      socket.on('close', () => {
        log.info('WebChat client disconnected', { clientId });
        broadcastAdmin({
          type: 'webchat:disconnect',
          clientId,
          timestamp: new Date().toISOString(),
        });
      });
    });
  });

  // ── WebSocket: Admin real-time updates ─────────────────────────
  app.register(async (fastify) => {
    fastify.get('/ws/admin', { websocket: true }, (socket, _req) => {
      adminClients.add(socket);
      log.debug('Admin WS client connected', { total: adminClients.size });

      // Send a snapshot of current state on connect.
      const snapshot = {
        type: 'snapshot',
        activeSessions: deps.store.listSessions({ status: 'active' }).length,
        agents: deps.agentRegistry.ids(),
        channels: Object.fromEntries(
          Array.from(deps.channels.entries()).map(([name, ch]) => [name, ch.isConnected()]),
        ),
        timestamp: new Date().toISOString(),
      };
      socket.send(JSON.stringify(snapshot));

      socket.on('close', () => {
        adminClients.delete(socket);
        log.debug('Admin WS client disconnected', { total: adminClients.size });
      });

      socket.on('error', () => {
        adminClients.delete(socket);
      });
    });
  });

  // ── Webhook endpoint ───────────────────────────────────────────
  app.post<{ Params: { agentId: string }; Body: { prompt?: string; payload?: unknown } }>(
    '/api/webhook/:agentId',
    async (req, reply) => {
      const { agentId } = req.params;
      const body = (req.body ?? {}) as { prompt?: string; payload?: unknown };

      if (!deps.agentRegistry.has(agentId)) {
        return reply.code(404).send({ error: `Agent "${agentId}" not found` });
      }

      const prompt = typeof body.prompt === 'string'
        ? body.prompt
        : JSON.stringify(body.payload ?? body);

      try {
        const result = await deps.sessionManager.sendMessage(agentId, prompt, 'webhook');
        broadcastAdmin({
          type: 'webhook:triggered',
          agentId,
          timestamp: new Date().toISOString(),
        });
        return { success: true, sessionId: result.sessionId, response: result.text };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Start IPC server for MCP subprocess communication ──────
  let ipcServer: IpcServer | undefined;
  try {
    ipcServer = await createIpcServer({
      sessionManager: deps.sessionManager,
      agentRegistry: deps.agentRegistry,
      store: deps.store,
      channels: deps.channels,
    });
    process.env['CLADE_IPC_SOCKET'] = ipcServer.socketPath;
    log.info('IPC server started', { socketPath: ipcServer.socketPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Failed to start IPC server — agent delegation will be unavailable', { error: msg });
  }

  // Attach IPC server for cleanup on gateway close
  app.addHook('onClose', async () => {
    if (ipcServer) {
      await ipcServer.close();
      log.info('IPC server closed');
    }
  });

  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent Routes — /api/agents
// ═══════════════════════════════════════════════════════════════════════════

function registerAgentRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { agentRegistry: reg } = deps;

  // ── List all agents ────────────────────────────────────────────
  app.get('/api/agents', async () => {
    const agents = reg.list().map((a) => ({
      id: a.id,
      name: a.config.name,
      description: a.config.description,
      model: a.config.model,
      toolPreset: a.config.toolPreset,
      emoji: a.config.emoji,
      admin: a.config.admin,
    }));
    return { agents };
  });

  // ── Get specific agent ─────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agent = reg.tryGet(req.params.id);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${req.params.id}" not found` });
    }
    return { agent: { id: agent.id, ...agent.config } };
  });

  // ── Create agent ───────────────────────────────────────────────
  app.post<{
    Body: {
      id: string;
      name: string;
      description?: string;
      model?: string;
      toolPreset?: string;
      customTools?: string[];
      mcp?: string[];
      maxTurns?: number;
    };
  }>('/api/agents', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const id = body.id as string | undefined;
    const name = body.name as string | undefined;

    if (!id || !name) {
      return reply.code(400).send({ error: 'Agent id and name are required' });
    }
    if (reg.has(id)) {
      return reply.code(409).send({ error: `Agent "${id}" already exists` });
    }

    try {
      const { AgentConfigSchema } = await import('../config/schema.js');
      const parsed = AgentConfigSchema.parse({
        name: body.name,
        description: body.description,
        model: body.model,
        toolPreset: body.toolPreset,
        customTools: body.customTools,
        mcp: body.mcp,
        maxTurns: body.maxTurns,
      });

      const agent = reg.register(id, parsed);
      broadcastAdmin({ type: 'agent:created', agentId: id, timestamp: new Date().toISOString() });
      return reply.code(201).send({ success: true, agent: { id: agent.id, ...agent.config } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create agent';
      return reply.code(400).send({ error: message });
    }
  });

  // ── Update agent ───────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/agents/:id',
    async (req, reply) => {
      const { id } = req.params;
      const existing = reg.tryGet(id);
      if (!existing) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      try {
        const { AgentConfigSchema } = await import('../config/schema.js');
        // Merge with existing config, then validate
        const merged = { ...existing.config, ...(req.body as Record<string, unknown>) };
        const parsed = AgentConfigSchema.parse(merged);
        const updated = reg.register(id, parsed);
        broadcastAdmin({ type: 'agent:updated', agentId: id, timestamp: new Date().toISOString() });
        return { success: true, agent: { id: updated.id, ...updated.config } };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update agent';
        return reply.code(400).send({ error: message });
      }
    },
  );

  // ── Delete agent ───────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const { id } = req.params;
    if (!reg.has(id)) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    const removed = reg.unregister(id);
    if (removed) {
      broadcastAdmin({ type: 'agent:deleted', agentId: id, timestamp: new Date().toISOString() });
    }
    return { success: true };
  });

  // ── Get SOUL.md ────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/agents/:id/soul', async (req, reply) => {
    const { id } = req.params;
    const agent = reg.tryGet(id);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    try {
      const content = reg.readSoul(id);
      return { agentId: id, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read SOUL.md';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Update SOUL.md ─────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { content: string } }>(
    '/api/agents/:id/soul',
    async (req, reply) => {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;
      const content = body.content;
      if (typeof content !== 'string') {
        return reply.code(400).send({ error: 'content must be a string' });
      }

      const agent = reg.tryGet(id);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      try {
        writeFileSync(agent.soulPath, content, 'utf-8');
        broadcastAdmin({ type: 'agent:soul-updated', agentId: id, timestamp: new Date().toISOString() });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update SOUL.md';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Get HEARTBEAT.md ───────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/agents/:id/heartbeat', async (req, reply) => {
    const { id } = req.params;
    const agent = reg.tryGet(id);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    try {
      const content = reg.readHeartbeat(id);
      return { agentId: id, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read HEARTBEAT.md';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Update HEARTBEAT.md ────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { content: string } }>(
    '/api/agents/:id/heartbeat',
    async (req, reply) => {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;
      const content = body.content;
      if (typeof content !== 'string') {
        return reply.code(400).send({ error: 'content must be a string' });
      }

      const agent = reg.tryGet(id);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      try {
        writeFileSync(agent.heartbeatPath, content, 'utf-8');
        broadcastAdmin({ type: 'agent:heartbeat-updated', agentId: id, timestamp: new Date().toISOString() });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update HEARTBEAT.md';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Get reflection status ─────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/agents/:id/reflection', async (req, reply) => {
    const { id } = req.params;
    if (!reg.has(id)) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }
    try {
      const status = getReflectionStatus(id);
      return { agentId: id, ...status };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get reflection status';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Trigger reflection manually ───────────────────────────────
  app.post<{ Params: { id: string } }>('/api/agents/:id/reflection', async (req, reply) => {
    const { id } = req.params;
    if (!reg.has(id)) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }
    try {
      const result = await runReflectionCycle(id, true);
      broadcastAdmin({
        type: 'agent:reflection-complete',
        agentId: id,
        result,
        timestamp: new Date().toISOString(),
      });
      return { triggered: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reflection cycle failed';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Get reflection history ────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/agents/:id/reflection/history', async (req, reply) => {
    const { id } = req.params;
    if (!reg.has(id)) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }
    try {
      const entries = getReflectionHistory(id);
      return { agentId: id, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get reflection history';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Get specific reflection history entry ──────────────────
  app.get<{ Params: { id: string; date: string } }>('/api/agents/:id/reflection/history/:date', async (req, reply) => {
    const { id, date } = req.params;
    if (!reg.has(id)) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }
    try {
      const content = getReflectionHistoryEntry(id, date);
      if (content === null) {
        return reply.code(404).send({ error: `No history entry for date "${date}"` });
      }
      return { agentId: id, date, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read history entry';
      return reply.code(500).send({ error: message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Routes — /api/sessions
// ═══════════════════════════════════════════════════════════════════════════

function registerSessionRoutes(app: FastifyInstance, deps: GatewayDeps): void {

  // ── List sessions ──────────────────────────────────────────────
  app.get<{ Querystring: { status?: string; agentId?: string } }>(
    '/api/sessions',
    async (req) => {
      const query = req.query as Record<string, string | undefined>;
      const filters: Record<string, string> = {};
      if (query['status']) filters.status = query['status'];
      if (query['agentId']) filters.agentId = query['agentId'];

      const sessions = deps.store.listSessions(
        Object.keys(filters).length > 0 ? filters as any : undefined,
      );
      return { sessions };
    },
  );

  // ── Get session details ────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = deps.store.getSession(req.params.id);
    if (!session) {
      return reply.code(404).send({ error: `Session "${req.params.id}" not found` });
    }
    return { session };
  });

  // ── Send message to session ────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { text: string } }>(
    '/api/sessions/:id/send',
    async (req, reply) => {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;
      const text = body.text;
      if (!text || typeof text !== 'string') {
        return reply.code(400).send({ error: 'text is required and must be a string' });
      }

      const session = deps.store.getSession(id);
      if (!session) {
        return reply.code(404).send({ error: `Session "${id}" not found` });
      }

      try {
        const result = await deps.sessionManager.resumeSession(id, text);
        broadcastAdmin({
          type: 'session:message',
          sessionId: id,
          agentId: session.agent_id,
          timestamp: new Date().toISOString(),
        });
        return { success: true, response: result.text, sessionId: result.sessionId };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Terminate session ──────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params;
    const session = deps.store.getSession(id);
    if (!session) {
      return reply.code(404).send({ error: `Session "${id}" not found` });
    }

    try {
      deps.store.updateSessionStatus(id, 'terminated');
      broadcastAdmin({
        type: 'session:terminated',
        sessionId: id,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to terminate session';
      return reply.code(500).send({ error: message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Memory Routes — /api/agents/:id/memory
// ═══════════════════════════════════════════════════════════════════════════

function registerMemoryRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { agentRegistry: reg, store } = deps;

  // ── List memory files ──────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/agents/:id/memory', async (req, reply) => {
    const { id } = req.params;
    const agent = reg.tryGet(id);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    try {
      const files: string[] = [];

      // Include MEMORY.md from the agent base directory.
      const memoryMdPath = join(agent.baseDir, 'MEMORY.md');
      if (existsSync(memoryMdPath)) {
        files.push('MEMORY.md');
      }

      // Include daily log files from the memory/ subdirectory.
      if (existsSync(agent.memoryDir)) {
        const entries = readdirSync(agent.memoryDir).filter(
          (f) => f.endsWith('.md') && !f.startsWith('.'),
        );
        for (const entry of entries) {
          files.push(`memory/${entry}`);
        }
      }

      return { agentId: id, files };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list memory files';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Read specific memory file ──────────────────────────────────
  app.get<{ Params: { id: string; file: string } }>(
    '/api/agents/:id/memory/:file',
    async (req, reply) => {
      const { id, file } = req.params;
      const agent = reg.tryGet(id);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      // Resolve path -- only allow files within the agent's base directory.
      const resolvedPath = resolveMemoryPath(agent.baseDir, agent.memoryDir, file);
      if (!resolvedPath) {
        return reply.code(400).send({ error: 'Invalid file path' });
      }

      if (!existsSync(resolvedPath)) {
        return reply.code(404).send({ error: `Memory file "${file}" not found` });
      }

      try {
        const content = readFileSync(resolvedPath, 'utf-8');
        return { agentId: id, file, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read memory file';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Search memory (FTS5) ───────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { query: string; limit?: number } }>(
    '/api/agents/:id/memory/search',
    async (req, reply) => {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;
      const query = body.query;
      const limit = typeof body.limit === 'number' ? body.limit : undefined;

      if (!query || typeof query !== 'string') {
        return reply.code(400).send({ error: 'query is required and must be a string' });
      }
      if (!reg.has(id)) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      try {
        const results = store.searchMemory(id, query, limit ?? 20);
        return { agentId: id, query, results };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Memory search failed';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Update memory file ─────────────────────────────────────────
  app.put<{ Params: { id: string; file: string }; Body: { content: string } }>(
    '/api/agents/:id/memory/:file',
    async (req, reply) => {
      const { id, file } = req.params;
      const body = req.body as Record<string, unknown>;
      const content = body.content;

      if (typeof content !== 'string') {
        return reply.code(400).send({ error: 'content must be a string' });
      }

      const agent = reg.tryGet(id);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      const resolvedPath = resolveMemoryPath(agent.baseDir, agent.memoryDir, file);
      if (!resolvedPath) {
        return reply.code(400).send({ error: 'Invalid file path' });
      }

      try {
        writeFileSync(resolvedPath, content, 'utf-8');
        broadcastAdmin({
          type: 'memory:updated',
          agentId: id,
          file,
          timestamp: new Date().toISOString(),
        });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update memory file';
        return reply.code(500).send({ error: message });
      }
    },
  );
}

/**
 * Resolve a memory file path safely.  Only allows MEMORY.md in the base
 * directory and *.md files in the memory/ subdirectory.  Returns `null`
 * for any path that tries to escape the sandbox.
 */
function resolveMemoryPath(
  baseDir: string,
  memoryDir: string,
  file: string,
): string | null {
  // Reject any path traversal attempts.
  if (file.includes('..') || file.startsWith('/')) return null;

  if (file === 'MEMORY.md') {
    return join(baseDir, 'MEMORY.md');
  }

  // Files under memory/ subdirectory
  const prefix = 'memory/';
  const filename = file.startsWith(prefix) ? file.slice(prefix.length) : file;

  // Only allow .md files, no further nesting.
  if (filename.includes('/') || filename.includes('\\')) return null;
  if (!filename.endsWith('.md')) return null;

  return join(memoryDir, filename);
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP Routes — /api/mcp
// ═══════════════════════════════════════════════════════════════════════════

function registerMcpRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { store } = deps;

  // ── List all MCP servers ──────────────────────────────────────
  app.get('/api/mcp', async () => {
    const mcpServers = store.listMcpServers();
    return { mcpServers };
  });

  // ── Approve pending MCP server ────────────────────────────────
  app.post<{ Params: { name: string } }>('/api/mcp/:name/approve', async (req, reply) => {
    const { name } = req.params;
    const server = store.getMcpServer(name);
    if (!server) {
      return reply.code(404).send({ error: `MCP server "${name}" not found` });
    }
    if (server.status !== 'pending') {
      return reply.code(400).send({
        error: `MCP server "${name}" is not pending (current status: ${server.status})`,
      });
    }

    try {
      store.approveMcpServer(name);
      broadcastAdmin({ type: 'mcp:approved', name, timestamp: new Date().toISOString() });
      const updated = store.getMcpServer(name);
      return { success: true, mcpServer: updated };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve MCP server';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Reject pending MCP server ─────────────────────────────────
  app.post<{ Params: { name: string } }>('/api/mcp/:name/reject', async (req, reply) => {
    const { name } = req.params;
    const server = store.getMcpServer(name);
    if (!server) {
      return reply.code(404).send({ error: `MCP server "${name}" not found` });
    }
    if (server.status !== 'pending') {
      return reply.code(400).send({
        error: `MCP server "${name}" is not pending (current status: ${server.status})`,
      });
    }

    try {
      store.disableMcpServer(name);
      broadcastAdmin({ type: 'mcp:rejected', name, timestamp: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reject MCP server';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Delete MCP server ─────────────────────────────────────────
  app.delete<{ Params: { name: string } }>('/api/mcp/:name', async (req, reply) => {
    const { name } = req.params;
    const server = store.getMcpServer(name);
    if (!server) {
      return reply.code(404).send({ error: `MCP server "${name}" not found` });
    }

    try {
      store.deleteMcpServer(name);
      broadcastAdmin({ type: 'mcp:deleted', name, timestamp: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete MCP server';
      return reply.code(500).send({ error: message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Skill Routes — /api/skills
// ═══════════════════════════════════════════════════════════════════════════

function registerSkillRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { store, agentRegistry: reg } = deps;
  const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  const skillsDir = join(cladeHome, 'skills');

  // ── List all skills ───────────────────────────────────────────
  app.get('/api/skills', async () => {
    const skills = store.listSkills();
    return { skills };
  });

  // ── Install / create a new skill ─────────────────────────────
  app.post<{
    Body: { name: string; description?: string; content?: string };
  }>('/api/skills/install', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const name = body.name as string | undefined;
    const description = (body.description as string) ?? '';
    const content = (body.content as string) ?? `# ${name}\n\n${description}\n`;

    if (!name || typeof name !== 'string') {
      return reply.code(400).send({ error: 'name is required' });
    }

    if (!/^[a-z0-9_-]+$/.test(name)) {
      return reply.code(400).send({
        error: 'Skill name must contain only lowercase letters, numbers, hyphens, and underscores.',
      });
    }

    if (store.getSkill(name)) {
      return reply.code(409).send({ error: `Skill "${name}" already exists` });
    }

    try {
      // Create skill directory on disk
      const skillDir = join(skillsDir, 'pending', name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');

      // Create in store
      const skill = store.createSkill({
        name,
        description,
        path: skillDir,
        status: 'pending',
      });

      broadcastAdmin({ type: 'skill:installed', name, timestamp: new Date().toISOString() });
      return reply.code(201).send({ success: true, skill });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to install skill';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Approve pending skill ────────────────────────────────────
  app.post<{ Params: { name: string } }>('/api/skills/:name/approve', async (req, reply) => {
    const { name } = req.params;
    const skill = store.getSkill(name);
    if (!skill) {
      return reply.code(404).send({ error: `Skill "${name}" not found` });
    }
    if (skill.status !== 'pending') {
      return reply.code(400).send({
        error: `Skill "${name}" is not pending (current status: ${skill.status})`,
      });
    }

    try {
      // Move directory from pending to active
      const pendingDir = join(skillsDir, 'pending', name);
      const activeDir = join(skillsDir, 'active', name);
      mkdirSync(join(skillsDir, 'active'), { recursive: true });

      if (existsSync(pendingDir)) {
        const files = readdirSync(pendingDir);
        mkdirSync(activeDir, { recursive: true });
        for (const file of files) {
          const content = readFileSync(join(pendingDir, file), 'utf-8');
          writeFileSync(join(activeDir, file), content, 'utf-8');
        }
        const { rmSync } = await import('node:fs');
        rmSync(pendingDir, { recursive: true });
      }

      // Update store
      store.approveSkill(name);

      // Update path in store via raw db
      store.raw.prepare('UPDATE skills SET path = ? WHERE name = ?').run(activeDir, name);

      broadcastAdmin({ type: 'skill:approved', name, timestamp: new Date().toISOString() });
      const updated = store.getSkill(name);
      return { success: true, skill: updated };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve skill';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Reject pending skill ─────────────────────────────────────
  app.post<{ Params: { name: string } }>('/api/skills/:name/reject', async (req, reply) => {
    const { name } = req.params;
    const skill = store.getSkill(name);
    if (!skill) {
      return reply.code(404).send({ error: `Skill "${name}" not found` });
    }
    if (skill.status !== 'pending') {
      return reply.code(400).send({
        error: `Skill "${name}" is not pending (current status: ${skill.status})`,
      });
    }

    try {
      // Move directory from pending to disabled
      const pendingDir = join(skillsDir, 'pending', name);
      const disabledDir = join(skillsDir, 'disabled', name);
      mkdirSync(join(skillsDir, 'disabled'), { recursive: true });

      if (existsSync(pendingDir)) {
        const files = readdirSync(pendingDir);
        mkdirSync(disabledDir, { recursive: true });
        for (const file of files) {
          const content = readFileSync(join(pendingDir, file), 'utf-8');
          writeFileSync(join(disabledDir, file), content, 'utf-8');
        }
        const { rmSync } = await import('node:fs');
        rmSync(pendingDir, { recursive: true });
      }

      store.disableSkill(name);

      // Update path in store
      store.raw.prepare('UPDATE skills SET path = ? WHERE name = ?').run(disabledDir, name);

      broadcastAdmin({ type: 'skill:rejected', name, timestamp: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reject skill';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Delete skill permanently ─────────────────────────────────
  app.delete<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => {
    const { name } = req.params;
    const skill = store.getSkill(name);
    if (!skill) {
      return reply.code(404).send({ error: `Skill "${name}" not found` });
    }

    try {
      // Remove directory from disk
      for (const subdir of ['active', 'pending', 'disabled']) {
        const dirPath = join(skillsDir, subdir, name);
        if (existsSync(dirPath)) {
          const { rmSync } = await import('node:fs');
          rmSync(dirPath, { recursive: true });
        }
      }

      // Remove from agent configs
      for (const agent of reg.list()) {
        if (agent.config.skills?.includes(name)) {
          const updatedSkills = agent.config.skills.filter((s) => s !== name);
          reg.register(agent.id, { ...agent.config, skills: updatedSkills });
        }
      }

      store.deleteSkill(name);
      broadcastAdmin({ type: 'skill:deleted', name, timestamp: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete skill';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Get skill detail (SKILL.md content) ──────────────────────
  app.get<{ Params: { status: string; name: string } }>(
    '/api/skills/:status/:name',
    async (req, reply) => {
      const { status, name } = req.params;
      const dirPath = join(skillsDir, status, name);

      if (!existsSync(dirPath)) {
        return reply.code(404).send({ error: `Skill "${name}" not found in ${status}` });
      }

      try {
        const files = readdirSync(dirPath);
        const contents: Record<string, string> = {};
        for (const file of files) {
          contents[file] = readFileSync(join(dirPath, file), 'utf-8');
        }
        return { name, status, path: dirPath, files, contents };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read skill';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Assign skill to agent ────────────────────────────────────
  app.post<{ Params: { name: string }; Body: { agentId: string } }>(
    '/api/skills/:name/assign',
    async (req, reply) => {
      const { name } = req.params;
      const body = req.body as Record<string, unknown>;
      const agentId = body.agentId as string | undefined;

      if (!agentId) {
        return reply.code(400).send({ error: 'agentId is required' });
      }

      const skill = store.getSkill(name);
      if (!skill) {
        return reply.code(404).send({ error: `Skill "${name}" not found` });
      }

      const agent = reg.tryGet(agentId);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${agentId}" not found` });
      }

      try {
        const currentSkills = agent.config.skills ?? [];
        if (!currentSkills.includes(name)) {
          reg.register(agentId, {
            ...agent.config,
            skills: [...currentSkills, name],
          });
        }

        broadcastAdmin({
          type: 'skill:assigned',
          name,
          agentId,
          timestamp: new Date().toISOString(),
        });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to assign skill';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Unassign skill from agent ────────────────────────────────
  app.post<{ Params: { name: string }; Body: { agentId: string } }>(
    '/api/skills/:name/unassign',
    async (req, reply) => {
      const { name } = req.params;
      const body = req.body as Record<string, unknown>;
      const agentId = body.agentId as string | undefined;

      if (!agentId) {
        return reply.code(400).send({ error: 'agentId is required' });
      }

      const agent = reg.tryGet(agentId);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${agentId}" not found` });
      }

      try {
        const currentSkills = agent.config.skills ?? [];
        reg.register(agentId, {
          ...agent.config,
          skills: currentSkills.filter((s) => s !== name),
        });

        broadcastAdmin({
          type: 'skill:unassigned',
          name,
          agentId,
          timestamp: new Date().toISOString(),
        });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to unassign skill';
        return reply.code(500).send({ error: message });
      }
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Channel Routes — /api/channels
// ═══════════════════════════════════════════════════════════════════════════

function registerChannelRoutes(app: FastifyInstance, deps: GatewayDeps): void {

  // ── List all channels with status ──────────────────────────────
  app.get('/api/channels', async () => {
    const channels = Array.from(deps.channels.entries()).map(([name, adapter]) => ({
      name,
      connected: adapter.isConnected(),
    }));
    return { channels };
  });

  // ── Get single channel status ──────────────────────────────────
  app.get<{ Params: { name: string } }>('/api/channels/:name', async (req, reply) => {
    const adapter = deps.channels.get(req.params.name);
    if (!adapter) {
      return reply.code(404).send({ error: `Channel "${req.params.name}" not found` });
    }
    return { name: adapter.name, connected: adapter.isConnected() };
  });

  // ── Connect a channel ──────────────────────────────────────────
  app.post<{ Params: { name: string } }>('/api/channels/:name/connect', async (req, reply) => {
    const { name } = req.params;
    const adapter = deps.channels.get(name);
    if (!adapter) {
      return reply.code(404).send({ error: `Channel "${name}" not found` });
    }
    if (adapter.isConnected()) {
      return reply.code(400).send({ error: `Channel "${name}" is already connected` });
    }

    try {
      await adapter.connect();
      broadcastAdmin({ type: 'channel:connected', name, timestamp: new Date().toISOString() });
      return { success: true, connected: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect channel';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Disconnect a channel ───────────────────────────────────────
  app.post<{ Params: { name: string } }>('/api/channels/:name/disconnect', async (req, reply) => {
    const { name } = req.params;
    const adapter = deps.channels.get(name);
    if (!adapter) {
      return reply.code(404).send({ error: `Channel "${name}" not found` });
    }
    if (!adapter.isConnected()) {
      return reply.code(400).send({ error: `Channel "${name}" is not connected` });
    }

    try {
      await adapter.disconnect();
      broadcastAdmin({ type: 'channel:disconnected', name, timestamp: new Date().toISOString() });
      return { success: true, connected: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect channel';
      return reply.code(500).send({ error: message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Cron Routes — /api/cron
// ═══════════════════════════════════════════════════════════════════════════

function registerCronRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { store } = deps;

  // ── List cron jobs ─────────────────────────────────────────────
  app.get('/api/cron', async () => {
    const jobs = store.listCronJobs();
    return { jobs };
  });

  // ── Create cron job ────────────────────────────────────────────
  app.post<{
    Body: {
      name: string;
      schedule: string;
      agentId: string;
      prompt: string;
      deliverTo?: string;
      enabled?: boolean;
    };
  }>('/api/cron', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const name = body.name as string | undefined;
    const schedule = body.schedule as string | undefined;
    const agentId = body.agentId as string | undefined;
    const prompt = body.prompt as string | undefined;
    const deliverTo = body.deliverTo as string | undefined;
    const enabled = body.enabled as boolean | undefined;

    if (!name || !schedule || !agentId || !prompt) {
      return reply.code(400).send({
        error: 'name, schedule, agentId, and prompt are required',
      });
    }

    if (!deps.agentRegistry.has(agentId)) {
      return reply.code(400).send({ error: `Agent "${agentId}" not found` });
    }

    try {
      const job = store.createCronJob({
        name,
        schedule,
        agentId,
        prompt,
        deliverTo: deliverTo ?? undefined,
      });

      // Disable immediately after creation if the caller requested it.
      if (enabled === false) {
        store.disableCronJob(job.id);
      }

      broadcastAdmin({
        type: 'cron:created',
        jobId: job.id,
        name,
        timestamp: new Date().toISOString(),
      });
      const fresh = store.getCronJob(job.id);
      return reply.code(201).send({ success: true, job: fresh });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create cron job';
      return reply.code(400).send({ error: message });
    }
  });

  // ── Update cron job ────────────────────────────────────────────
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      schedule?: string;
      agentId?: string;
      prompt?: string;
      deliverTo?: string;
      enabled?: boolean;
    };
  }>('/api/cron/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid cron job ID' });
    }

    const existing = store.getCronJob(id);
    if (!existing) {
      return reply.code(404).send({ error: `Cron job ${id} not found` });
    }

    const body = req.body as Record<string, unknown>;

    // Validate agent if being changed.
    if (typeof body.agentId === 'string' && !deps.agentRegistry.has(body.agentId)) {
      return reply.code(400).send({ error: `Agent "${body.agentId}" not found` });
    }

    try {
      // Build SET clauses dynamically.  Use the store's raw db handle
      // because the Store class only exposes enable/disable helpers, not
      // a general update method.
      const sets: string[] = [];
      const params: (string | number | null)[] = [];

      if (typeof body.name === 'string')     { sets.push('name = ?');      params.push(body.name); }
      if (typeof body.schedule === 'string') { sets.push('schedule = ?');  params.push(body.schedule); }
      if (typeof body.agentId === 'string')  { sets.push('agent_id = ?'); params.push(body.agentId); }
      if (typeof body.prompt === 'string')   { sets.push('prompt = ?');    params.push(body.prompt); }
      if (body.deliverTo !== undefined)       { sets.push('deliver_to = ?'); params.push(typeof body.deliverTo === 'string' ? body.deliverTo : null); }
      if (typeof body.enabled === 'boolean') { sets.push('enabled = ?');   params.push(body.enabled ? 1 : 0); }

      if (sets.length > 0) {
        params.push(id);
        const sql = `UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = ?`;
        store.raw.prepare(sql).run(...params);
      }

      broadcastAdmin({ type: 'cron:updated', jobId: id, timestamp: new Date().toISOString() });
      const updated = store.getCronJob(id);
      return { success: true, job: updated };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update cron job';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Delete cron job ────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/cron/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid cron job ID' });
    }

    const existing = store.getCronJob(id);
    if (!existing) {
      return reply.code(404).send({ error: `Cron job ${id} not found` });
    }

    try {
      store.deleteCronJob(id);
      broadcastAdmin({ type: 'cron:deleted', jobId: id, timestamp: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete cron job';
      return reply.code(500).send({ error: message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Config Routes — /api/config
// ═══════════════════════════════════════════════════════════════════════════

function registerConfigRoutes(app: FastifyInstance, deps: GatewayDeps): void {

  // ── Get global config ──────────────────────────────────────────
  app.get('/api/config', async () => {
    return { config: deps.config };
  });

  // ── Update global config ───────────────────────────────────────
  app.put<{ Body: Record<string, unknown> }>('/api/config', async (req, reply) => {
    try {
      const validated = ConfigSchema.parse(req.body);

      // Replace config in-place so that all references see the update.
      Object.assign(deps.config, validated);

      // Persist to disk via the config module.
      const { saveConfig } = await import('../config/index.js');
      saveConfig(deps.config);

      broadcastAdmin({ type: 'config:updated', timestamp: new Date().toISOString() });
      return { success: true, config: deps.config };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid configuration';
      return reply.code(400).send({ error: message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Chat Routes — /api/chat
// ═══════════════════════════════════════════════════════════════════════════

function registerChatRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');

  // ── Get chat history (conversations list or single conversation messages)
  app.get<{ Querystring: { agentId?: string; conversationId?: string } }>(
    '/api/chat/history',
    async (req, reply) => {
      const query = req.query as Record<string, string>;
      const agentId = query.agentId;
      if (!agentId) {
        reply.code(400);
        return { error: 'agentId query parameter is required' };
      }
      const chatData = loadAgentChatData(cladeHome, agentId);

      // If conversationId provided, return that conversation's messages
      if (query.conversationId) {
        const conv = chatData.conversations[query.conversationId];
        if (!conv) {
          reply.code(404);
          return { error: 'Conversation not found' };
        }
        return {
          conversation: {
            id: conv.id,
            label: conv.label,
            createdAt: conv.createdAt,
            lastActiveAt: conv.lastActiveAt,
          },
          messages: conv.messages,
        };
      }

      // Otherwise return conversation list summary
      const conversations = chatData.order
        .map((cid) => {
          const conv = chatData.conversations[cid];
          if (!conv) return null;
          const lastMsg =
            conv.messages.length > 0
              ? conv.messages[conv.messages.length - 1]
              : null;
          return {
            id: conv.id,
            label: conv.label,
            messageCount: conv.messages.length,
            createdAt: conv.createdAt,
            lastActiveAt: conv.lastActiveAt,
            lastMessage: lastMsg
              ? {
                  text: lastMsg.text.slice(0, 100),
                  role: lastMsg.role,
                  timestamp: lastMsg.timestamp,
                }
              : null,
          };
        })
        .filter(Boolean);
      return { conversations };
    },
  );

  // ── Create new conversation ─────────────────────────────────────
  app.post<{ Body: { agentId: string; label?: string } }>(
    '/api/chat/conversations',
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const agentId = body?.agentId as string;
      if (!agentId) {
        reply.code(400);
        return { error: 'agentId is required' };
      }
      if (!deps.agentRegistry.has(agentId)) {
        reply.code(404);
        return { error: `Agent "${agentId}" not found` };
      }
      const conv = createConversation(
        cladeHome,
        agentId,
        body?.label as string | undefined,
      );
      return {
        conversation: {
          id: conv.id,
          label: conv.label,
          createdAt: conv.createdAt,
          lastActiveAt: conv.lastActiveAt,
          messageCount: 0,
        },
      };
    },
  );

  // ── Delete one conversation ─────────────────────────────────────
  app.delete<{ Params: { id: string }; Querystring: { agentId?: string } }>(
    '/api/chat/conversations/:id',
    async (req, reply) => {
      const { id } = req.params;
      const agentId = (req.query as Record<string, string>).agentId;
      if (!agentId) {
        reply.code(400);
        return { error: 'agentId query parameter is required' };
      }
      const data = loadAgentChatData(cladeHome, agentId);
      if (!data.conversations[id]) {
        reply.code(404);
        return { error: 'Conversation not found' };
      }
      delete data.conversations[id];
      data.order = data.order.filter((cid) => cid !== id);
      saveAgentChatData(cladeHome, agentId, data);
      return { success: true };
    },
  );

  // ── Clear all conversations for agent ───────────────────────────
  app.delete<{ Querystring: { agentId?: string } }>(
    '/api/chat/conversations',
    async (req, reply) => {
      const agentId = (req.query as Record<string, string>).agentId;
      if (!agentId) {
        reply.code(400);
        return { error: 'agentId query parameter is required' };
      }
      const data = emptyAgentChatData();
      saveAgentChatData(cladeHome, agentId, data);
      return { success: true };
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// User Routes — /api/user (global USER.md)
// ═══════════════════════════════════════════════════════════════════════════

function registerUserRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const userMdPath = getUserMdPath();
  const userHistoryDir = getUserHistoryDir();

  // ── Get USER.md content ─────────────────────────────────────────
  app.get('/api/user', async () => {
    try {
      if (!existsSync(userMdPath)) {
        return { content: DEFAULT_USER_MD };
      }
      const content = readFileSync(userMdPath, 'utf-8');
      return { content };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read USER.md';
      return { error: message };
    }
  });

  // ── Update USER.md content ──────────────────────────────────────
  app.put<{ Body: { content: string } }>('/api/user', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const content = body.content;

    if (typeof content !== 'string') {
      return reply.code(400).send({ error: 'content must be a string' });
    }

    try {
      // Ensure history directory exists
      mkdirSync(userHistoryDir, { recursive: true });

      // Save version before updating
      saveVersion(userMdPath, userHistoryDir);

      // Write the new content
      writeFileSync(userMdPath, content, 'utf-8');
      broadcastAdmin({
        type: 'user:updated',
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update USER.md';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Get USER.md version history ─────────────────────────────────
  app.get('/api/user/history', async () => {
    try {
      const entries = getVersionHistory(userHistoryDir);
      return { entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get history';
      return { error: message, entries: [] };
    }
  });

  // ── Get specific USER.md version ────────────────────────────────
  app.get<{ Params: { date: string } }>('/api/user/history/:date', async (req, reply) => {
    const { date } = req.params;

    try {
      const content = getVersionContent(userHistoryDir, date);
      if (content === null) {
        return reply.code(404).send({ error: `No history entry for date "${date}"` });
      }
      return { date, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read history entry';
      return reply.code(500).send({ error: message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS.md Routes — /api/agents/:id/tools-md (per-agent)
// ═══════════════════════════════════════════════════════════════════════════

function registerToolsMdRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { agentRegistry: reg } = deps;

  // ── Get TOOLS.md content ────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/agents/:id/tools-md', async (req, reply) => {
    const { id } = req.params;
    const agent = reg.tryGet(id);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    const toolsMdPath = join(agent.baseDir, 'TOOLS.md');
    try {
      if (!existsSync(toolsMdPath)) {
        return { agentId: id, content: DEFAULT_TOOLS_MD };
      }
      const content = readFileSync(toolsMdPath, 'utf-8');
      return { agentId: id, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read TOOLS.md';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Update TOOLS.md content ─────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { content: string } }>(
    '/api/agents/:id/tools-md',
    async (req, reply) => {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;
      const content = body.content;

      if (typeof content !== 'string') {
        return reply.code(400).send({ error: 'content must be a string' });
      }

      const agent = reg.tryGet(id);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      const toolsMdPath = join(agent.baseDir, 'TOOLS.md');
      const toolsHistoryDir = join(agent.baseDir, 'tools-history');

      try {
        // Ensure history directory exists
        mkdirSync(toolsHistoryDir, { recursive: true });

        // Save version before updating
        saveVersion(toolsMdPath, toolsHistoryDir);

        // Write the new content
        writeFileSync(toolsMdPath, content, 'utf-8');
        broadcastAdmin({
          type: 'agent:tools-md-updated',
          agentId: id,
          timestamp: new Date().toISOString(),
        });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update TOOLS.md';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Get TOOLS.md version history ────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/agents/:id/tools-md/history', async (req, reply) => {
    const { id } = req.params;
    const agent = reg.tryGet(id);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    const toolsHistoryDir = join(agent.baseDir, 'tools-history');
    try {
      const entries = getVersionHistory(toolsHistoryDir);
      return { agentId: id, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get history';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Get specific TOOLS.md version ───────────────────────────────
  app.get<{ Params: { id: string; date: string } }>(
    '/api/agents/:id/tools-md/history/:date',
    async (req, reply) => {
      const { id, date } = req.params;
      const agent = reg.tryGet(id);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      const toolsHistoryDir = join(agent.baseDir, 'tools-history');
      try {
        const content = getVersionContent(toolsHistoryDir, date);
        if (content === null) {
          return reply.code(404).send({ error: `No history entry for date "${date}"` });
        }
        return { agentId: id, date, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read history entry';
        return reply.code(500).send({ error: message });
      }
    },
  );

  // ── Get SOUL.md version history ─────────────────────────────────
  // (Adding here since it completes the soul-history feature)
  app.get<{ Params: { id: string } }>('/api/agents/:id/soul/history', async (req, reply) => {
    const { id } = req.params;
    const agent = reg.tryGet(id);
    if (!agent) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    const soulHistoryDir = join(agent.baseDir, 'soul-history');
    try {
      const entries = getVersionHistory(soulHistoryDir);
      return { agentId: id, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get history';
      return reply.code(500).send({ error: message });
    }
  });

  // ── Get specific SOUL.md version ────────────────────────────────
  app.get<{ Params: { id: string; date: string } }>(
    '/api/agents/:id/soul/history/:date',
    async (req, reply) => {
      const { id, date } = req.params;
      const agent = reg.tryGet(id);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      const soulHistoryDir = join(agent.baseDir, 'soul-history');
      try {
        const content = getVersionContent(soulHistoryDir, date);
        if (content === null) {
          return reply.code(404).send({ error: `No history entry for date "${date}"` });
        }
        return { agentId: id, date, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read history entry';
        return reply.code(500).send({ error: message });
      }
    },
  );
}

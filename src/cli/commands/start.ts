import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { listTemplates, getTemplate, configFromTemplate } from '../../agents/templates.js';
import { DEFAULT_SOUL, DEFAULT_HEARTBEAT } from '../../config/defaults.js';

interface StartOptions {
  port?: string;
  host?: string;
  verbose?: boolean;
}

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the Clade gateway server')
    .option('-p, --port <port>', 'Override gateway port')
    .option('--host <host>', 'Override gateway host')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (opts: StartOptions) => {
      try {
        await runStart(opts);
      } catch (err: unknown) {
        console.error(
          'Failed to start:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function runStart(opts: StartOptions): Promise<void> {
  const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  const configPath = join(cladeHome, 'config.json');

  // Auto-bootstrap if no config exists
  if (!existsSync(configPath)) {
    bootstrapDefaultConfig(cladeHome, configPath);
  }

  let config: Record<string, unknown>;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    console.error(
      'Error: Failed to parse config.json:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }

  // Apply CLI overrides
  const gateway = (config.gateway ?? {}) as Record<string, unknown>;
  const port = opts.port ? parseInt(opts.port, 10) : (gateway.port as number) ?? 7890;
  const host = opts.host ?? (gateway.host as string) ?? '0.0.0.0';

  if (opts.verbose) {
    console.log('Config loaded from:', configPath);
    console.log('Gateway config:', { port, host });
  }

  console.log(`\n  Clade Gateway\n`);
  console.log(`  Starting server on ${host}:${port}...\n`);

  // Graceful shutdown handler
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  Received ${signal}. Shutting down gracefully...\n`);

    // Allow time for cleanup then force exit
    setTimeout(() => {
      console.log('  Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start the placeholder server directly.
  // The full gateway (server.ts) requires runtime deps (Store, SessionManager,
  // AgentRegistry, Channels) that are wired up by the orchestration layer.
  // The placeholder provides all admin UI functionality without those deps.
  await startPlaceholderServer(port, host, config);
}

/**
 * Create a minimal default config so `clade start` works out of the box.
 * No agents, no channels — just the gateway.
 */
function bootstrapDefaultConfig(cladeHome: string, configPath: string): void {
  console.log('  No config found. Creating default configuration...\n');

  // Create directory structure
  const dirs = [
    cladeHome,
    join(cladeHome, 'agents'),
    join(cladeHome, 'skills'),
    join(cladeHome, 'skills', 'active'),
    join(cladeHome, 'skills', 'pending'),
    join(cladeHome, 'data'),
    join(cladeHome, 'data', 'chats'),
    join(cladeHome, 'data', 'uploads'),
    join(cladeHome, 'logs'),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  const config = {
    version: 2,
    agents: {},
    channels: {
      webchat: { enabled: true },
    },
    gateway: {
      port: 7890,
      host: '0.0.0.0',
    },
    routing: {
      defaultAgent: '',
      rules: [],
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`  [ok] Created ${configPath}`);
  console.log('  [ok] Created ~/.clade/ directory structure');
  console.log('');
  console.log('  Tip: Add agents with "clade agent add <name>"');
  console.log('  Tip: Run "clade setup" for interactive channel configuration\n');
}

/**
 * Locate admin.html by searching known paths relative to this file.
 * Works both from source (src/cli/commands/) and from built output (dist/cli/commands/).
 */
function findAdminHtml(): string | null {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = __dirname ?? process.cwd();
  }

  // After tsup bundling, code runs from dist/bin/clade.js so dir = dist/bin/
  // Before bundling (source), dir = src/cli/commands/
  const candidates = [
    join(dir, '..', 'gateway', 'admin.html'),                    // dist/bin/ → dist/gateway/admin.html
    join(dir, '..', '..', 'gateway', 'admin.html'),              // src/cli/commands/ → src/gateway/admin.html
    join(dir, '..', '..', 'src', 'gateway', 'admin.html'),      // dist/bin/ → src/gateway/admin.html
    join(dir, '..', '..', '..', 'src', 'gateway', 'admin.html'), // dist/cli/commands/ → src/gateway/admin.html
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

// ── Chat message types & storage ──────────────────────────────────────

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

/** Format byte sizes for human display */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Generate a short label from the first user message */
function generateLabel(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 30) return cleaned;
  const truncated = cleaned.slice(0, 30);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 15 ? truncated.slice(0, lastSpace) : truncated) + '...';
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
      // Migrate into a single conversation
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
      // Persist migrated format
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

/** Append a message to a specific conversation */
function saveChatMessage(cladeHome: string, msg: ChatMessage, conversationId: string): void {
  const data = loadAgentChatData(cladeHome, msg.agentId);
  const conv = data.conversations[conversationId];
  if (!conv) return;
  conv.messages.push(msg);
  conv.lastActiveAt = msg.timestamp;
  // Auto-generate label from first user message if still default
  if (conv.label === 'New chat' && msg.role === 'user') {
    conv.label = generateLabel(msg.text);
  }
  // Move conversation to front of order
  data.order = [conversationId, ...data.order.filter(id => id !== conversationId)];
  saveAgentChatData(cladeHome, msg.agentId, data);
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

/** Build a dynamic identity/team-awareness context string for an agent */
function buildAgentContext(
  agentId: string,
  agents: Record<string, Record<string, unknown>>,
): string {
  const self = agents[agentId];
  if (!self) return '';

  const selfName = (self.name as string) || agentId;
  const selfDesc = (self.description as string) || '';

  const lines: string[] = [
    `You are ${selfName}, an agent on the Clade multi-agent platform.`,
  ];
  if (selfDesc) lines.push(`Your role: ${selfDesc}`);

  // Build teammate list
  const teammates = Object.entries(agents)
    .filter(([id]) => id !== agentId)
    .map(([id, a]) => {
      const name = (a.name as string) || id;
      const desc = (a.description as string) || '';
      return desc ? `- ${name}: ${desc}` : `- ${name}`;
    });

  if (teammates.length > 0) {
    lines.push('');
    lines.push('Your team:');
    lines.push(...teammates);
    lines.push('');
    lines.push('You can reference these agents when relevant.');
  }

  return lines.join('\n');
}

/** Map conversationId → claude session ID for resume support */
const sessionMap = new Map<string, string>();

/** Spawn claude CLI to get an agent response, with optional session resume */
function askClaude(
  prompt: string,
  soulPath: string | null,
  agentContext?: string,
  conversationId?: string,
): Promise<{ text: string; sessionId?: string }> {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];

    // Resume existing session if we have one for this conversation
    if (conversationId && sessionMap.has(conversationId)) {
      args.push('--resume', sessionMap.get(conversationId)!);
    }

    // Build combined system prompt: agent context first, then SOUL.md
    const systemParts: string[] = [];
    if (agentContext?.trim()) {
      systemParts.push(agentContext.trim());
    }
    if (soulPath && existsSync(soulPath)) {
      const soul = readFileSync(soulPath, 'utf-8');
      if (soul.trim()) {
        systemParts.push(soul.trim());
      }
    }
    if (systemParts.length > 0) {
      args.push('--append-system-prompt', systemParts.join('\n\n'));
    }

    let stdout = '';
    let stderr = '';
    const child = spawn('claude', args, {
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        // Parse stream-json output to extract text and session ID
        let resultText = '';
        let resultSessionId: string | undefined;
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'result' && event.result) {
              // event.result is a string in claude CLI stream-json format
              resultText = typeof event.result === 'string'
                ? event.result
                : (event.result.text || event.result.content || '');
              resultSessionId = event.session_id || (typeof event.result === 'object' ? event.result.session_id : undefined);
            } else if (event.type === 'assistant' && event.message?.content) {
              // Accumulate text from assistant messages
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  resultText += block.text;
                }
              }
            } else if (event.type === 'content_block_delta' && event.delta?.text) {
              resultText += event.delta.text;
            }
            // Check for session_id in any event
            if (event.session_id && !resultSessionId) {
              resultSessionId = event.session_id;
            }
          } catch {
            // Not JSON, might be plain text
            if (!line.startsWith('{')) {
              resultText += line;
            }
          }
        }

        // Store session ID for future resume
        if (conversationId && resultSessionId) {
          sessionMap.set(conversationId, resultSessionId);
        }

        resolve({
          text: resultText.trim() || 'I received your message but could not parse the response.',
          sessionId: resultSessionId,
        });
      } else {
        resolve({
          text: stderr.trim() || 'Sorry, I could not generate a response. Is the `claude` CLI installed and authenticated?',
        });
      }
    });

    child.on('error', () => {
      resolve({
        text: 'The `claude` CLI is not installed or not in PATH. Install it to enable agent responses.',
      });
    });
  });
}

/**
 * Minimal server that serves the admin dashboard, health check, and config API.
 * Used when the full gateway (with session manager, store, etc.) isn't available.
 */
async function startPlaceholderServer(
  port: number,
  host: string,
  config: Record<string, unknown>,
): Promise<void> {
  const { default: Fastify } = await import('fastify');
  const fastify = Fastify({ logger: false });

  // ── WebSocket support for admin dashboard ─────────────────────
  const wsMod = await import('@fastify/websocket').catch(() => null);
  const wsClients = new Set<import('ws').WebSocket>();
  if (wsMod) {
    await fastify.register(wsMod.default, { options: { maxPayload: 16 * 1024 * 1024 } });
    fastify.get('/ws/admin', { websocket: true }, (socket) => {
      wsClients.add(socket);
      socket.on('close', () => wsClients.delete(socket));
    });
  }

  // ── WebSocket /ws for chat ────────────────────────────────────
  const chatClients = new Map<string, import('ws').WebSocket>();
  if (wsMod) {
    fastify.get('/ws', { websocket: true }, (socket) => {
      const clientId = 'client_' + randomUUID().slice(0, 8);
      chatClients.set(clientId, socket);

      // Send connected acknowledgement
      socket.send(JSON.stringify({ type: 'connected', clientId }));

      socket.on('message', async (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
          if (msg.type === 'message' && msg.agentId && msg.text) {
            const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
            const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;

            if (!agents[msg.agentId]) {
              socket.send(JSON.stringify({ type: 'error', text: `Agent "${msg.agentId}" not found` }));
              return;
            }

            // Resolve or create conversation
            let conversationId: string = msg.conversationId || '';
            if (!conversationId) {
              const conv = createConversation(cladeHome, msg.agentId);
              conversationId = conv.id;
            }

            // Process attachments if present
            const savedAttachments: ChatAttachment[] = [];
            const incomingAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
            const uploadsDir = join(cladeHome, 'data', 'uploads');
            mkdirSync(uploadsDir, { recursive: true });

            for (const att of incomingAttachments) {
              if (!att.name || !att.data) continue;
              const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
              const filename = randomUUID().slice(0, 8) + '-' + safeName;
              const filePath = join(uploadsDir, filename);
              const buffer = Buffer.from(att.data, 'base64');
              writeFileSync(filePath, buffer);
              savedAttachments.push({
                name: att.name,
                type: att.type || 'application/octet-stream',
                size: buffer.length,
                url: '/uploads/' + filename,
              });
            }

            // Save user message
            const userMsg: ChatMessage = {
              id: 'msg_' + randomUUID().slice(0, 12),
              agentId: msg.agentId,
              role: 'user',
              text: msg.text,
              timestamp: new Date().toISOString(),
              ...(savedAttachments.length > 0 ? { attachments: savedAttachments } : {}),
            };
            saveChatMessage(cladeHome, userMsg, conversationId);

            // Confirm user message saved
            socket.send(JSON.stringify({ type: 'message_ack', message: userMsg, conversationId }));

            // Send typing indicator
            socket.send(JSON.stringify({ type: 'typing', agentId: msg.agentId, conversationId }));

            // Build prompt with attachment context
            let promptText = msg.text;
            if (savedAttachments.length > 0) {
              const attachmentNotes: string[] = [];
              for (const att of savedAttachments) {
                if (att.type.startsWith('text/') || att.name.endsWith('.md') || att.name.endsWith('.json') || att.name.endsWith('.csv') || att.name.endsWith('.xml') || att.name.endsWith('.yaml') || att.name.endsWith('.yml') || att.name.endsWith('.log') || att.name.endsWith('.txt')) {
                  // Inline text file contents
                  try {
                    const content = readFileSync(join(uploadsDir, att.url.replace('/uploads/', '')), 'utf-8');
                    attachmentNotes.push(`[Attached file: ${att.name}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``);
                  } catch {
                    attachmentNotes.push(`[Attached file: ${att.name} (could not read)]`);
                  }
                } else if (att.type.startsWith('image/')) {
                  attachmentNotes.push(`[Attached image: ${att.name} (${formatBytes(att.size)})]`);
                } else {
                  attachmentNotes.push(`[Attached file: ${att.name} (${att.type}, ${formatBytes(att.size)})]`);
                }
              }
              promptText = promptText + '\n\n' + attachmentNotes.join('\n\n');
            }

            // Build agent identity context and spawn Claude CLI
            const agentContext = buildAgentContext(msg.agentId, agents);
            const soulPath = join(cladeHome, 'agents', msg.agentId, 'SOUL.md');
            const result = await askClaude(promptText, soulPath, agentContext, conversationId);
            const responseText = result.text;

            // Save assistant message
            const assistantMsg: ChatMessage = {
              id: 'msg_' + randomUUID().slice(0, 12),
              agentId: msg.agentId,
              role: 'assistant',
              text: responseText,
              timestamp: new Date().toISOString(),
            };
            saveChatMessage(cladeHome, assistantMsg, conversationId);

            // Send response
            socket.send(JSON.stringify({ type: 'message', message: assistantMsg, conversationId }));
          }
        } catch (err) {
          socket.send(JSON.stringify({
            type: 'error',
            text: 'Failed to process message: ' + (err instanceof Error ? err.message : String(err)),
          }));
        }
      });

      socket.on('close', () => {
        chatClients.delete(clientId);
      });
    });
  }

  // ── Chat REST endpoints ─────────────────────────────────────
  fastify.get<{ Querystring: { agentId?: string; conversationId?: string } }>('/api/chat/history', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const agentId = query.agentId;
    if (!agentId) {
      reply.status(400);
      return { error: 'agentId query parameter is required' };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const chatData = loadAgentChatData(cladeHome, agentId);

    // If conversationId provided, return that conversation's messages
    if (query.conversationId) {
      const conv = chatData.conversations[query.conversationId];
      if (!conv) {
        reply.status(404);
        return { error: 'Conversation not found' };
      }
      return { conversation: { id: conv.id, label: conv.label, createdAt: conv.createdAt, lastActiveAt: conv.lastActiveAt }, messages: conv.messages };
    }

    // Otherwise return conversation list summary
    const conversations = chatData.order.map(cid => {
      const conv = chatData.conversations[cid];
      if (!conv) return null;
      const lastMsg = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
      return {
        id: conv.id,
        label: conv.label,
        messageCount: conv.messages.length,
        createdAt: conv.createdAt,
        lastActiveAt: conv.lastActiveAt,
        lastMessage: lastMsg ? { text: lastMsg.text.slice(0, 100), role: lastMsg.role, timestamp: lastMsg.timestamp } : null,
      };
    }).filter(Boolean);
    return { conversations };
  });

  // Create new conversation
  fastify.post<{ Body: { agentId: string; label?: string } }>('/api/chat/conversations', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const agentId = body?.agentId as string;
    if (!agentId) {
      reply.status(400);
      return { error: 'agentId is required' };
    }
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    if (!agents[agentId]) {
      reply.status(404);
      return { error: `Agent "${agentId}" not found` };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const conv = createConversation(cladeHome, agentId, body?.label as string | undefined);
    return { conversation: { id: conv.id, label: conv.label, createdAt: conv.createdAt, lastActiveAt: conv.lastActiveAt, messageCount: 0 } };
  });

  // Delete one conversation
  fastify.delete<{ Params: { id: string }; Querystring: { agentId?: string } }>('/api/chat/conversations/:id', async (req, reply) => {
    const { id } = req.params;
    const agentId = (req.query as Record<string, string>).agentId;
    if (!agentId) {
      reply.status(400);
      return { error: 'agentId query parameter is required' };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const data = loadAgentChatData(cladeHome, agentId);
    if (!data.conversations[id]) {
      reply.status(404);
      return { error: 'Conversation not found' };
    }
    delete data.conversations[id];
    data.order = data.order.filter(cid => cid !== id);
    saveAgentChatData(cladeHome, agentId, data);
    return { success: true };
  });

  // Clear all conversations for agent
  fastify.delete<{ Querystring: { agentId?: string } }>('/api/chat/conversations', async (req, reply) => {
    const agentId = (req.query as Record<string, string>).agentId;
    if (!agentId) {
      reply.status(400);
      return { error: 'agentId query parameter is required' };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const data = emptyAgentChatData();
    saveAgentChatData(cladeHome, agentId, data);
    return { success: true };
  });

  // ── File uploads endpoint ─────────────────────────────────────
  fastify.get<{ Params: { filename: string } }>('/uploads/:filename', async (req, reply) => {
    const { filename } = req.params;
    // Directory traversal protection
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      reply.status(400);
      return { error: 'Invalid filename' };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const filePath = join(cladeHome, 'data', 'uploads', filename);
    if (!existsSync(filePath)) {
      reply.status(404);
      return { error: 'File not found' };
    }
    // Determine MIME type from extension
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
      pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
      json: 'application/json', csv: 'text/csv', xml: 'application/xml',
      html: 'text/html', css: 'text/css', js: 'application/javascript',
      zip: 'application/zip', gz: 'application/gzip',
      yaml: 'text/yaml', yml: 'text/yaml', log: 'text/plain',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const data = readFileSync(filePath);
    reply.type(contentType).send(data);
  });

  // ── Health check ──────────────────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
  }));

  // ── Config API ───────────────────────────────────────────────
  fastify.get('/api/config', async () => {
    return { config };
  });

  // ── Stub API endpoints so the admin UI doesn't get errors ─────
  fastify.get('/api/agents', async () => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    return {
      agents: Object.entries(agents).map(([id, a]) => ({
        id,
        name: a.name ?? id,
        description: a.description ?? '',
        model: a.model ?? 'sonnet',
        toolPreset: a.toolPreset ?? 'full',
        emoji: a.emoji ?? '',
      })),
    };
  });

  // ── Get specific agent ────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    const a = agents[id];
    if (!a) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    return { agent: { id, ...a } };
  });

  // ── Get agent SOUL.md ───────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/soul', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const soulPath = join(cladeHome, 'agents', id, 'SOUL.md');
    try {
      const content = readFileSync(soulPath, 'utf-8');
      return { agentId: id, content };
    } catch {
      return { agentId: id, content: '' };
    }
  });

  // ── Update agent SOUL.md ────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/agents/:id/soul', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const body = req.body as Record<string, unknown>;
    const content = body.content;
    if (typeof content !== 'string') {
      reply.status(400);
      return { error: 'content must be a string' };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const soulPath = join(cladeHome, 'agents', id, 'SOUL.md');
    writeFileSync(soulPath, content, 'utf-8');
    return { success: true };
  });

  // ── Get agent HEARTBEAT.md ──────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/heartbeat', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const hbPath = join(cladeHome, 'agents', id, 'HEARTBEAT.md');
    try {
      const content = readFileSync(hbPath, 'utf-8');
      return { agentId: id, content };
    } catch {
      return { agentId: id, content: '' };
    }
  });

  // ── Update agent HEARTBEAT.md ───────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/agents/:id/heartbeat', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const body = req.body as Record<string, unknown>;
    const content = body.content;
    if (typeof content !== 'string') {
      reply.status(400);
      return { error: 'content must be a string' };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const hbPath = join(cladeHome, 'agents', id, 'HEARTBEAT.md');
    writeFileSync(hbPath, content, 'utf-8');
    return { success: true };
  });

  // ── List agent memory files ─────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/memory', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const baseDir = join(cladeHome, 'agents', id);
    const memoryDir = join(baseDir, 'memory');
    const files: string[] = [];

    // Include MEMORY.md
    const memoryMdPath = join(baseDir, 'MEMORY.md');
    if (existsSync(memoryMdPath)) {
      files.push('MEMORY.md');
    }

    // Include daily log files from memory/ subdirectory
    if (existsSync(memoryDir)) {
      try {
        const { readdirSync } = await import('node:fs');
        const entries = readdirSync(memoryDir).filter(
          (f: string) => f.endsWith('.md') && !f.startsWith('.'),
        );
        for (const entry of entries) {
          files.push(`memory/${entry}`);
        }
      } catch {}
    }

    return { agentId: id, files };
  });

  // ── Read specific memory file ──────────────────────────────
  fastify.get<{ Params: { id: string; file: string } }>('/api/agents/:id/memory/:file', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id, file } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }

    // Reject path traversal
    if (file.includes('..') || file.startsWith('/')) {
      reply.status(400);
      return { error: 'Invalid file path' };
    }

    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const baseDir = join(cladeHome, 'agents', id);
    const memoryDir = join(baseDir, 'memory');
    let resolvedPath: string;

    if (file === 'MEMORY.md') {
      resolvedPath = join(baseDir, 'MEMORY.md');
    } else {
      // Only allow .md files, no nesting
      const filename = file.startsWith('memory/') ? file.slice(7) : file;
      if (filename.includes('/') || filename.includes('\\') || !filename.endsWith('.md')) {
        reply.status(400);
        return { error: 'Invalid file path' };
      }
      resolvedPath = join(memoryDir, filename);
    }

    if (!existsSync(resolvedPath)) {
      reply.status(404);
      return { error: `Memory file "${file}" not found` };
    }

    try {
      const content = readFileSync(resolvedPath, 'utf-8');
      return { agentId: id, file, content };
    } catch (err) {
      reply.status(500);
      return { error: 'Failed to read memory file' };
    }
  });

  // ── Search agent memory ────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/agents/:id/memory/search', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const body = req.body as Record<string, unknown>;
    const query = body.query;
    if (!query || typeof query !== 'string') {
      reply.status(400);
      return { error: 'query is required and must be a string' };
    }

    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const baseDir = join(cladeHome, 'agents', id);
    const memoryDir = join(baseDir, 'memory');
    const results: Array<{ file: string; snippet: string }> = [];
    const queryLower = query.toLowerCase();

    // Search MEMORY.md
    const memoryMdPath = join(baseDir, 'MEMORY.md');
    if (existsSync(memoryMdPath)) {
      try {
        const content = readFileSync(memoryMdPath, 'utf-8');
        if (content.toLowerCase().includes(queryLower)) {
          const lines = content.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes(queryLower)) {
              results.push({ file: 'MEMORY.md', snippet: line.trim() });
            }
          }
        }
      } catch {}
    }

    // Search memory/*.md files
    if (existsSync(memoryDir)) {
      try {
        const { readdirSync: rd } = await import('node:fs');
        const entries = rd(memoryDir).filter((f: string) => f.endsWith('.md'));
        for (const entry of entries) {
          try {
            const content = readFileSync(join(memoryDir, entry), 'utf-8');
            if (content.toLowerCase().includes(queryLower)) {
              const lines = content.split('\n');
              for (const line of lines) {
                if (line.toLowerCase().includes(queryLower)) {
                  results.push({ file: `memory/${entry}`, snippet: line.trim() });
                }
              }
            }
          } catch {}
        }
      } catch {}
    }

    return { agentId: id, query, results };
  });

  // ── Update agent config (PUT) ───────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const body = req.body as Record<string, unknown>;
    agents[id] = { ...agents[id], ...body };
    (config as Record<string, unknown>).agents = agents;
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { agent: { id, ...agents[id] } };
  });

  // ── Delete agent ────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    delete agents[id];
    (config as Record<string, unknown>).agents = agents;
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  });

  // ── Get full config ─────────────────────────────────────────
  fastify.get('/api/config/full', async () => config);

  // ── Update full config ──────────────────────────────────────
  fastify.put('/api/config', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      reply.status(400);
      return { error: 'Invalid config' };
    }
    Object.assign(config, body);
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  });

  fastify.get('/api/sessions', async () => {
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const sessions: Array<Record<string, unknown>> = [];
    for (const agentId of Object.keys(agents)) {
      const data = loadAgentChatData(cladeHome, agentId);
      for (const convId of data.order) {
        const conv = data.conversations[convId];
        if (!conv) continue;
        const lastActive = new Date(conv.lastActiveAt).getTime();
        sessions.push({
          id: conv.id,
          agentId: conv.agentId,
          channel: 'webchat',
          status: lastActive > fiveMinAgo ? 'active' : 'idle',
          lastActiveAt: conv.lastActiveAt,
          label: conv.label,
          messageCount: conv.messages.length,
        });
      }
    }
    sessions.sort((a, b) => new Date(b.lastActiveAt as string).getTime() - new Date(a.lastActiveAt as string).getTime());
    return { sessions };
  });
  fastify.get('/api/skills', async () => ({ skills: [] }));
  fastify.get('/api/channels', async () => ({ channels: [] }));
  fastify.get('/api/cron', async () => ({ jobs: [] }));

  // ── Templates API ──────────────────────────────────────────
  fastify.get('/api/templates', async () => {
    const templates = listTemplates().map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      toolPreset: t.toolPreset,
      model: t.model,
      heartbeat: t.heartbeat,
    }));
    return { templates };
  });

  // ── Agent creation API ─────────────────────────────────────
  fastify.post('/api/agents', async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || !body.name) {
      reply.status(400);
      return { error: 'Agent name is required' };
    }

    const agentName = String(body.name).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;

    if (agents[agentName]) {
      reply.status(409);
      return { error: `Agent "${agentName}" already exists` };
    }

    // Build agent config from template or custom fields
    const templateId = String(body.template || 'coding');
    const isCustom = templateId === 'custom';
    const template = isCustom ? undefined : getTemplate(templateId);
    let agentConfig: Record<string, unknown>;

    // Identity defaults per template type
    const IDENTITY_DEFAULTS: Record<string, { creature: string; vibe: string; emoji: string }> = {
      coding:   { creature: 'Code architect', vibe: 'precise, focused, pragmatic', emoji: '\u{1F4BB}' },
      research: { creature: 'Knowledge seeker', vibe: 'curious, thorough, analytical', emoji: '\u{1F50D}' },
      ops:      { creature: 'System sentinel', vibe: 'vigilant, calm, reliable', emoji: '\u{1F4E1}' },
      pm:       { creature: 'Project navigator', vibe: 'organized, clear, supportive', emoji: '\u{1F4CB}' },
      custom:   { creature: 'AI assistant', vibe: 'helpful, adaptive, thoughtful', emoji: '\u{2728}' },
    };
    const identityDefaults = IDENTITY_DEFAULTS[templateId] || IDENTITY_DEFAULTS['custom'];

    if (template) {
      const built = configFromTemplate(template, {
        name: String(body.description || template.name),
        model: body.model ? String(body.model) : undefined,
      });
      agentConfig = {
        ...built,
        name: body.description || template.name,
        creature: identityDefaults.creature,
        vibe: identityDefaults.vibe,
        emoji: identityDefaults.emoji,
        avatar: '',
      };
    } else {
      // Custom agent — use fields from request body
      const hbEnabled = body.heartbeatEnabled !== undefined ? Boolean(body.heartbeatEnabled) : true;
      const hbInterval = body.heartbeatInterval ? String(body.heartbeatInterval) : '30m';
      agentConfig = {
        name: String(body.description || agentName),
        description: String(body.agentDescription || ''),
        model: String(body.model || 'sonnet'),
        toolPreset: String(body.toolPreset || 'full'),
        customTools: [],
        skills: [],
        heartbeat: { enabled: hbEnabled, interval: hbInterval, mode: 'check', suppressOk: true },
        reflection: { enabled: true, interval: 10 },
        maxTurns: 25,
        notifications: { minSeverity: 'info', batchDigest: false, digestIntervalMinutes: 30 },
        creature: identityDefaults.creature,
        vibe: identityDefaults.vibe,
        emoji: identityDefaults.emoji,
        avatar: '',
      };
    }

    // Create agent directory structure
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const agentDir = join(cladeHome, 'agents', agentName);
    mkdirSync(join(agentDir, 'memory'), { recursive: true });
    mkdirSync(join(agentDir, 'soul-history'), { recursive: true });

    // Write SOUL.md, MEMORY.md, HEARTBEAT.md
    // Custom agents can provide their own content; templates use seeds; fallback to defaults
    const soulOut = (isCustom && body.soulContent) ? String(body.soulContent) : (template?.soulSeed ?? DEFAULT_SOUL);
    const hbOut = (isCustom && body.heartbeatContent) ? String(body.heartbeatContent) : (template?.heartbeatSeed ?? DEFAULT_HEARTBEAT);
    writeFileSync(join(agentDir, 'SOUL.md'), soulOut, 'utf-8');
    writeFileSync(join(agentDir, 'MEMORY.md'), '# Memory\n\n_Curated knowledge and observations._\n', 'utf-8');
    writeFileSync(join(agentDir, 'HEARTBEAT.md'), hbOut, 'utf-8');

    // Update config.json
    agents[agentName] = agentConfig;
    (config as Record<string, unknown>).agents = agents;
    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log(`  [ok] Created agent "${agentName}" (${isCustom ? 'custom' : 'template: ' + templateId})`);

    return {
      agent: {
        id: agentName,
        name: agentConfig.name,
        description: agentConfig.description ?? '',
        model: agentConfig.model ?? 'sonnet',
        toolPreset: agentConfig.toolPreset ?? 'full',
      },
    };
  });

  // ── Admin dashboard ───────────────────────────────────────────
  const adminHtmlPath = findAdminHtml();

  fastify.get('/admin', async (_req, reply) => {
    if (adminHtmlPath) {
      const html = readFileSync(adminHtmlPath, 'utf-8');
      reply.type('text/html').send(html);
    } else {
      reply.type('text/html').send(FALLBACK_ADMIN_HTML);
    }
  });

  // ── Root redirects to admin ───────────────────────────────────
  fastify.get('/', async (_req, reply) => {
    reply.redirect('/admin');
  });

  await fastify.listen({ port, host });

  const agentCount = Object.keys(
    (config.agents ?? {}) as Record<string, unknown>,
  ).length;
  const channelList = Object.entries(
    (config.channels ?? {}) as Record<string, { enabled?: boolean }>,
  )
    .filter(([, v]) => v.enabled)
    .map(([k]) => k);

  console.log(`  Server listening on http://${host}:${port}`);
  console.log(`  Agents: ${agentCount}`);
  console.log(`  Channels: ${channelList.join(', ') || 'none'}`);
  console.log(`\n  Health check: http://${host}:${port}/health`);
  console.log(`  Admin UI:     http://${host}:${port}/admin`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  await new Promise(() => {});
}

const FALLBACK_ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clade Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f1117; color: #e6edf3; font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { text-align: center; max-width: 480px; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { color: #8b949e; margin-bottom: 2rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; text-align: left; }
    .card h3 { font-size: 0.875rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
    .link { color: #58a6ff; text-decoration: none; display: block; padding: 0.25rem 0; }
    .link:hover { text-decoration: underline; }
    .tip { color: #8b949e; font-size: 0.875rem; margin-top: 1.5rem; }
    code { background: #161b22; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Clade</h1>
    <p class="subtitle">Gateway is running</p>
    <div class="card">
      <h3>API Endpoints</h3>
      <a class="link" href="/health">/health</a>
      <a class="link" href="/api/config">/api/config</a>
      <a class="link" href="/api/agents">/api/agents</a>
      <a class="link" href="/api/sessions">/api/sessions</a>
    </div>
    <p class="tip">Add agents with <code>clade agent create --name jarvis --template coding</code></p>
  </div>
</body>
</html>`;

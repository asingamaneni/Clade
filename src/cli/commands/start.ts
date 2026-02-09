import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, watch, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { listTemplates, getTemplate, configFromTemplate } from '../../agents/templates.js';
import { resolveAllowedTools } from '../../agents/presets.js';
import { DEFAULT_SOUL, DEFAULT_HEARTBEAT, DEFAULT_USER_MD, DEFAULT_TOOLS_MD } from '../../config/defaults.js';
import { runReflectionCycle } from '../../agents/reflection.js';
import { saveVersion, getVersionHistory, getVersionContent } from '../../agents/versioning.js';
import { type ActivityEvent, loadActivityLog, saveActivityLog, logActivity } from '../../utils/activity.js';
import { performBackup, getBackupStatus, getBackupHistory, isBackupInProgress } from '../../backup/backup.js';
import { MemoryStore } from '../../mcp/memory/store.js';
import { embeddingProvider } from '../../mcp/memory/embeddings.js';

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

    // Shut down managed Chrome browser
    shutdownBrowser();

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
    join(cladeHome, 'mcp'),
    join(cladeHome, 'mcp', 'active'),
    join(cladeHome, 'mcp', 'pending'),
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
    browser: {
      enabled: true,
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

/** Track connected channel adapter names (populated after server starts) */
const activeChannelNames = new Set<string>();

/** Track adapter instances so we can connect/disconnect via API */
const channelAdapters = new Map<string, import('../../channels/base.js').ChannelAdapter>();

/** Track in-flight claude processes for cancellation, keyed by conversationId */
const inflightProcesses = new Map<string, AbortController>();

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

// ---------------------------------------------------------------------------
// Persistent session mapping (disk-backed)
// ---------------------------------------------------------------------------

/** Path to the session-map JSON file */
function sessionMapPath(cladeHome: string): string {
  return join(cladeHome, 'data', 'session-map.json');
}

/** Load all conversation→session mappings from disk */
function loadSessionMap(cladeHome: string): Record<string, string> {
  try {
    const raw = readFileSync(sessionMapPath(cladeHome), 'utf-8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Save a single conversation→session mapping to disk */
function saveSessionMapping(cladeHome: string, convId: string, sessionId: string): void {
  const map = loadSessionMap(cladeHome);
  map[convId] = sessionId;
  const mapDir = join(cladeHome, 'data');
  mkdirSync(mapDir, { recursive: true });
  writeFileSync(sessionMapPath(cladeHome), JSON.stringify(map, null, 2), 'utf-8');
}

/** Retrieve session ID for a conversation */
function getSessionId(cladeHome: string, convId: string): string | undefined {
  return loadSessionMap(cladeHome)[convId];
}

// ---------------------------------------------------------------------------
// MCP config builder for placeholder server
// ---------------------------------------------------------------------------

/**
 * Locate the dist directory containing MCP server scripts.
 * Works from both bundled (dist/bin/clade.js) and source (src/cli/commands/) paths.
 */
function findMcpServerScript(serverName: string): string | null {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = __dirname ?? process.cwd();
  }

  const scriptName = `${serverName}-server.js`;
  const candidates = [
    join(dir, '..', 'mcp', scriptName),         // dist/bin/ → dist/mcp/
    join(dir, '..', '..', 'mcp', scriptName),    // dist/cli/commands/ → dist/mcp/
    join(dir, '..', '..', 'dist', 'mcp', scriptName), // src/cli/commands/ → dist/mcp/
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Build a temporary MCP config file for an agent, so it has access to
 * memory, sessions, and mcp-manager tools during chat.
 */
function buildMcpConfigForAgent(
  agentId: string,
  cladeHome: string,
  toolPreset: string,
  browserConfig?: { enabled?: boolean; userDataDir?: string; browser?: string; cdpEndpoint?: string; headless?: boolean },
): string | undefined {
  // Determine which MCP servers this preset needs
  const MCP_SERVERS_BY_PRESET: Record<string, string[]> = {
    potato: [],
    coding: ['memory', 'sessions', 'mcp-manager'],
    messaging: ['memory', 'sessions', 'messaging', 'mcp-manager'],
    full: ['memory', 'sessions', 'messaging', 'mcp-manager'],
    custom: ['memory', 'sessions'],
  };

  const servers = MCP_SERVERS_BY_PRESET[toolPreset] ?? ['memory', 'sessions'];
  if (servers.length === 0) return undefined;

  const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

  for (const serverName of servers) {
    const scriptPath = findMcpServerScript(serverName);
    if (!scriptPath) continue;

    mcpServers[serverName] = {
      command: 'node',
      args: [scriptPath],
      env: {
        CLADE_AGENT_ID: agentId,
        CLADE_HOME: cladeHome,
        ...(process.env['CLADE_IPC_SOCKET'] ? { CLADE_IPC_SOCKET: process.env['CLADE_IPC_SOCKET'] } : {}),
      },
    };
  }

  if (Object.keys(mcpServers).length === 0) return undefined;

  // Also add any active third-party MCP servers
  const activeMcpDir = join(cladeHome, 'mcp', 'active');
  if (existsSync(activeMcpDir)) {
    try {
      const entries = readdirSync(activeMcpDir);
      for (const entry of entries) {
        const configPath = join(activeMcpDir, entry, 'mcp.json');
        if (existsSync(configPath)) {
          try {
            const raw = readFileSync(configPath, 'utf-8');
            const mcpCfg = JSON.parse(raw) as { command: string; args: string[]; env?: Record<string, string> };
            mcpServers[`mcp_${entry}`] = mcpCfg;
          } catch { /* skip malformed MCP configs */ }
        }
      }
    } catch { /* skip if unreadable */ }
  }

  // Inject Playwright browser MCP if enabled
  if (browserConfig?.enabled) {
    const pwArgs: string[] = ['@playwright/mcp@latest'];
    const defaultProfileDir = join(cladeHome, 'browser-profile');
    const userDataDir = browserConfig.userDataDir || defaultProfileDir;
    mkdirSync(userDataDir, { recursive: true });
    pwArgs.push('--user-data-dir', userDataDir);

    if (browserConfig.cdpEndpoint) {
      pwArgs.push('--cdp-endpoint', browserConfig.cdpEndpoint);
    } else {
      if (browserConfig.browser && browserConfig.browser !== 'chromium') {
        pwArgs.push('--browser', browserConfig.browser);
      }
      if (browserConfig.headless) {
        pwArgs.push('--headless');
      }
    }

    mcpServers['playwright'] = { command: 'npx', args: pwArgs };
  }

  // Write to temp file
  const tmpDir = join(tmpdir(), 'clade-mcp');
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, `${agentId}-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(tmpPath, JSON.stringify({ mcpServers }, null, 2), 'utf-8');
  return tmpPath;
}

/** Clean up a temporary MCP config file (best-effort) */
function cleanupMcpConfig(path: string | undefined): void {
  if (!path) return;
  try { unlinkSync(path); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// CDP browser management — shared Chrome instance for all agents
// ---------------------------------------------------------------------------

/** The CDP WebSocket endpoint URL, set after Chrome is launched */
let cdpEndpointUrl: string | undefined;

/** The Chrome child process, tracked for cleanup on shutdown */
let chromeProcess: ReturnType<typeof spawn> | undefined;

/**
 * Launch Chrome with remote debugging enabled so agents can connect via CDP.
 * Uses the user's actual Chrome profile for logged-in state.
 * Returns the WebSocket debugger URL.
 */
async function launchBrowserForAgents(
  browserConfig: { enabled?: boolean; userDataDir?: string; browser?: string; cdpEndpoint?: string; headless?: boolean },
  cladeHome: string,
): Promise<string | undefined> {
  if (!browserConfig.enabled) return undefined;

  // If user provided an explicit CDP endpoint, use it directly
  if (browserConfig.cdpEndpoint) {
    cdpEndpointUrl = browserConfig.cdpEndpoint;
    console.log(`  [ok] Using existing CDP endpoint: ${browserConfig.cdpEndpoint}`);
    return browserConfig.cdpEndpoint;
  }

  const debugPort = 9222;

  // Check if Chrome already has debugging enabled on this port
  try {
    const resp = await fetch(`http://localhost:${debugPort}/json/version`);
    if (resp.ok) {
      const data = await resp.json() as { webSocketDebuggerUrl?: string };
      if (data.webSocketDebuggerUrl) {
        cdpEndpointUrl = data.webSocketDebuggerUrl;
        console.log(`  [ok] Connected to existing Chrome debug session on port ${debugPort}`);
        return cdpEndpointUrl;
      }
    }
  } catch {
    // No Chrome with debugging running — we'll launch one
  }

  // Determine Chrome binary path
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  const chromeBin = chromePaths.find(p => existsSync(p));
  if (!chromeBin) {
    console.error('  [!!] Chrome not found — browser tools will not be available');
    return undefined;
  }

  // Use a dedicated Clade browser profile — separate from the user's personal
  // Chrome so both can run simultaneously. Logins persist across agent sessions.
  const defaultProfileDir = join(cladeHome, 'browser-profile');
  const userDataDir = browserConfig.userDataDir || defaultProfileDir;
  mkdirSync(userDataDir, { recursive: true });

  // Remove stale SingletonLock if present (left over from a crash/kill)
  const lockFile = join(userDataDir, 'SingletonLock');
  try { unlinkSync(lockFile); } catch { /* doesn't exist */ }

  // Launch Chrome with remote debugging
  const chromeArgs = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (browserConfig.headless) {
    chromeArgs.push('--headless=new');
  }

  chromeProcess = spawn(chromeBin, chromeArgs, {
    stdio: 'ignore',
    detached: true,
  });
  chromeProcess.unref();

  // Wait for CDP endpoint to become available (up to 10s)
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const resp = await fetch(`http://localhost:${debugPort}/json/version`);
      if (resp.ok) {
        const data = await resp.json() as { webSocketDebuggerUrl?: string };
        if (data.webSocketDebuggerUrl) {
          cdpEndpointUrl = data.webSocketDebuggerUrl;
          console.log(`  [ok] Chrome launched with CDP on port ${debugPort} (profile: ${userDataDir})`);
          return cdpEndpointUrl;
        }
      }
    } catch {
      // Keep waiting
    }
  }

  console.error('  [!!] Chrome launched but CDP endpoint not available — browser tools may not work');
  return undefined;
}

/** Shut down the managed Chrome process */
function shutdownBrowser(): void {
  if (chromeProcess) {
    try { chromeProcess.kill(); } catch { /* best effort */ }
    chromeProcess = undefined;
  }
  cdpEndpointUrl = undefined;
}

// ---------------------------------------------------------------------------
// askClaude — spawn claude CLI with full MCP + memory context
// ---------------------------------------------------------------------------

/** Spawn claude CLI to get an agent response, with MCP tools and memory */
function askClaude(
  prompt: string,
  soulPath: string | null,
  agentContext?: string,
  conversationId?: string,
  agentId?: string,
  cladeHome?: string,
  toolPreset?: string,
  browserConfig?: { enabled?: boolean; userDataDir?: string; browser?: string; cdpEndpoint?: string; headless?: boolean },
  signal?: AbortSignal,
): Promise<{ text: string; sessionId?: string; cancelled?: boolean }> {
  const home = cladeHome || process.env['CLADE_HOME'] || join(homedir(), '.clade');
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--add-dir', '/', '--permission-mode', 'bypassPermissions'];

    // Resume existing session if we have one for this conversation
    if (conversationId) {
      const existingSessionId = getSessionId(home, conversationId);
      if (existingSessionId) {
        args.push('--resume', existingSessionId);
      }
    }

    // Build combined system prompt: agent context + SOUL.md + USER.md + MEMORY.md
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

    // Inject global USER.md so agent knows about the human
    const userMdPath = join(home, 'USER.md');
    if (existsSync(userMdPath)) {
      const userMd = readFileSync(userMdPath, 'utf-8').trim();
      if (userMd) {
        systemParts.push('## About Your Human\n\n' + userMd);
      }
    }

    // Inject TOOLS.md for workspace context
    if (agentId) {
      const toolsMdPath = join(home, 'agents', agentId, 'TOOLS.md');
      if (existsSync(toolsMdPath)) {
        const toolsMd = readFileSync(toolsMdPath, 'utf-8').trim();
        const defaultToolsMd = '# Workspace Tools\n\n_Custom commands, scripts, and workflows for this agent._';
        if (toolsMd && toolsMd !== defaultToolsMd) {
          systemParts.push('## Workspace Context\n\n' + toolsMd);
        }
      }
    }

    // Inject MEMORY.md so the agent starts with persistent context
    if (agentId) {
      const memoryPath = join(home, 'agents', agentId, 'MEMORY.md');
      if (existsSync(memoryPath)) {
        const memory = readFileSync(memoryPath, 'utf-8').trim();
        const defaultMemory = '# Memory\n\n_Curated knowledge and observations._';
        if (memory && memory !== defaultMemory && memory !== '# Memory\n_Curated knowledge and observations._') {
          systemParts.push('## Your Persistent Memory\n\nThe following is your curated long-term memory. Use it as context:\n\n' + memory);
        }
      }

      // Also inject recent daily log if it exists (last 24h context)
      const today = new Date().toISOString().split('T')[0];
      const dailyLogPath = join(home, 'agents', agentId, 'memory', `${today}.md`);
      if (existsSync(dailyLogPath)) {
        const dailyLog = readFileSync(dailyLogPath, 'utf-8').trim();
        if (dailyLog) {
          // Truncate to last ~2000 chars to avoid blowing context
          const truncated = dailyLog.length > 2000
            ? '...\n' + dailyLog.slice(-2000)
            : dailyLog;
          systemParts.push('## Today\'s Activity Log\n\n' + truncated);
        }
      }
    }

    if (systemParts.length > 0) {
      args.push('--append-system-prompt', systemParts.join('\n\n'));
    }

    // Build and pass MCP config so agent has access to memory/mcp-manager/sessions tools
    const mcpConfigPath = (agentId && toolPreset)
      ? buildMcpConfigForAgent(agentId, home, toolPreset, browserConfig)
      : buildMcpConfigForAgent(agentId || 'default', home, 'coding', browserConfig);

    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
    }

    // Pass --allowedTools so the CLI permits MCP tool use in -p mode
    const preset = (toolPreset || 'full') as import('../../config/schema.js').ToolPreset;
    const allowedTools = resolveAllowedTools(preset);
    if (allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(','));
    }

    // Check if already aborted before spawning
    if (signal?.aborted) {
      cleanupMcpConfig(mcpConfigPath);
      return resolve({ text: '', cancelled: true });
    }

    let stdout = '';
    let stderr = '';
    const child = spawn('claude', args, {
      timeout: 300_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // Wire up abort signal to kill the child process
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      try { child.kill('SIGTERM'); } catch { /* already exited */ }
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      // Clean up abort listener
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }

      // If aborted, return cancellation result
      if (aborted) {
        cleanupMcpConfig(mcpConfigPath);
        return resolve({ text: '', cancelled: true });
      }
      // Parse stream-json output regardless of exit code — tool-heavy
      // sessions may time out or miss the final result event (known CLI
      // bug) but still produce valid assistant messages in stdout.
      let resultText = '';
      let lastAssistantText = '';
      let resultSessionId: string | undefined;

      if (stdout.trim()) {
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'result') {
              // Prefer explicit result text if present
              if (event.result) {
                const r = typeof event.result === 'string'
                  ? event.result
                  : (event.result.text || event.result.content || '');
                if (r) resultText = r;
              }
              if (event.session_id) resultSessionId = event.session_id;
            } else if (event.type === 'assistant' && event.message?.content) {
              // Track the last assistant text block (not cumulative —
              // only the final turn's text is what the user should see)
              let turnText = '';
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  turnText += block.text;
                }
              }
              if (turnText) lastAssistantText = turnText;
            } else if (event.type === 'content_block_delta' && event.delta?.text) {
              lastAssistantText += event.delta.text;
            }
            // Capture session_id from any event
            if (event.session_id && !resultSessionId) {
              resultSessionId = event.session_id;
            }
          } catch {
            // Not JSON, might be plain text
            if (!line.startsWith('{')) {
              lastAssistantText += line;
            }
          }
        }
      }

      // Use result text if available, otherwise fall back to last
      // assistant message (covers timeout / missing result event cases)
      const finalText = resultText.trim() || lastAssistantText.trim();

      // Store session ID for future resume (persistent to disk)
      if (conversationId && resultSessionId) {
        saveSessionMapping(home, conversationId, resultSessionId);
      }

      cleanupMcpConfig(mcpConfigPath);

      if (finalText) {
        resolve({ text: finalText, sessionId: resultSessionId });
      } else if (code !== 0 && stderr.trim()) {
        // Only show CLI error if we got no useful output at all
        resolve({ text: stderr.trim() });
      } else {
        resolve({
          text: 'Sorry, I could not generate a response. Is the `claude` CLI installed and authenticated?',
        });
      }
    });

    child.on('error', () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      cleanupMcpConfig(mcpConfigPath);
      if (aborted) {
        resolve({ text: '', cancelled: true });
      } else {
        resolve({
          text: 'The `claude` CLI is not installed or not in PATH. Install it to enable agent responses.',
        });
      }
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
  const memoryStores = new Map<string, MemoryStore>();

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

          // ── Handle cancel requests ──────────────────────────────
          if (msg.type === 'cancel' && msg.conversationId) {
            const controller = inflightProcesses.get(msg.conversationId);
            if (controller) {
              controller.abort();
              inflightProcesses.delete(msg.conversationId);
              socket.send(JSON.stringify({ type: 'cancelled', conversationId: msg.conversationId }));
            } else {
              socket.send(JSON.stringify({ type: 'error', text: 'No active request for this conversation' }));
            }
            return;
          }

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

            // Build agent identity context and spawn Claude CLI with MCP tools + memory
            const agentContext = buildAgentContext(msg.agentId, agents);
            const soulPath = join(cladeHome, 'agents', msg.agentId, 'SOUL.md');
            const agentCfg = agents[msg.agentId] ?? {};
            const toolPreset = (agentCfg.toolPreset as string) || 'coding';
            const browserCfg = { ...(config.browser ?? {}) } as { enabled?: boolean; userDataDir?: string; browser?: string; cdpEndpoint?: string; headless?: boolean };
            if (cdpEndpointUrl) browserCfg.cdpEndpoint = cdpEndpointUrl;

            // Cancel any existing in-flight request for this conversation
            const existingController = inflightProcesses.get(conversationId);
            if (existingController) {
              existingController.abort();
              inflightProcesses.delete(conversationId);
            }

            // Create AbortController for this request
            const abortController = new AbortController();
            inflightProcesses.set(conversationId, abortController);

            try {
              const result = await askClaude(promptText, soulPath, agentContext, conversationId, msg.agentId, cladeHome, toolPreset, browserCfg, abortController.signal);

              // If cancelled, don't save or send a response
              if (result.cancelled) {
                return;
              }

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

              // Log chat activity
              const agentDisplayName = (agentCfg.name as string) || msg.agentId;
              logActivityLocal({
                type: 'chat',
                agentId: msg.agentId,
                title: `Chat with ${agentDisplayName}`,
                description: msg.text.slice(0, 200),
                metadata: { conversationId, userMessage: msg.text, assistantMessage: responseText },
              });

              // Fire reflection cycle in background (non-blocking)
              if (msg.agentId) {
                const reflCfg = (agentCfg.reflection ?? {}) as { enabled?: boolean };
                if (reflCfg.enabled !== false) {
                  runReflectionCycle(msg.agentId).catch(() => {});
                }
              }
            } finally {
              inflightProcesses.delete(conversationId);
            }
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

  // ── Cancel in-flight request ────────────────────────────────────
  fastify.post<{ Body: { conversationId: string } }>('/api/chat/cancel', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const conversationId = body?.conversationId as string;
    if (!conversationId) {
      reply.status(400);
      return { error: 'conversationId is required' };
    }
    const controller = inflightProcesses.get(conversationId);
    if (!controller) {
      reply.status(404);
      return { error: 'No active request for this conversation' };
    }
    controller.abort();
    inflightProcesses.delete(conversationId);
    return { success: true, conversationId };
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
        admin: a.admin ?? undefined,
        skills: a.skills ?? [],
        mcp: a.mcp ?? [],
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

  // ── Get reflection status ───────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/reflection', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    try {
      const { getReflectionStatus: getStatus } = await import('../../agents/reflection.js');
      const status = getStatus(id);
      return { agentId: id, ...status };
    } catch {
      return { agentId: id, sessionsSinceReflection: 0, lastReflection: new Date(0).toISOString(), reflectionInterval: 10, enabled: true };
    }
  });

  // ── Trigger reflection manually ─────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/agents/:id/reflection', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    try {
      const result = await runReflectionCycle(id, true);
      return { triggered: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reflection cycle failed';
      reply.status(500);
      return { error: message };
    }
  });

  // ── Get reflection history ──────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/reflection/history', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    try {
      const { getReflectionHistory: getHistory } = await import('../../agents/reflection.js');
      const entries = getHistory(id);
      return { agentId: id, entries };
    } catch {
      return { agentId: id, entries: [] };
    }
  });

  // ── Get specific reflection history entry ─────────────────
  fastify.get<{ Params: { id: string; date: string } }>('/api/agents/:id/reflection/history/:date', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id, date } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    try {
      const { getReflectionHistoryEntry: getEntry } = await import('../../agents/reflection.js');
      const content = getEntry(id, date);
      if (content === null) {
        reply.status(404);
        return { error: `No history entry for date "${date}"` };
      }
      return { agentId: id, date, content };
    } catch {
      reply.status(500);
      return { error: 'Failed to read history entry' };
    }
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

  // ── Search agent memory (FTS5 + vector hybrid) ────────────
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
    const agentDir = join(cladeHome, 'agents', id);

    try {
      // Get or create a MemoryStore for this agent
      let store = memoryStores.get(id);
      if (!store) {
        const dbPath = join(agentDir, 'memory.db');
        store = new MemoryStore(dbPath);
        store.reindexAll(agentDir);
        memoryStores.set(id, store);
      } else {
        store.reindexChanged(agentDir);
      }

      const limit = typeof (body as any).limit === 'number' ? (body as any).limit : 20;
      const mode = typeof (body as any).mode === 'string' ? (body as any).mode : 'keyword';

      let searchResults;
      const useVector = (mode === 'semantic' || mode === 'hybrid') && store.hasEmbeddings();

      if (useVector) {
        try {
          const queryEmbedding = await embeddingProvider.embed(query);
          if (mode === 'hybrid') {
            searchResults = store.hybridSearch(query, queryEmbedding, limit);
          } else {
            searchResults = store.vectorSearch(queryEmbedding, limit);
          }
        } catch {
          searchResults = store.search(query, limit);
        }
      } else {
        searchResults = store.search(query, limit);
      }

      const results = searchResults.map(r => ({
        file: r.filePath,
        snippet: r.chunkText.length > 300
          ? r.chunkText.slice(0, 300) + '…'
          : r.chunkText,
        rank: r.rank,
        similarity: r.similarity,
      }));

      return { agentId: id, query, mode: useVector ? mode : 'keyword', results };
    } catch (err) {
      reply.status(500);
      return { error: 'Memory search failed' };
    }
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

    logActivityLocal({
      type: 'agent',
      agentId: id,
      title: `Agent "${id}" deleted`,
      description: `Agent removed from configuration`,
      metadata: { action: 'delete' },
    });

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
  fastify.get('/api/mcp', async () => {
    const mcpDir = join(homedir(), '.clade', 'mcp');
    const mcpServers: Array<{ name: string; status: 'active' | 'pending'; description?: string; path: string }> = [];

    // Read active MCP servers
    const activeDir = join(mcpDir, 'active');
    if (existsSync(activeDir)) {
      for (const name of readdirSync(activeDir)) {
        const mcpPath = join(activeDir, name);
        const descMd = join(mcpPath, 'SKILL.md');
        let description = '';
        if (existsSync(descMd)) {
          const content = readFileSync(descMd, 'utf-8');
          const descMatch = content.match(/^#[^\n]*\n+([^\n]+)/);
          if (descMatch) description = descMatch[1].trim();
        }
        mcpServers.push({ name, status: 'active', description, path: mcpPath });
      }
    }

    // Read pending MCP servers
    const pendingDir = join(mcpDir, 'pending');
    if (existsSync(pendingDir)) {
      for (const name of readdirSync(pendingDir)) {
        const mcpPath = join(pendingDir, name);
        const descMd = join(mcpPath, 'SKILL.md');
        let description = '';
        if (existsSync(descMd)) {
          const content = readFileSync(descMd, 'utf-8');
          const descMatch = content.match(/^#[^\n]*\n+([^\n]+)/);
          if (descMatch) description = descMatch[1].trim();
        }
        mcpServers.push({ name, status: 'pending', description, path: mcpPath });
      }
    }

    return { mcpServers };
  });

  // ── Get MCP server details ───────────────────────────────────
  fastify.get<{ Params: { status: string; name: string } }>('/api/mcp/:status/:name', async (req, reply) => {
    const { status, name } = req.params;

    if (status !== 'active' && status !== 'pending') {
      reply.status(400);
      return { error: 'Status must be "active" or "pending"' };
    }

    const mcpDir = join(homedir(), '.clade', 'mcp');
    const mcpPath = join(mcpDir, status, name);

    if (!existsSync(mcpPath)) {
      reply.status(404);
      return { error: `MCP server "${name}" not found in ${status}` };
    }

    // Get list of files in MCP server directory
    const files: Array<{ name: string; size: number; content?: string }> = [];
    const entries = readdirSync(mcpPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = join(mcpPath, entry.name);
        const stats = { size: 0 };
        try {
          const s = require('fs').statSync(filePath);
          stats.size = s.size;
        } catch {}

        // Read content for small text files
        let content: string | undefined;
        const textExtensions = ['.md', '.json', '.txt', '.js', '.ts', '.yaml', '.yml'];
        const isTextFile = textExtensions.some(ext => entry.name.toLowerCase().endsWith(ext));

        if (isTextFile && stats.size < 50000) { // 50KB limit
          try {
            content = readFileSync(filePath, 'utf-8');
          } catch {}
        }

        files.push({ name: entry.name, size: stats.size, content });
      } else if (entry.isDirectory()) {
        // Just note that it's a directory
        files.push({ name: entry.name + '/', size: 0 });
      }
    }

    // Sort: directories first, then files alphabetically
    files.sort((a, b) => {
      const aIsDir = a.name.endsWith('/');
      const bIsDir = b.name.endsWith('/');
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      name,
      status,
      path: mcpPath,
      files,
    };
  });

  // ── Approve pending MCP server ───────────────────────────────
  fastify.post<{ Params: { name: string } }>('/api/mcp/:name/approve', async (req, reply) => {
    const { name } = req.params;
    const mcpDir = join(homedir(), '.clade', 'mcp');
    const pendingPath = join(mcpDir, 'pending', name);
    const activePath = join(mcpDir, 'active', name);

    if (!existsSync(pendingPath)) {
      reply.status(404);
      return { error: `Pending MCP server "${name}" not found` };
    }

    try {
      mkdirSync(join(mcpDir, 'active'), { recursive: true });
      renameSync(pendingPath, activePath);

      logActivityLocal({
        type: 'mcp',
        title: `MCP server "${name}" approved`,
        description: 'Approved and moved to active',
        metadata: { action: 'approve', mcpName: name },
      });

      return { success: true, message: `MCP server "${name}" approved and moved to active` };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to approve MCP server: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ── Reject pending MCP server ────────────────────────────────
  fastify.post<{ Params: { name: string } }>('/api/mcp/:name/reject', async (req, reply) => {
    const { name } = req.params;
    const mcpDir = join(homedir(), '.clade', 'mcp');
    const pendingPath = join(mcpDir, 'pending', name);

    if (!existsSync(pendingPath)) {
      reply.status(404);
      return { error: `Pending MCP server "${name}" not found` };
    }

    try {
      rmSync(pendingPath, { recursive: true, force: true });

      logActivityLocal({
        type: 'mcp',
        title: `MCP server "${name}" rejected`,
        description: 'Rejected and removed',
        metadata: { action: 'reject', mcpName: name },
      });

      return { success: true, message: `MCP server "${name}" rejected and removed` };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to reject MCP server: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ── Remove active MCP server ─────────────────────────────────
  fastify.delete<{ Params: { name: string } }>('/api/mcp/:name', async (req, reply) => {
    const { name } = req.params;
    const mcpDir = join(homedir(), '.clade', 'mcp');
    const activePath = join(mcpDir, 'active', name);

    if (!existsSync(activePath)) {
      reply.status(404);
      return { error: `Active MCP server "${name}" not found` };
    }

    try {
      rmSync(activePath, { recursive: true, force: true });
      return { success: true, message: `MCP server "${name}" removed` };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to remove MCP server: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ── Install MCP server from npm ──────────────────────────────
  fastify.post<{ Body: { package: string } }>('/api/mcp/install', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const packageName = body.package;

    if (!packageName || typeof packageName !== 'string') {
      reply.status(400);
      return { error: 'package name is required' };
    }

    // Sanitize package name (basic validation)
    const sanitized = packageName.trim();
    if (!sanitized || sanitized.includes('..') || sanitized.includes('/') && !sanitized.startsWith('@')) {
      reply.status(400);
      return { error: 'Invalid package name' };
    }

    // Extract MCP server name from package (e.g., @mcp/weather-server -> weather-server)
    const mcpName = sanitized.startsWith('@')
      ? sanitized.split('/')[1] || sanitized
      : sanitized.replace(/^@/, '');

    const mcpDir = join(homedir(), '.clade', 'mcp');
    const pendingDir = join(mcpDir, 'pending');
    const mcpPath = join(pendingDir, mcpName);

    // Check if MCP server already exists
    if (existsSync(mcpPath) || existsSync(join(mcpDir, 'active', mcpName))) {
      reply.status(409);
      return { error: `MCP server "${mcpName}" already exists` };
    }

    try {
      // Create MCP server directory
      mkdirSync(mcpPath, { recursive: true });

      // Create package.json for npm install
      const pkgJson = {
        name: `clade-mcp-${mcpName}`,
        version: '1.0.0',
        private: true,
        dependencies: {
          [sanitized]: 'latest'
        }
      };
      writeFileSync(join(mcpPath, 'package.json'), JSON.stringify(pkgJson, null, 2));

      // Run npm install
      const npmInstall = spawn('npm', ['install', '--silent'], {
        cwd: mcpPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      npmInstall.stdout?.on('data', (data) => { stdout += data.toString(); });
      npmInstall.stderr?.on('data', (data) => { stderr += data.toString(); });

      const exitCode = await new Promise<number>((resolve) => {
        npmInstall.on('close', resolve);
        npmInstall.on('error', () => resolve(1));
      });

      if (exitCode !== 0) {
        // Cleanup on failure
        rmSync(mcpPath, { recursive: true, force: true });
        reply.status(500);
        return { error: `npm install failed: ${stderr || 'Unknown error'}` };
      }

      // Create SKILL.md description file
      const descMd = `# ${mcpName}\n\nInstalled from npm package: ${sanitized}\n`;
      writeFileSync(join(mcpPath, 'SKILL.md'), descMd);

      return {
        success: true,
        message: `MCP server "${mcpName}" installed to pending. Approve it to activate.`,
        mcpServer: { name: mcpName, status: 'pending' }
      };
    } catch (err) {
      // Cleanup on error
      if (existsSync(mcpPath)) {
        rmSync(mcpPath, { recursive: true, force: true });
      }
      reply.status(500);
      return { error: `Installation failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Skills API — /api/skills
  // ═══════════════════════════════════════════════════════════════════════

  function broadcastAdmin(msg: Record<string, unknown>): void {
    const payload = JSON.stringify(msg);
    for (const ws of wsClients) {
      try { ws.send(payload); } catch { /* ignore closed sockets */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Activity Feed — append-only event log
  // ═══════════════════════════════════════════════════════════════════════

  // Wrapper that passes broadcastAdmin to the shared logger
  function logActivityLocal(event: Omit<ActivityEvent, 'id' | 'timestamp'>): ActivityEvent {
    return logActivity(event, broadcastAdmin);
  }

  // Load and trim activity log on startup
  const startupEvents = loadActivityLog();
  if (startupEvents.length > 1000) {
    saveActivityLog(startupEvents);
  }

  const skillsCladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  const skillsDir = join(skillsCladeHome, 'skills');

  // In-memory skill metadata (lightweight store for placeholder server)
  interface SkillMeta {
    name: string;
    status: 'pending' | 'active' | 'disabled';
    description: string;
    path: string;
    created_at: string;
    approved_at: string | null;
    requestedBy: string | null;
  }
  const skillsMeta = new Map<string, SkillMeta>();

  // Scan skills from disk and merge into the in-memory map.
  // New skills found on disk (e.g. created by agent MCP subprocesses) are
  // added and trigger a WebSocket broadcast so the UI updates in real-time.
  function rescanSkillsFromDisk(broadcast = false): void {
    for (const status of ['active', 'pending', 'disabled'] as const) {
      const dir = join(skillsDir, status);
      if (!existsSync(dir)) continue;

      let entries: string[];
      try { entries = readdirSync(dir); } catch { continue; }

      for (const name of entries) {
        const skillPath = join(dir, name);
        try {
          const stat = require('fs').statSync(skillPath);
          if (!stat.isDirectory()) continue;
        } catch { continue; }

        // Already tracked and status matches — skip
        const existing = skillsMeta.get(name);
        if (existing && existing.status === status) continue;

        let description = '';
        let requestedBy: string | null = null;
        let createdAt = new Date().toISOString();

        // Read meta.json if present (written by agent skill_create tool)
        const metaPath = join(skillPath, 'meta.json');
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
            if (meta.description) description = meta.description;
            if (meta.createdBy) requestedBy = meta.createdBy;
            if (meta.createdAt) createdAt = meta.createdAt;
          } catch { /* ignore parse errors */ }
        }

        // Fall back to parsing SKILL.md header for description
        if (!description) {
          const skillMdPath = join(skillPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            try {
              const content = readFileSync(skillMdPath, 'utf-8');
              const descMatch = content.match(/^#[^\n]*\n+([^\n]+)/);
              if (descMatch) description = descMatch[1].trim();
            } catch { /* ignore */ }
          }
        }

        const isNew = !existing;
        skillsMeta.set(name, {
          name,
          status,
          description,
          path: skillPath,
          created_at: createdAt,
          approved_at: status === 'active' ? new Date().toISOString() : null,
          requestedBy,
        });

        // Broadcast only for genuinely new skills discovered on disk
        if (broadcast && isNew) {
          broadcastAdmin({
            type: 'skill:created',
            name,
            description,
            requestedBy,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  // Initial scan at startup (no broadcast — nobody is connected yet)
  rescanSkillsFromDisk(false);

  // ── List all skills ─────────────────────────────────────────
  fastify.get('/api/skills', async () => {
    // Rescan disk to pick up skills created by agent MCP subprocesses
    rescanSkillsFromDisk(true);
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const skillsList = Array.from(skillsMeta.values()).map(skill => {
      // Compute which agents have this skill assigned
      const assignedAgents: string[] = [];
      for (const [agentId, agentCfg] of Object.entries(agents)) {
        const agentSkills = (agentCfg.skills as string[]) ?? [];
        if (agentSkills.includes(skill.name)) {
          assignedAgents.push(agentId);
        }
      }
      return { ...skill, assignedAgents };
    });
    return { skills: skillsList };
  });

  // ── Install / create a new skill ────────────────────────────
  fastify.post('/api/skills/install', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const name = body.name as string | undefined;
    const description = (body.description as string) ?? '';
    const content = (body.content as string) ?? `# ${name}\n\n${description}\n`;

    if (!name || typeof name !== 'string') {
      reply.status(400);
      return { error: 'name is required' };
    }

    if (!/^[a-z0-9_-]+$/.test(name)) {
      reply.status(400);
      return { error: 'Skill name must contain only lowercase letters, numbers, hyphens, and underscores.' };
    }

    if (skillsMeta.has(name)) {
      reply.status(409);
      return { error: `Skill "${name}" already exists` };
    }

    try {
      const skillDir = join(skillsDir, 'pending', name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');

      const skill: SkillMeta = {
        name,
        status: 'pending',
        description,
        path: skillDir,
        created_at: new Date().toISOString(),
        approved_at: null,
        requestedBy: null,
      };
      skillsMeta.set(name, skill);

      broadcastAdmin({ type: 'skill:installed', name, timestamp: new Date().toISOString() });
      reply.status(201);
      return { success: true, skill };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to install skill: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ── Approve pending skill ───────────────────────────────────
  fastify.post<{ Params: { name: string } }>('/api/skills/:name/approve', async (req, reply) => {
    const { name } = req.params;
    const skill = skillsMeta.get(name);
    if (!skill) {
      reply.status(404);
      return { error: `Skill "${name}" not found` };
    }
    if (skill.status !== 'pending') {
      reply.status(400);
      return { error: `Skill "${name}" is not pending (current status: ${skill.status})` };
    }

    try {
      const pendingPath = join(skillsDir, 'pending', name);
      const activePath = join(skillsDir, 'active', name);
      mkdirSync(join(skillsDir, 'active'), { recursive: true });

      if (existsSync(pendingPath)) {
        const files = readdirSync(pendingPath);
        mkdirSync(activePath, { recursive: true });
        for (const file of files) {
          const fileContent = readFileSync(join(pendingPath, file), 'utf-8');
          writeFileSync(join(activePath, file), fileContent, 'utf-8');
        }
        rmSync(pendingPath, { recursive: true, force: true });
      }

      skill.status = 'active';
      skill.path = activePath;
      skill.approved_at = new Date().toISOString();

      // Auto-assign to the requesting agent if one exists
      let autoAssigned: string | null = null;
      if (skill.requestedBy) {
        const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
        const agent = agents[skill.requestedBy];
        if (agent) {
          const currentSkills = (agent.skills as string[]) ?? [];
          if (!currentSkills.includes(name)) {
            agent.skills = [...currentSkills, name];
            autoAssigned = skill.requestedBy;
          }
        }
      }

      broadcastAdmin({ type: 'skill:approved', name, autoAssigned, timestamp: new Date().toISOString() });

      logActivityLocal({
        type: 'skill',
        title: `Skill "${name}" approved`,
        description: autoAssigned ? `Approved and auto-assigned to ${autoAssigned}` : 'Approved and moved to active',
        metadata: { action: 'approve', skillName: name, autoAssigned },
      });

      return { success: true, skill, autoAssigned };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to approve skill: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ── Reject pending skill ────────────────────────────────────
  fastify.post<{ Params: { name: string } }>('/api/skills/:name/reject', async (req, reply) => {
    const { name } = req.params;
    const skill = skillsMeta.get(name);
    if (!skill) {
      reply.status(404);
      return { error: `Skill "${name}" not found` };
    }
    if (skill.status !== 'pending') {
      reply.status(400);
      return { error: `Skill "${name}" is not pending (current status: ${skill.status})` };
    }

    try {
      const pendingPath = join(skillsDir, 'pending', name);
      const disabledPath = join(skillsDir, 'disabled', name);
      mkdirSync(join(skillsDir, 'disabled'), { recursive: true });

      if (existsSync(pendingPath)) {
        const files = readdirSync(pendingPath);
        mkdirSync(disabledPath, { recursive: true });
        for (const file of files) {
          const fileContent = readFileSync(join(pendingPath, file), 'utf-8');
          writeFileSync(join(disabledPath, file), fileContent, 'utf-8');
        }
        rmSync(pendingPath, { recursive: true, force: true });
      }

      skill.status = 'disabled';
      skill.path = disabledPath;

      broadcastAdmin({ type: 'skill:rejected', name, timestamp: new Date().toISOString() });

      logActivityLocal({
        type: 'skill',
        title: `Skill "${name}" rejected`,
        description: 'Rejected and moved to disabled',
        metadata: { action: 'reject', skillName: name },
      });

      return { success: true };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to reject skill: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ── Delete skill permanently ────────────────────────────────
  fastify.delete<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => {
    const { name } = req.params;
    const skill = skillsMeta.get(name);
    if (!skill) {
      reply.status(404);
      return { error: `Skill "${name}" not found` };
    }

    try {
      for (const subdir of ['active', 'pending', 'disabled']) {
        const dirPath = join(skillsDir, subdir, name);
        if (existsSync(dirPath)) {
          rmSync(dirPath, { recursive: true, force: true });
        }
      }

      // Remove from agent configs
      const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
      for (const [, agentConfig] of Object.entries(agents)) {
        const agentSkills = agentConfig.skills as string[] | undefined;
        if (agentSkills?.includes(name)) {
          agentConfig.skills = agentSkills.filter((s: string) => s !== name);
        }
      }

      skillsMeta.delete(name);
      broadcastAdmin({ type: 'skill:deleted', name, timestamp: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to delete skill: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ── Get skill detail ────────────────────────────────────────
  fastify.get<{ Params: { status: string; name: string } }>('/api/skills/:status/:name', async (req, reply) => {
    const { status, name } = req.params;
    const dirPath = join(skillsDir, status, name);

    if (!existsSync(dirPath)) {
      reply.status(404);
      return { error: `Skill "${name}" not found in ${status}` };
    }

    try {
      const files = readdirSync(dirPath);
      const contents: Record<string, string> = {};
      for (const file of files) {
        contents[file] = readFileSync(join(dirPath, file), 'utf-8');
      }
      return { name, status, path: dirPath, files, contents };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to read skill: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  });

  // ── Assign skill to agent ───────────────────────────────────
  fastify.post<{ Params: { name: string } }>('/api/skills/:name/assign', async (req, reply) => {
    const { name } = req.params;
    const body = req.body as Record<string, unknown>;
    const agentId = body.agentId as string | undefined;

    if (!agentId) {
      reply.status(400);
      return { error: 'agentId is required' };
    }

    const skill = skillsMeta.get(name);
    if (!skill) {
      reply.status(404);
      return { error: `Skill "${name}" not found` };
    }

    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const agent = agents[agentId];
    if (!agent) {
      reply.status(404);
      return { error: `Agent "${agentId}" not found` };
    }

    const currentSkills = (agent.skills as string[]) ?? [];
    if (!currentSkills.includes(name)) {
      agent.skills = [...currentSkills, name];
    }

    broadcastAdmin({ type: 'skill:assigned', name, agentId, timestamp: new Date().toISOString() });

    logActivityLocal({
      type: 'skill',
      agentId,
      title: `Skill "${name}" assigned to ${agentId}`,
      description: `Skill assigned to agent`,
      metadata: { action: 'assign', skillName: name },
    });

    return { success: true };
  });

  // ── Unassign skill from agent ───────────────────────────────
  fastify.post<{ Params: { name: string } }>('/api/skills/:name/unassign', async (req, reply) => {
    const { name } = req.params;
    const body = req.body as Record<string, unknown>;
    const agentId = body.agentId as string | undefined;

    if (!agentId) {
      reply.status(400);
      return { error: 'agentId is required' };
    }

    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const agent = agents[agentId];
    if (!agent) {
      reply.status(404);
      return { error: `Agent "${agentId}" not found` };
    }

    const currentSkills = (agent.skills as string[]) ?? [];
    agent.skills = currentSkills.filter((s: string) => s !== name);

    broadcastAdmin({ type: 'skill:unassigned', name, agentId, timestamp: new Date().toISOString() });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Channels API — connect/disconnect/status
  // ═══════════════════════════════════════════════════════════════════════

  /** Check which env vars are set for each channel */
  function channelHasToken(name: string): boolean {
    switch (name) {
      case 'telegram': return !!process.env['TELEGRAM_BOT_TOKEN'];
      case 'slack': return !!process.env['SLACK_BOT_TOKEN'] && !!process.env['SLACK_APP_TOKEN'];
      case 'discord': return !!process.env['DISCORD_BOT_TOKEN'];
      case 'webchat': return true; // no token needed
      default: return false;
    }
  }

  fastify.get('/api/channels', async () => {
    const channelsCfg = (config.channels ?? {}) as Record<string, { enabled?: boolean }>;
    const allNames = ['telegram', 'slack', 'discord', 'webchat'];
    return {
      channels: allNames.map((name) => {
        const adapter = channelAdapters.get(name);
        return {
          name,
          connected: adapter ? adapter.isConnected() : false,
          configured: channelsCfg[name]?.enabled !== false,
          hasToken: channelHasToken(name),
        };
      }),
    };
  });

  fastify.post<{ Params: { name: string } }>('/api/channels/:name/connect', async (req, reply) => {
    const { name } = req.params;
    const adapter = channelAdapters.get(name);

    if (!adapter) {
      // Try to create a new adapter instance if token is now available
      const channelsCfg = (config.channels ?? {}) as Record<string, { enabled?: boolean }>;
      const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
      const created = await createChannelAdapter(name, channelsCfg, agents, config, cladeHome);
      if (!created) {
        reply.status(400);
        return { error: `Channel "${name}" cannot be connected — missing token or unsupported` };
      }
    }

    const target = channelAdapters.get(name)!;
    if (target.isConnected()) {
      return { success: true, message: 'Already connected' };
    }

    try {
      await target.connect();
      activeChannelNames.add(name);
      broadcastAdmin({ type: 'channel:connected', name, timestamp: new Date().toISOString() });
      logActivityLocal({ category: 'channel', action: `${name} connected`, agent: 'system' });
      return { success: true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      broadcastAdmin({ type: 'channel:error', name, error: errMsg, timestamp: new Date().toISOString() });
      reply.status(500);
      return { error: errMsg };
    }
  });

  fastify.post<{ Params: { name: string } }>('/api/channels/:name/disconnect', async (req, reply) => {
    const { name } = req.params;
    const adapter = channelAdapters.get(name);

    if (!adapter) {
      reply.status(404);
      return { error: `Channel "${name}" not found` };
    }

    if (!adapter.isConnected()) {
      return { success: true, message: 'Already disconnected' };
    }

    try {
      await adapter.disconnect();
      activeChannelNames.delete(name);
      broadcastAdmin({ type: 'channel:disconnected', name, timestamp: new Date().toISOString() });
      logActivityLocal({ category: 'channel', action: `${name} disconnected`, agent: 'system' });
      return { success: true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      reply.status(500);
      return { error: errMsg };
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Cron Jobs — file-based scheduler using the `cron` package
  // ═══════════════════════════════════════════════════════════════════════

  interface CronJobDef {
    id: string;
    name: string;
    schedule: string;       // standard cron expression
    agentId: string;
    prompt: string;
    timezone: string;       // IANA timezone
    enabled: boolean;
    lastRunAt: string | null;
    createdAt: string;
  }

  const cronHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  const cronDir = join(cronHome, 'cron');
  mkdirSync(cronDir, { recursive: true });
  const cronJobsPath = join(cronDir, 'jobs.json');

  function loadCronJobs(): CronJobDef[] {
    if (!existsSync(cronJobsPath)) return [];
    try {
      return JSON.parse(readFileSync(cronJobsPath, 'utf-8')) as CronJobDef[];
    } catch {
      return [];
    }
  }

  function saveCronJobs(jobs: CronJobDef[]): void {
    writeFileSync(cronJobsPath, JSON.stringify(jobs, null, 2), 'utf-8');
  }

  // Active CronJob instances keyed by job id
  const { CronJob: CronJobClass } = await import('cron');
  const activeCronJobs = new Map<string, InstanceType<typeof CronJobClass>>();

  function startCronJob(job: CronJobDef): void {
    if (!job.enabled) return;
    // Stop existing if re-scheduling
    const existing = activeCronJobs.get(job.id);
    if (existing) {
      existing.stop();
      activeCronJobs.delete(job.id);
    }
    try {
      const cronInstance = new CronJobClass(
        job.schedule,
        async () => {
          console.log(`  [cron] Executing "${job.name}" for agent ${job.agentId}`);
          const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
          const agentConfig = agents[job.agentId];
          if (!agentConfig) {
            console.log(`  [cron] Agent "${job.agentId}" not found, skipping`);
            return;
          }
          const soulPath = join(cronHome, 'agents', job.agentId, 'SOUL.md');
          const toolPreset = (agentConfig.toolPreset as string) || 'full';
          const browserCfg = (config.browser ?? {}) as { enabled?: boolean; userDataDir?: string; browser?: string; cdpEndpoint?: string; headless?: boolean };
          try {
            const result = await askClaude(
              job.prompt,
              existsSync(soulPath) ? soulPath : null,
              undefined,     // agentContext
              undefined,     // conversationId
              job.agentId,
              cronHome,
              toolPreset,
              browserCfg,
            );
            // Update lastRunAt
            const jobs = loadCronJobs();
            const idx = jobs.findIndex(j => j.id === job.id);
            if (idx >= 0) {
              jobs[idx]!.lastRunAt = new Date().toISOString();
              saveCronJobs(jobs);
            }
            // Log to activity feed
            logActivityLocal({
              type: 'cron',
              agentId: job.agentId,
              title: `Cron: ${job.name}`,
              description: result.text.slice(0, 200),
              metadata: { action: 'executed', jobId: job.id, prompt: job.prompt, result: result.text, schedule: job.schedule, status: 'success' },
            });
            broadcastAdmin({ type: 'cron:executed', jobId: job.id, name: job.name, timestamp: new Date().toISOString() });
            console.log(`  [cron] "${job.name}" completed`);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`  [cron] "${job.name}" failed:`, errorMsg);
            logActivityLocal({
              type: 'cron',
              agentId: job.agentId,
              title: `Cron: ${job.name} (failed)`,
              description: errorMsg.slice(0, 200),
              metadata: { action: 'executed', jobId: job.id, prompt: job.prompt, error: errorMsg, schedule: job.schedule, status: 'error' },
            });
          }
        },
        null,
        true,
        job.timezone || 'UTC',
      );
      activeCronJobs.set(job.id, cronInstance);
      console.log(`  [cron] Scheduled "${job.name}" (${job.schedule} ${job.timezone})`);
    } catch (err) {
      console.error(`  [cron] Failed to schedule "${job.name}":`, err instanceof Error ? err.message : String(err));
    }
  }

  function stopCronJob(id: string): void {
    const existing = activeCronJobs.get(id);
    if (existing) {
      existing.stop();
      activeCronJobs.delete(id);
    }
  }

  // Start all enabled jobs on boot
  for (const job of loadCronJobs()) {
    startCronJob(job);
  }

  // GET /api/cron — list all cron jobs
  fastify.get('/api/cron', async () => {
    const jobs = loadCronJobs();
    return {
      jobs: jobs.map(j => ({
        ...j,
        active: activeCronJobs.has(j.id),
      })),
    };
  });

  // POST /api/cron — create a new cron job
  fastify.post('/api/cron', async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || !body.name || !body.schedule || !body.agentId || !body.prompt) {
      reply.status(400);
      return { error: 'Missing required fields: name, schedule, agentId, prompt' };
    }
    const jobs = loadCronJobs();
    if (jobs.some(j => j.name === body.name)) {
      reply.status(409);
      return { error: `Cron job "${body.name}" already exists` };
    }
    const newJob: CronJobDef = {
      id: randomUUID().slice(0, 8),
      name: body.name as string,
      schedule: body.schedule as string,
      agentId: body.agentId as string,
      prompt: body.prompt as string,
      timezone: (body.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone,
      enabled: body.enabled !== false,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
    };
    jobs.push(newJob);
    saveCronJobs(jobs);
    startCronJob(newJob);
    broadcastAdmin({ type: 'cron:created', jobId: newJob.id, name: newJob.name, timestamp: new Date().toISOString() });
    logActivityLocal({
      type: 'cron',
      agentId: newJob.agentId,
      title: `Cron job "${newJob.name}" created`,
      description: `Schedule: ${newJob.schedule}`,
      metadata: { action: 'created', jobId: newJob.id, name: newJob.name, schedule: newJob.schedule, prompt: newJob.prompt, agentId: newJob.agentId },
    });
    reply.status(201);
    return newJob;
  });

  // DELETE /api/cron/:id — delete a cron job
  fastify.delete('/api/cron/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const jobs = loadCronJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx < 0) {
      reply.status(404);
      return { error: 'Cron job not found' };
    }
    const removed = jobs.splice(idx, 1)[0]!;
    saveCronJobs(jobs);
    stopCronJob(id);
    broadcastAdmin({ type: 'cron:deleted', jobId: id, name: removed.name, timestamp: new Date().toISOString() });
    logActivityLocal({
      type: 'cron',
      agentId: removed.agentId,
      title: `Cron job "${removed.name}" deleted`,
      description: 'Removed scheduled job',
      metadata: { action: 'deleted', jobId: id, name: removed.name },
    });
    return { success: true };
  });

  // PATCH /api/cron/:id — update a cron job (enable/disable, change schedule, etc.)
  fastify.patch('/api/cron/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown> | null;
    if (!body) {
      reply.status(400);
      return { error: 'Request body required' };
    }
    const jobs = loadCronJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx < 0) {
      reply.status(404);
      return { error: 'Cron job not found' };
    }
    const job = jobs[idx]!;
    if (typeof body.name === 'string') job.name = body.name;
    if (typeof body.schedule === 'string') job.schedule = body.schedule;
    if (typeof body.agentId === 'string') job.agentId = body.agentId;
    if (typeof body.prompt === 'string') job.prompt = body.prompt;
    if (typeof body.timezone === 'string') job.timezone = body.timezone;
    if (typeof body.enabled === 'boolean') job.enabled = body.enabled;
    saveCronJobs(jobs);
    // Restart or stop based on enabled state
    if (job.enabled) {
      startCronJob(job);
    } else {
      stopCronJob(job.id);
    }
    broadcastAdmin({ type: 'cron:updated', jobId: id, name: job.name, timestamp: new Date().toISOString() });
    logActivityLocal({
      type: 'cron',
      agentId: job.agentId,
      title: `Cron job "${job.name}" updated`,
      description: `Schedule: ${job.schedule}, Enabled: ${job.enabled}`,
      metadata: { action: 'updated', jobId: id, changes: body },
    });
    return job;
  });

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
      orchestrator: { creature: 'Personal assistant', vibe: 'capable, attentive, proactive', emoji: '\u{1F52E}' },
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
        mcp: [],
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
    mkdirSync(join(agentDir, 'tools-history'), { recursive: true });

    // Write SOUL.md, MEMORY.md, HEARTBEAT.md, TOOLS.md
    // Custom agents can provide their own content; templates use seeds; fallback to defaults
    const soulOut = (isCustom && body.soulContent) ? String(body.soulContent) : (template?.soulSeed ?? DEFAULT_SOUL);
    const hbOut = (isCustom && body.heartbeatContent) ? String(body.heartbeatContent) : (template?.heartbeatSeed ?? DEFAULT_HEARTBEAT);
    writeFileSync(join(agentDir, 'SOUL.md'), soulOut, 'utf-8');
    writeFileSync(join(agentDir, 'MEMORY.md'), '# Memory\n\n_Curated knowledge and observations._\n', 'utf-8');
    writeFileSync(join(agentDir, 'HEARTBEAT.md'), hbOut, 'utf-8');
    writeFileSync(join(agentDir, 'TOOLS.md'), DEFAULT_TOOLS_MD, 'utf-8');

    // Update config.json
    agents[agentName] = agentConfig;
    (config as Record<string, unknown>).agents = agents;

    // Set as default agent if requested (used by onboarding flow)
    if (body.setAsDefault) {
      const routing = ((config as Record<string, unknown>).routing ?? {}) as Record<string, unknown>;
      routing.defaultAgent = agentName;
      (config as Record<string, unknown>).routing = routing;
    }

    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log(`  [ok] Created agent "${agentName}" (${isCustom ? 'custom' : 'template: ' + templateId})`);

    logActivityLocal({
      type: 'agent',
      agentId: agentName,
      title: `Agent "${agentName}" created`,
      description: `Created from ${isCustom ? 'custom config' : 'template: ' + templateId}`,
      metadata: { action: 'create', template: templateId },
    });

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

  // ═══════════════════════════════════════════════════════════════════════════
  // USER.md Routes — /api/user (global)
  // ═══════════════════════════════════════════════════════════════════════════

  const cladeBase = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  const userMdPath = join(cladeBase, 'USER.md');
  const userHistoryDir = join(cladeBase, 'user-history');

  // ── Get USER.md content ─────────────────────────────────────────
  fastify.get('/api/user', async () => {
    try {
      if (!existsSync(userMdPath)) {
        return { content: DEFAULT_USER_MD };
      }
      const content = readFileSync(userMdPath, 'utf-8');
      return { content };
    } catch (err) {
      return { error: 'Failed to read USER.md' };
    }
  });

  // ── Update USER.md content ──────────────────────────────────────
  fastify.put<{ Body: { content: string } }>('/api/user', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const content = body.content;

    if (typeof content !== 'string') {
      reply.status(400);
      return { error: 'content must be a string' };
    }

    try {
      // Ensure history directory exists
      mkdirSync(userHistoryDir, { recursive: true });

      // Save version before updating
      saveVersion(userMdPath, userHistoryDir);

      // Write the new content
      writeFileSync(userMdPath, content, 'utf-8');
      // Broadcast to admin websockets
      for (const ws of wsClients) {
        try { ws.send(JSON.stringify({ type: 'user:updated', timestamp: new Date().toISOString() })); } catch {}
      }
      return { success: true };
    } catch (err) {
      reply.status(500);
      return { error: 'Failed to update USER.md' };
    }
  });

  // ── Get USER.md version history ─────────────────────────────────
  fastify.get('/api/user/history', async () => {
    try {
      const entries = getVersionHistory(userHistoryDir);
      return { entries };
    } catch (err) {
      return { error: 'Failed to get history', entries: [] };
    }
  });

  // ── Get specific USER.md version ────────────────────────────────
  fastify.get<{ Params: { date: string } }>('/api/user/history/:date', async (req, reply) => {
    const { date } = req.params;

    try {
      const content = getVersionContent(userHistoryDir, date);
      if (content === null) {
        reply.status(404);
        return { error: `No history entry for date "${date}"` };
      }
      return { date, content };
    } catch (err) {
      reply.status(500);
      return { error: 'Failed to read history entry' };
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOLS.md Routes — /api/agents/:id/tools-md (per-agent)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Get TOOLS.md content ────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/tools-md', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }

    const agentDir = join(cladeBase, 'agents', id);
    const toolsMdPath = join(agentDir, 'TOOLS.md');

    try {
      if (!existsSync(toolsMdPath)) {
        return { content: DEFAULT_TOOLS_MD };
      }
      const content = readFileSync(toolsMdPath, 'utf-8');
      return { content };
    } catch (err) {
      return { error: 'Failed to read TOOLS.md' };
    }
  });

  // ── Update TOOLS.md content ─────────────────────────────────────
  fastify.put<{ Params: { id: string }; Body: { content: string } }>('/api/agents/:id/tools-md', async (req, reply) => {
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

    const agentDir = join(cladeBase, 'agents', id);
    const toolsMdPath = join(agentDir, 'TOOLS.md');
    const toolsHistoryDir = join(agentDir, 'tools-history');

    try {
      // Ensure history directory exists
      mkdirSync(toolsHistoryDir, { recursive: true });

      // Save version before updating
      saveVersion(toolsMdPath, toolsHistoryDir);

      // Write the new content
      writeFileSync(toolsMdPath, content, 'utf-8');
      // Broadcast to admin websockets
      for (const ws of wsClients) {
        try { ws.send(JSON.stringify({ type: 'agent:tools-md:updated', agentId: id, timestamp: new Date().toISOString() })); } catch {}
      }
      return { success: true };
    } catch (err) {
      reply.status(500);
      return { error: 'Failed to update TOOLS.md' };
    }
  });

  // ── Get TOOLS.md version history ────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/tools-md/history', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }

    const agentDir = join(cladeBase, 'agents', id);
    const toolsHistoryDir = join(agentDir, 'tools-history');

    try {
      const entries = getVersionHistory(toolsHistoryDir);
      return { entries };
    } catch (err) {
      return { error: 'Failed to get history', entries: [] };
    }
  });

  // ── Get specific TOOLS.md version ───────────────────────────────
  fastify.get<{ Params: { id: string; date: string } }>('/api/agents/:id/tools-md/history/:date', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id, date } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }

    const agentDir = join(cladeBase, 'agents', id);
    const toolsHistoryDir = join(agentDir, 'tools-history');

    try {
      const content = getVersionContent(toolsHistoryDir, date);
      if (content === null) {
        reply.status(404);
        return { error: `No history entry for date "${date}"` };
      }
      return { agentId: id, date, content };
    } catch (err) {
      reply.status(500);
      return { error: 'Failed to read history entry' };
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Activity Feed API — /api/activity
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/api/activity', async (req) => {
    const query = req.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 200);
    const offset = parseInt(query.offset || '0', 10) || 0;
    const filterAgentId = query.agentId || undefined;
    const filterType = query.type || undefined;

    let events = loadActivityLog();

    // Sort newest-first
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply filters
    if (filterAgentId) {
      events = events.filter(e => e.agentId === filterAgentId);
    }
    if (filterType) {
      const types = filterType.split(',');
      events = events.filter(e => types.includes(e.type));
    }

    const totalEvents = events.length;
    const paged = events.slice(offset, offset + limit);

    return { events: paged, totalEvents, limit, offset };
  });

  // POST to manually log an activity event (for integrations)
  fastify.post('/api/activity', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const eventType = body.type as string;
    const title = body.title as string;

    if (!eventType || !title) {
      reply.status(400);
      return { error: 'type and title are required' };
    }

    const validTypes = ['chat', 'skill', 'mcp', 'reflection', 'agent', 'heartbeat', 'cron', 'backup'];
    if (!validTypes.includes(eventType)) {
      reply.status(400);
      return { error: `type must be one of: ${validTypes.join(', ')}` };
    }

    const event = logActivityLocal({
      type: eventType as ActivityEvent['type'],
      agentId: (body.agentId as string) || undefined,
      title,
      description: (body.description as string) || '',
      metadata: (body.metadata as Record<string, unknown>) || undefined,
    });

    return { success: true, event };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Backup API — /api/backup
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/api/backup/status', async () => {
    const backupConfig = (config.backup ?? {}) as Record<string, unknown>;
    const bkHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    return getBackupStatus(bkHome, {
      enabled: Boolean(backupConfig.enabled),
      repo: String(backupConfig.repo || ''),
      branch: String(backupConfig.branch || 'main'),
      intervalMinutes: Number(backupConfig.intervalMinutes || 30),
      lastBackupAt: backupConfig.lastBackupAt as string | undefined,
      lastCommitSha: backupConfig.lastCommitSha as string | undefined,
      lastError: backupConfig.lastError as string | undefined,
    });
  });

  fastify.post('/api/backup/now', async (_req, reply) => {
    const backupConfig = (config.backup ?? {}) as Record<string, unknown>;
    if (!backupConfig.repo) {
      reply.status(400);
      return { error: 'Backup not configured. Run "clade backup setup --repo owner/repo" first.' };
    }
    if (isBackupInProgress()) {
      reply.status(409);
      return { error: 'Backup already in progress' };
    }
    try {
      const bkHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
      const bkConfigPath = join(bkHome, 'config.json');
      const result = await performBackup(bkHome, {
        repo: String(backupConfig.repo),
        branch: String(backupConfig.branch || 'main'),
        excludeChats: Boolean(backupConfig.excludeChats),
      });
      if (result.changed) {
        backupConfig.lastBackupAt = new Date().toISOString();
        backupConfig.lastCommitSha = result.commitSha;
        delete backupConfig.lastError;
        writeFileSync(bkConfigPath, JSON.stringify(config, null, 2), 'utf-8');
        logActivityLocal({
          type: 'backup',
          title: 'Manual backup completed',
          description: `${result.filesChanged} file(s) committed${result.pushed ? ' and pushed' : ' (push pending)'}`,
          metadata: { commitSha: result.commitSha, pushed: result.pushed },
        });
        broadcastAdmin({ type: 'backup:completed', ...result });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      backupConfig.lastError = message;
      const bkHome2 = process.env['CLADE_HOME'] || join(homedir(), '.clade');
      writeFileSync(join(bkHome2, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
      broadcastAdmin({ type: 'backup:error', error: message });
      reply.status(500);
      return { error: message };
    }
  });

  fastify.get('/api/backup/history', async (req) => {
    const query = req.query as Record<string, string>;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const bkHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const entries = await getBackupHistory(bkHome, limit);
    return { entries };
  });

  fastify.put('/api/backup/config', async (req) => {
    const body = req.body as Record<string, unknown>;
    const backupConfig = ((config as Record<string, unknown>).backup ?? {}) as Record<string, unknown>;
    if (body.enabled !== undefined) backupConfig.enabled = Boolean(body.enabled);
    if (body.intervalMinutes !== undefined) backupConfig.intervalMinutes = Number(body.intervalMinutes);
    if (body.excludeChats !== undefined) backupConfig.excludeChats = Boolean(body.excludeChats);
    (config as Record<string, unknown>).backup = backupConfig;
    const bkHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    writeFileSync(join(bkHome, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
    broadcastAdmin({ type: 'backup:config_updated' });
    return { success: true, backup: backupConfig };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Calendar API — /api/calendar/events
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/api/calendar/events', async (req) => {
    const query = req.query as Record<string, string>;
    const startStr = query.start;
    const endStr = query.end;

    // Default range: current month
    const now = new Date();
    const rangeStart = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
    const rangeEnd = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();

    const calendarEvents: Array<{
      id: string;
      type: string;
      agentId?: string;
      title: string;
      start: string;
      end?: string;
      recurring?: boolean;
      color?: string;
    }> = [];

    const calHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;

    // 1. Chat activity windows — group messages into time blocks per agent per day
    for (const agentId of Object.keys(agents)) {
      const chatData = loadAgentChatData(calHome, agentId);
      // Gather all message timestamps for this agent
      const msgTimestamps: number[] = [];
      for (const convId of chatData.order) {
        const conv = chatData.conversations[convId];
        if (!conv) continue;
        for (const msg of conv.messages) {
          const ts = new Date(msg.timestamp).getTime();
          if (ts >= rangeStartMs && ts <= rangeEndMs) {
            msgTimestamps.push(ts);
          }
        }
      }

      if (msgTimestamps.length === 0) continue;

      // Group timestamps into sessions (gaps > 30 min = new session)
      msgTimestamps.sort((a, b) => a - b);
      let sessionStart = msgTimestamps[0]!;
      let sessionEnd = msgTimestamps[0]!;

      for (let i = 1; i < msgTimestamps.length; i++) {
        const ts = msgTimestamps[i]!;
        if (ts - sessionEnd > 30 * 60 * 1000) {
          // Save current session
          calendarEvents.push({
            id: `chat_${agentId}_${sessionStart}`,
            type: 'chat',
            agentId,
            title: `Chat with ${agentId}`,
            start: new Date(sessionStart).toISOString(),
            end: new Date(sessionEnd).toISOString(),
            color: '#58a6ff',
          });
          sessionStart = ts;
        }
        sessionEnd = ts;
      }
      // Save last session
      calendarEvents.push({
        id: `chat_${agentId}_${sessionStart}`,
        type: 'chat',
        agentId,
        title: `Chat with ${agentId}`,
        start: new Date(sessionStart).toISOString(),
        end: new Date(sessionEnd).toISOString(),
        color: '#58a6ff',
      });
    }

    // 2. Heartbeat/cron schedules from agent configs as recurring events
    for (const [agentId, agentCfg] of Object.entries(agents)) {
      const hb = agentCfg.heartbeat as { enabled?: boolean; interval?: string } | undefined;
      if (hb?.enabled) {
        calendarEvents.push({
          id: `heartbeat_${agentId}`,
          type: 'heartbeat',
          agentId,
          title: `${agentId} heartbeat (${hb.interval || '30m'})`,
          start: rangeStart.toISOString(),
          recurring: true,
          color: '#3fb950',
        });
      }
    }

    // 3. Activity events within range (reflection, skill, agent events)
    const activityEvents = loadActivityLog();
    for (const evt of activityEvents) {
      const evtMs = new Date(evt.timestamp).getTime();
      if (evtMs >= rangeStartMs && evtMs <= rangeEndMs) {
        const colorMap: Record<string, string> = {
          reflection: '#d2a8ff',
          skill: '#f0883e',
          mcp: '#f0883e',
          agent: '#8b949e',
          chat: '#58a6ff',
          heartbeat: '#3fb950',
          cron: '#79c0ff',
        };
        calendarEvents.push({
          id: evt.id,
          type: evt.type,
          agentId: evt.agentId,
          title: evt.title,
          start: evt.timestamp,
          color: colorMap[evt.type] || '#8b949e',
        });
      }
    }

    // Sort by start time
    calendarEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    return { events: calendarEvents, range: { start: rangeStart.toISOString(), end: rangeEnd.toISOString() } };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Global Search API — /api/search
  // ═══════════════════════════════════════════════════════════════════════

  fastify.post('/api/search', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const query = body.query as string;
    if (!query || typeof query !== 'string') {
      reply.status(400);
      return { error: 'query is required and must be a string' };
    }

    const requestedSources = (body.sources as string[]) || ['memories', 'conversations', 'skills', 'agents', 'config'];
    const queryLower = query.toLowerCase();
    const searchHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;

    const results: Array<{
      source: string;
      agentId?: string;
      title: string;
      snippet: string;
      matchCount: number;
      path?: string;
    }> = [];

    // Helper: extract snippet around match
    function extractSnippet(text: string, q: string): string {
      const idx = text.toLowerCase().indexOf(q);
      if (idx === -1) return text.slice(0, 150);
      const start = Math.max(0, idx - 50);
      const end = Math.min(text.length, idx + q.length + 100);
      let snippet = text.slice(start, end).replace(/\n/g, ' ').trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < text.length) snippet = snippet + '...';
      return snippet;
    }

    // Helper: count occurrences
    function countMatches(text: string, q: string): number {
      const lower = text.toLowerCase();
      let count = 0;
      let pos = 0;
      while ((pos = lower.indexOf(q, pos)) !== -1) {
        count++;
        pos += q.length;
      }
      return count;
    }

    // 1. Search memories
    if (requestedSources.includes('memories')) {
      for (const agentId of Object.keys(agents)) {
        const baseDir = join(searchHome, 'agents', agentId);

        // MEMORY.md
        const memoryMdPath = join(baseDir, 'MEMORY.md');
        if (existsSync(memoryMdPath)) {
          try {
            const content = readFileSync(memoryMdPath, 'utf-8');
            if (content.toLowerCase().includes(queryLower)) {
              results.push({
                source: 'memories',
                agentId,
                title: `${agentId}/MEMORY.md`,
                snippet: extractSnippet(content, queryLower),
                matchCount: countMatches(content, queryLower),
                path: memoryMdPath,
              });
            }
          } catch {}
        }

        // Daily memory files
        const memoryDir = join(baseDir, 'memory');
        if (existsSync(memoryDir)) {
          try {
            const entries = readdirSync(memoryDir).filter(f => f.endsWith('.md'));
            for (const entry of entries) {
              try {
                const content = readFileSync(join(memoryDir, entry), 'utf-8');
                if (content.toLowerCase().includes(queryLower)) {
                  results.push({
                    source: 'memories',
                    agentId,
                    title: `${agentId}/memory/${entry}`,
                    snippet: extractSnippet(content, queryLower),
                    matchCount: countMatches(content, queryLower),
                    path: join(memoryDir, entry),
                  });
                }
              } catch {}
            }
          } catch {}
        }
      }
    }

    // 2. Search conversations
    if (requestedSources.includes('conversations')) {
      for (const agentId of Object.keys(agents)) {
        const chatData = loadAgentChatData(searchHome, agentId);
        for (const convId of chatData.order) {
          const conv = chatData.conversations[convId];
          if (!conv) continue;
          let totalMatches = 0;
          let firstSnippet = '';
          for (const msg of conv.messages) {
            if (msg.text.toLowerCase().includes(queryLower)) {
              totalMatches += countMatches(msg.text, queryLower);
              if (!firstSnippet) {
                firstSnippet = extractSnippet(msg.text, queryLower);
              }
            }
          }
          if (totalMatches > 0) {
            results.push({
              source: 'conversations',
              agentId,
              title: `${agentId}: ${conv.label}`,
              snippet: firstSnippet,
              matchCount: totalMatches,
            });
          }
        }
      }
    }

    // 3. Search skills
    if (requestedSources.includes('skills')) {
      const skillsDirs = ['active', 'pending', 'disabled'];
      const sDir = join(searchHome, 'skills');
      for (const status of skillsDirs) {
        const statusDir = join(sDir, status);
        if (!existsSync(statusDir)) continue;
        try {
          const entries = readdirSync(statusDir);
          for (const skillName of entries) {
            // Check skill name
            if (skillName.toLowerCase().includes(queryLower)) {
              results.push({
                source: 'skills',
                title: `Skill: ${skillName} (${status})`,
                snippet: `Skill name matches query`,
                matchCount: 1,
                path: join(statusDir, skillName),
              });
            }
            // Check SKILL.md content
            const skillMdPath = join(statusDir, skillName, 'SKILL.md');
            if (existsSync(skillMdPath)) {
              try {
                const content = readFileSync(skillMdPath, 'utf-8');
                if (content.toLowerCase().includes(queryLower)) {
                  results.push({
                    source: 'skills',
                    title: `Skill: ${skillName}/SKILL.md (${status})`,
                    snippet: extractSnippet(content, queryLower),
                    matchCount: countMatches(content, queryLower),
                    path: skillMdPath,
                  });
                }
              } catch {}
            }
          }
        } catch {}
      }
    }

    // 4. Search agents (name, description, SOUL.md)
    if (requestedSources.includes('agents')) {
      for (const [agentId, agentCfg] of Object.entries(agents)) {
        const name = (agentCfg.name as string) || agentId;
        const desc = (agentCfg.description as string) || '';
        const combined = `${name} ${desc} ${agentId}`;

        if (combined.toLowerCase().includes(queryLower)) {
          results.push({
            source: 'agents',
            agentId,
            title: `Agent: ${name}`,
            snippet: desc || `Agent ID: ${agentId}`,
            matchCount: countMatches(combined, queryLower),
          });
        }

        // SOUL.md
        const soulPath = join(searchHome, 'agents', agentId, 'SOUL.md');
        if (existsSync(soulPath)) {
          try {
            const content = readFileSync(soulPath, 'utf-8');
            if (content.toLowerCase().includes(queryLower)) {
              results.push({
                source: 'agents',
                agentId,
                title: `${agentId}/SOUL.md`,
                snippet: extractSnippet(content, queryLower),
                matchCount: countMatches(content, queryLower),
                path: soulPath,
              });
            }
          } catch {}
        }
      }
    }

    // 5. Search config
    if (requestedSources.includes('config')) {
      const configStr = JSON.stringify(config, null, 2);
      if (configStr.toLowerCase().includes(queryLower)) {
        results.push({
          source: 'config',
          title: 'config.json',
          snippet: extractSnippet(configStr, queryLower),
          matchCount: countMatches(configStr, queryLower),
          path: join(searchHome, 'config.json'),
        });
      }
    }

    // Sort by match count descending
    results.sort((a, b) => b.matchCount - a.matchCount);

    return { results, totalResults: results.length, query };
  });

  // ── Admin dashboard ───────────────────────────────────────────
  // Prefer built React UI from ui/dist/, fall back to legacy admin.html
  let uiDistDir: string | null = null;
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(thisDir, '..', '..', 'ui', 'dist'),       // dist/bin/ → ui/dist/
      join(thisDir, '..', '..', '..', 'ui', 'dist'),  // src/cli/commands/ → ui/dist/
    ];
    for (const c of candidates) {
      if (existsSync(join(c, 'index.html'))) { uiDistDir = c; break; }
    }
  } catch { /* fallback */ }

  if (uiDistDir) {
    // Serve React UI static assets under /admin/
    const fastifyStatic = await import('@fastify/static').then(m => m.default).catch(() => null);
    if (fastifyStatic) {
      await fastify.register(fastifyStatic, {
        root: uiDistDir,
        prefix: '/admin/',
        decorateReply: false,
      });
    }
  }

  const adminHtmlPath = findAdminHtml();

  fastify.get('/admin', async (_req, reply) => {
    // Prefer React UI
    if (uiDistDir && existsSync(join(uiDistDir, 'index.html'))) {
      return reply.redirect('/admin/');
    }
    // Fall back to legacy admin.html
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

  const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
  const agentCount = Object.keys(agents).length;

  // ── Launch shared Chrome with CDP for agent browser tools ──────────
  const browserConfig = (config.browser ?? {}) as { enabled?: boolean; userDataDir?: string; browser?: string; cdpEndpoint?: string; headless?: boolean };
  if (browserConfig.enabled) {
    await launchBrowserForAgents(browserConfig, cladeHome);
  }

  // ── Watch agents/ dir for file changes (memory, soul, heartbeat) ──────────
  const agentsWatchDir = join(cladeHome, 'agents');
  let agentsDirDebounce: ReturnType<typeof setTimeout> | null = null;
  if (existsSync(agentsWatchDir)) {
    watch(agentsWatchDir, { recursive: true }, (_eventType, filename) => {
      if (agentsDirDebounce) clearTimeout(agentsDirDebounce);
      agentsDirDebounce = setTimeout(() => {
        // Extract agentId from path (first segment under agents/)
        const agentId = filename ? String(filename).split(/[/\\]/)[0] : undefined;
        const payload = JSON.stringify({
          type: 'agent:files_changed',
          agentId: agentId || null,
          timestamp: new Date().toISOString(),
        });
        for (const ws of wsClients) {
          if (ws.readyState === 1) ws.send(payload);
        }
      }, 500);
    });
  }

  // ── Watch config.json for external changes (e.g. agents created via CLI) ──
  const configWatchPath = join(cladeHome, 'config.json');
  let configDebounce: ReturnType<typeof setTimeout> | null = null;
  if (existsSync(configWatchPath)) {
    watch(configWatchPath, () => {
      if (configDebounce) clearTimeout(configDebounce);
      configDebounce = setTimeout(() => {
        try {
          const raw = readFileSync(configWatchPath, 'utf-8');
          const updated = JSON.parse(raw) as Record<string, unknown>;
          // Sync the in-memory config object
          Object.assign(config, updated);
          // Broadcast to admin UI so it refreshes agent list
          const payload = JSON.stringify({ type: 'snapshot', timestamp: new Date().toISOString() });
          for (const ws of wsClients) {
            if (ws.readyState === 1) ws.send(payload);
          }
          const newAgentCount = Object.keys((config.agents ?? {}) as Record<string, unknown>).length;
          console.log(`  [ok] Config reloaded (${newAgentCount} agents)`);
        } catch {
          // Ignore transient parse errors during partial writes
        }
      }, 300);
    });
  }

  // ── Auto-backup timer ────────────────────────────────────────────
  const backupCfg = (config.backup ?? {}) as Record<string, unknown>;
  if (backupCfg.enabled && backupCfg.repo && Number(backupCfg.intervalMinutes) > 0) {
    const intervalMs = Number(backupCfg.intervalMinutes) * 60_000;
    const backupTimer = setInterval(async () => {
      if (isBackupInProgress()) return;
      try {
        const result = await performBackup(cladeHome, {
          repo: String(backupCfg.repo),
          branch: String(backupCfg.branch || 'main'),
          excludeChats: Boolean(backupCfg.excludeChats),
        });
        if (result.changed) {
          backupCfg.lastBackupAt = new Date().toISOString();
          backupCfg.lastCommitSha = result.commitSha;
          delete backupCfg.lastError;
          writeFileSync(join(cladeHome, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
          logActivityLocal({
            type: 'backup',
            title: 'Auto-backup completed',
            description: `${result.filesChanged} file(s) committed${result.pushed ? ' and pushed' : ' (push pending)'}`,
            metadata: { commitSha: result.commitSha, pushed: result.pushed },
          });
          broadcastAdmin({ type: 'backup:completed', ...result });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        backupCfg.lastError = message;
        writeFileSync(join(cladeHome, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
        broadcastAdmin({ type: 'backup:error', error: message });
      }
    }, intervalMs);
    backupTimer.unref();
    console.log(`  Auto-backup enabled: every ${backupCfg.intervalMinutes}m to ${backupCfg.repo}`);
  }

  const channels = (config.channels ?? {}) as Record<string, { enabled?: boolean }>;

  // ── Connect channel adapters (Slack, Telegram, Discord) ─────────
  const connectedChannels = await connectChannelAdapters(
    channels,
    agents,
    config,
    cladeHome,
    broadcastAdmin,
  );

  const channelList = [
    ...Object.entries(channels).filter(([, v]) => v.enabled).map(([k]) => k),
    ...connectedChannels,
  ];
  // Deduplicate
  const uniqueChannels = [...new Set(channelList)];

  console.log(`  Server listening on http://${host}:${port}`);
  console.log(`  Agents: ${agentCount}`);
  console.log(`  Channels: ${uniqueChannels.join(', ') || 'none'}`);
  console.log(`\n  Health check: http://${host}:${port}/health`);
  console.log(`  Admin UI:     http://${host}:${port}/admin`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// @mention routing for channel messages
// ---------------------------------------------------------------------------

const MENTION_PATTERN = /(?:^|\s)@([\w-]+)/;

/**
 * Parse @mention from message text and resolve to a known agent ID.
 * Returns the matched agent ID and message with mention stripped.
 */
function parseChannelMention(
  text: string,
  agentIds: string[],
): { agentId: string | null; strippedText: string } {
  const match = text.match(MENTION_PATTERN);
  if (!match) return { agentId: null, strippedText: text };

  const mentioned = match[1]!.toLowerCase();
  const found = agentIds.find((id) => id.toLowerCase() === mentioned);
  if (!found) return { agentId: null, strippedText: text };

  const stripped = text.replace(MENTION_PATTERN, '').trim();
  return { agentId: found, strippedText: stripped };
}

// ---------------------------------------------------------------------------
// Channel adapter wiring
// ---------------------------------------------------------------------------

/**
 * Detect channel tokens from environment variables, instantiate adapters,
 * wire message handlers to askClaude(), and connect.
 * Returns array of connected channel names.
 */
/** Build the shared channel message handler (needs runtime context) */
function buildChannelMessageHandler(
  agents: Record<string, Record<string, unknown>>,
  config: Record<string, unknown>,
  cladeHome: string,
) {
  const routing = (config.routing ?? {}) as { defaultAgent?: string; rules?: unknown[] };
  const defaultAgentId = routing.defaultAgent || Object.keys(agents)[0] || '';
  const agentIds = Object.keys(agents);

  return async (
    adapter: { sendMessage: (to: string, text: string, opts?: { threadId?: string }) => Promise<void>; sendTyping: (to: string) => Promise<void> },
    msg: { channel: string; userId: string; chatId?: string; text: string; threadId?: string },
  ): Promise<void> => {
    const { agentId: mentionedAgent, strippedText } = parseChannelMention(msg.text, agentIds);
    const agentId = mentionedAgent || defaultAgentId;

    if (!agentId || !agents[agentId]) {
      console.error(`  [${msg.channel}] No agent found to handle message`);
      return;
    }

    const agentCfg = agents[agentId] ?? {};
    const toolPreset = (agentCfg.toolPreset as string) || 'coding';
    const soulPath = join(cladeHome, 'agents', agentId, 'SOUL.md');
    const agentContext = buildAgentContext(agentId, agents);

    const sessionKey = `ch:${msg.channel}:${agentId}:${msg.chatId || msg.userId}`;
    const replyTo = msg.chatId || msg.userId;
    try { await adapter.sendTyping(replyTo); } catch { /* not all channels support this */ }

    console.log(`  [${msg.channel}] ${msg.userId} → ${agentId}: ${msg.text.slice(0, 80)}${msg.text.length > 80 ? '...' : ''}`);

    const existingController = inflightProcesses.get(sessionKey);
    if (existingController) {
      existingController.abort();
      inflightProcesses.delete(sessionKey);
    }

    const abortController = new AbortController();
    inflightProcesses.set(sessionKey, abortController);

    try {
      const browserCfg = { ...(config.browser ?? {}) } as { enabled?: boolean; userDataDir?: string; browser?: string; cdpEndpoint?: string; headless?: boolean };
      if (cdpEndpointUrl) browserCfg.cdpEndpoint = cdpEndpointUrl;
      const result = await askClaude(
        strippedText,
        soulPath,
        agentContext,
        sessionKey,
        agentId,
        cladeHome,
        toolPreset,
        browserCfg,
        abortController.signal,
      );

      if (result.cancelled) return;

      await adapter.sendMessage(replyTo, result.text, { threadId: msg.threadId });
      console.log(`  [${msg.channel}] ${agentId} → ${msg.userId}: ${result.text.slice(0, 80)}${result.text.length > 80 ? '...' : ''}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [${msg.channel}] Error: ${errMsg}`);
      try {
        await adapter.sendMessage(replyTo, 'Sorry, I encountered an error processing your message.', { threadId: msg.threadId });
      } catch { /* best effort */ }
    } finally {
      inflightProcesses.delete(sessionKey);
    }
  };
}

/**
 * Create a single channel adapter by name, wire its message handler,
 * and store it in channelAdapters. Does NOT call connect().
 * Returns true if the adapter was created.
 */
async function createChannelAdapter(
  name: string,
  channels: Record<string, { enabled?: boolean }>,
  agents: Record<string, Record<string, unknown>>,
  config: Record<string, unknown>,
  cladeHome: string,
): Promise<boolean> {
  if (channelAdapters.has(name)) return true;

  const handleChannelMessage = buildChannelMessageHandler(agents, config, cladeHome);

  switch (name) {
    case 'slack': {
      const botToken = process.env['SLACK_BOT_TOKEN'];
      const appToken = process.env['SLACK_APP_TOKEN'];
      if (!botToken || !appToken) return false;
      const { SlackAdapter } = await import('../../channels/slack.js');
      const slack = new SlackAdapter(botToken, appToken);
      slack.onMessage(async (msg) => handleChannelMessage(slack, msg));
      channelAdapters.set('slack', slack);
      return true;
    }
    case 'telegram': {
      const token = process.env['TELEGRAM_BOT_TOKEN'];
      if (!token) return false;
      const { TelegramAdapter } = await import('../../channels/telegram.js');
      const telegram = new TelegramAdapter(token);
      telegram.onMessage(async (msg) => handleChannelMessage(telegram, msg));
      channelAdapters.set('telegram', telegram);
      return true;
    }
    case 'discord': {
      const token = process.env['DISCORD_BOT_TOKEN'];
      if (!token) return false;
      const { DiscordAdapter } = await import('../../channels/discord.js');
      const discord = new DiscordAdapter(token);
      discord.onMessage(async (msg) => handleChannelMessage(discord, msg));
      channelAdapters.set('discord', discord);
      return true;
    }
    case 'webchat': {
      const { WebChatAdapter } = await import('../../channels/webchat.js');
      const webchat = new WebChatAdapter();
      webchat.onMessage(async (msg) => handleChannelMessage(webchat, msg));
      channelAdapters.set('webchat', webchat);
      return true;
    }
    default:
      return false;
  }
}

async function connectChannelAdapters(
  channels: Record<string, { enabled?: boolean }>,
  agents: Record<string, Record<string, unknown>>,
  config: Record<string, unknown>,
  cladeHome: string,
  broadcastAdmin: (msg: Record<string, unknown>) => void,
): Promise<string[]> {
  const connected: string[] = [];

  // ── WebChat (always available) ───────────────────────────────────
  try {
    await createChannelAdapter('webchat', channels, agents, config, cladeHome);
    const webchat = channelAdapters.get('webchat')!;
    await webchat.connect();
    connected.push('webchat');
    activeChannelNames.add('webchat');
    console.log('  [ok] WebChat adapter ready');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`  [!!] WebChat adapter failed: ${errMsg}`);
    broadcastAdmin({ type: 'channel:error', name: 'webchat', error: errMsg, timestamp: new Date().toISOString() });
  }

  // ── Slack ────────────────────────────────────────────────────────
  const slackEnabled = channels.slack?.enabled !== false;
  if (process.env['SLACK_BOT_TOKEN'] && process.env['SLACK_APP_TOKEN'] && slackEnabled) {
    try {
      await createChannelAdapter('slack', channels, agents, config, cladeHome);
      await channelAdapters.get('slack')!.connect();
      connected.push('slack');
      activeChannelNames.add('slack');
      console.log('  [ok] Slack adapter connected (Socket Mode)');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [!!] Slack adapter failed to connect: ${errMsg}`);
      broadcastAdmin({ type: 'channel:error', name: 'slack', error: errMsg, timestamp: new Date().toISOString() });
    }
  }

  // ── Telegram ─────────────────────────────────────────────────────
  const telegramEnabled = channels.telegram?.enabled !== false;
  if (process.env['TELEGRAM_BOT_TOKEN'] && telegramEnabled) {
    try {
      await createChannelAdapter('telegram', channels, agents, config, cladeHome);
      await channelAdapters.get('telegram')!.connect();
      connected.push('telegram');
      activeChannelNames.add('telegram');
      console.log('  [ok] Telegram adapter connected');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [!!] Telegram adapter failed to connect: ${errMsg}`);
      broadcastAdmin({ type: 'channel:error', name: 'telegram', error: errMsg, timestamp: new Date().toISOString() });
    }
  }

  // ── Discord ──────────────────────────────────────────────────────
  const discordEnabled = channels.discord?.enabled !== false;
  if (process.env['DISCORD_BOT_TOKEN'] && discordEnabled) {
    try {
      await createChannelAdapter('discord', channels, agents, config, cladeHome);
      await channelAdapters.get('discord')!.connect();
      connected.push('discord');
      activeChannelNames.add('discord');
      console.log('  [ok] Discord adapter connected');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [!!] Discord adapter failed to connect: ${errMsg}`);
      broadcastAdmin({ type: 'channel:error', name: 'discord', error: errMsg, timestamp: new Date().toISOString() });
    }
  }

  return connected;
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

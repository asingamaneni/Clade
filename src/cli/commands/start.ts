import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { listTemplates, getTemplate, configFromTemplate } from '../../agents/templates.js';
import { resolveAllowedTools } from '../../agents/presets.js';
import { DEFAULT_SOUL, DEFAULT_HEARTBEAT } from '../../config/defaults.js';
import { runReflectionCycle } from '../../agents/reflection.js';

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

/** Track connected channel adapter names (populated after server starts) */
const activeChannelNames = new Set<string>();

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
 * memory, sessions, and skills tools during chat.
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
    coding: ['memory', 'sessions', 'skills'],
    messaging: ['memory', 'sessions', 'messaging', 'skills'],
    full: ['memory', 'sessions', 'messaging', 'skills'],
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

  // Also add any active third-party skills
  const activeSkillsDir = join(cladeHome, 'skills', 'active');
  if (existsSync(activeSkillsDir)) {
    try {
      const entries = readdirSync(activeSkillsDir);
      for (const entry of entries) {
        const configPath = join(activeSkillsDir, entry, 'mcp.json');
        if (existsSync(configPath)) {
          try {
            const raw = readFileSync(configPath, 'utf-8');
            const skillCfg = JSON.parse(raw) as { command: string; args: string[]; env?: Record<string, string> };
            mcpServers[`skill_${entry}`] = skillCfg;
          } catch { /* skip malformed skill configs */ }
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

    // Build combined system prompt: agent context + SOUL.md + MEMORY.md
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

    // Build and pass MCP config so agent has access to memory/skills/sessions tools
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
  fastify.get('/api/channels', async () => ({
    channels: Array.from(activeChannelNames).map((name) => ({ name, connected: true })),
  }));
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

    // Set as default agent if requested (used by onboarding flow)
    if (body.setAsDefault) {
      const routing = ((config as Record<string, unknown>).routing ?? {}) as Record<string, unknown>;
      routing.defaultAgent = agentName;
      (config as Record<string, unknown>).routing = routing;
    }

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
  const channels = (config.channels ?? {}) as Record<string, { enabled?: boolean }>;

  // ── Connect channel adapters (Slack, Telegram, Discord) ─────────
  const connectedChannels = await connectChannelAdapters(
    channels,
    agents,
    config,
    cladeHome,
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
async function connectChannelAdapters(
  channels: Record<string, { enabled?: boolean }>,
  agents: Record<string, Record<string, unknown>>,
  config: Record<string, unknown>,
  cladeHome: string,
): Promise<string[]> {
  const connected: string[] = [];
  const routing = (config.routing ?? {}) as { defaultAgent?: string; rules?: unknown[] };
  const defaultAgentId = routing.defaultAgent || Object.keys(agents)[0] || '';
  const agentIds = Object.keys(agents);

  // Helper: handle an inbound message from any channel adapter
  const handleChannelMessage = async (
    adapter: { sendMessage: (to: string, text: string, opts?: { threadId?: string }) => Promise<void>; sendTyping: (to: string) => Promise<void> },
    msg: { channel: string; userId: string; chatId?: string; text: string; threadId?: string },
  ): Promise<void> => {
    // Route: @mention > default agent
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

    // Build a persistent session key for this channel user/chat
    const sessionKey = `ch:${msg.channel}:${agentId}:${msg.chatId || msg.userId}`;

    // Show typing indicator
    const replyTo = msg.chatId || msg.userId;
    try { await adapter.sendTyping(replyTo); } catch { /* not all channels support this */ }

    console.log(`  [${msg.channel}] ${msg.userId} → ${agentId}: ${msg.text.slice(0, 80)}${msg.text.length > 80 ? '...' : ''}`);

    // Cancel any existing in-flight request for this session
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

      // If cancelled, don't send a response
      if (result.cancelled) {
        return;
      }

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

  // ── Slack ────────────────────────────────────────────────────────
  const slackBotToken = process.env['SLACK_BOT_TOKEN'];
  const slackAppToken = process.env['SLACK_APP_TOKEN'];
  const slackEnabled = channels.slack?.enabled !== false;

  if (slackBotToken && slackAppToken && slackEnabled) {
    try {
      const { SlackAdapter } = await import('../../channels/slack.js');
      const slack = new SlackAdapter(slackBotToken, slackAppToken);

      slack.onMessage(async (msg) => {
        await handleChannelMessage(slack, msg);
      });

      await slack.connect();
      connected.push('slack');
      activeChannelNames.add('slack');
      console.log('  [ok] Slack adapter connected (Socket Mode)');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [!!] Slack adapter failed to connect: ${errMsg}`);
    }
  }

  // ── Telegram ─────────────────────────────────────────────────────
  const telegramToken = process.env['TELEGRAM_BOT_TOKEN'];
  const telegramEnabled = channels.telegram?.enabled !== false;

  if (telegramToken && telegramEnabled) {
    try {
      const { TelegramAdapter } = await import('../../channels/telegram.js');
      const telegram = new TelegramAdapter(telegramToken);

      telegram.onMessage(async (msg) => {
        await handleChannelMessage(telegram, msg);
      });

      await telegram.connect();
      connected.push('telegram');
      activeChannelNames.add('telegram');
      console.log('  [ok] Telegram adapter connected');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [!!] Telegram adapter failed to connect: ${errMsg}`);
    }
  }

  // ── Discord ──────────────────────────────────────────────────────
  const discordToken = process.env['DISCORD_BOT_TOKEN'];
  const discordEnabled = channels.discord?.enabled !== false;

  if (discordToken && discordEnabled) {
    try {
      const { DiscordAdapter } = await import('../../channels/discord.js');
      const discord = new DiscordAdapter(discordToken);

      discord.onMessage(async (msg) => {
        await handleChannelMessage(discord, msg);
      });

      await discord.connect();
      connected.push('discord');
      activeChannelNames.add('discord');
      console.log('  [ok] Discord adapter connected');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [!!] Discord adapter failed to connect: ${errMsg}`);
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

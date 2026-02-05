import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ClaudeCliRunner } from './claude-cli.js';
import { buildSessionKey } from './session.js';
import { getConfigDir } from '../config/index.js';
import { resolveAllowedTools } from '../agents/presets.js';
import { runReflectionCycle } from '../agents/reflection.js';
import { createLogger } from '../utils/logger.js';
import { SessionNotFoundError, AgentNotFoundError } from '../utils/errors.js';
import type { ClaudeOptions, ClaudeResult } from './claude-cli.js';
import type { Store, SessionRow } from '../store/sqlite.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { Config, AgentConfig, BrowserConfig } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const log = createLogger('session-manager');

// ---------------------------------------------------------------------------
// Built-in MCP server names
// ---------------------------------------------------------------------------

const BUILTIN_MCP_SERVERS = [
  'memory',
  'sessions',
  'messaging',
  'skills',
  'admin',
] as const;

/**
 * Maps a tool preset to the set of built-in MCP servers that should be
 * attached. Server names here match the keys in the generated mcp-config JSON.
 * Note: 'admin' is not included by default - it's injected based on agent config.
 */
const MCP_SERVERS_BY_PRESET: Record<string, readonly string[]> = {
  potato: [],
  coding: ['memory', 'sessions', 'skills'],
  messaging: ['memory', 'sessions', 'messaging', 'skills'],
  full: ['memory', 'sessions', 'messaging', 'skills'], // admin added separately if enabled
  custom: [],
};

// ---------------------------------------------------------------------------
// MCP config types
// ---------------------------------------------------------------------------

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private queues: Map<string, Promise<unknown>> = new Map();
  private runner: ClaudeCliRunner;

  constructor(
    private store: Store,
    private registry: AgentRegistry,
    private config: Config,
  ) {
    this.runner = new ClaudeCliRunner();
    log.info('SessionManager initialized');
  }

  /**
   * Send a message to an agent, finding or creating the appropriate session.
   *
   * The session is looked up by (agentId, channel, userId, chatId). If no
   * active session exists, a new one is created after the claude invocation
   * returns a session ID.
   *
   * Calls to the same session key are serialized via an internal queue to
   * prevent concurrent writes to the same claude session.
   */
  async sendMessage(
    agentId: string,
    prompt: string,
    channel?: string,
    userId?: string,
    chatId?: string,
  ): Promise<ClaudeResult> {
    const sessionKey = buildSessionKey(agentId, channel, userId, chatId);

    return this.enqueue(sessionKey, async () => {
      // 1. Resolve agent config
      const agent = this.registry.tryGet(agentId);
      if (!agent) {
        throw new AgentNotFoundError(agentId);
      }

      // 2. Find existing active session
      let existingSession: SessionRow | undefined;
      if (channel && userId) {
        existingSession = this.store.findActiveSession({
          agentId,
          channel,
          channelUserId: userId,
          chatId,
        });
      } else {
        // CLI / direct invocation: find any active session for this agent
        const sessions = this.store.listSessions({
          agentId,
          status: 'active',
        });
        existingSession = sessions[0];
      }
      const isResume = existingSession !== undefined;

      // 3. Build ClaudeOptions
      const soulContent = this.registry.readSoul(agentId);
      const systemPrompt = this.buildSystemPrompt(agentId, soulContent);
      const mcpConfigPath = this.buildMcpConfig(agentId, agent.config);
      const allowedTools = resolveAllowedTools(
        agent.config.toolPreset,
        agent.config.customTools,
      );

      const options: ClaudeOptions = {
        prompt,
        systemPrompt,
        mcpConfigPath,
        allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
        maxTurns: agent.config.maxTurns,
        model: agent.config.model,
      };

      if (isResume && existingSession) {
        options.resumeSessionId = existingSession.id;
        log.debug('Resuming session', {
          sessionId: existingSession.id,
          agent: agentId,
        });
      } else {
        log.debug('Creating new session', { agent: agentId });
      }

      // 4. Run claude CLI
      const result = await this.runner.run(options);

      // 5. Persist session state
      if (isResume && existingSession) {
        this.store.touchSession(existingSession.id);
      } else {
        const sessionId = result.sessionId || randomUUID();
        this.store.createSession({
          id: sessionId,
          agentId,
          channel,
          channelUserId: userId,
          chatId,
        });
        log.info('Session created', { sessionId, agent: agentId });
      }

      // 6. Clean up temp MCP config
      this.cleanupMcpConfig(mcpConfigPath);

      // 7. Fire reflection cycle in background (non-blocking)
      this.tryReflection(agentId);

      return result;
    });
  }

  /**
   * Resume an existing session with a new prompt.
   * The session must already exist in the store.
   */
  async resumeSession(
    sessionId: string,
    prompt: string,
  ): Promise<ClaudeResult> {
    return this.enqueue(sessionId, async () => {
      const session = this.store.getSession(sessionId);
      if (!session) {
        throw new SessionNotFoundError(sessionId);
      }

      const agent = this.registry.tryGet(session.agent_id);
      if (!agent) {
        throw new AgentNotFoundError(session.agent_id);
      }

      const soulContent = this.registry.readSoul(session.agent_id);
      const systemPrompt = this.buildSystemPrompt(session.agent_id, soulContent);
      const mcpConfigPath = this.buildMcpConfig(
        session.agent_id,
        agent.config,
      );
      const allowedTools = resolveAllowedTools(
        agent.config.toolPreset,
        agent.config.customTools,
      );

      const options: ClaudeOptions = {
        prompt,
        resumeSessionId: sessionId,
        systemPrompt,
        mcpConfigPath,
        allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
        maxTurns: agent.config.maxTurns,
        model: agent.config.model,
      };

      log.debug('Resuming session', {
        sessionId,
        agent: session.agent_id,
      });

      const result = await this.runner.run(options);

      this.store.touchSession(sessionId);
      this.cleanupMcpConfig(mcpConfigPath);

      // Fire reflection cycle in background (non-blocking)
      this.tryReflection(session.agent_id);

      return result;
    });
  }

  /**
   * Create a standalone ClaudeCliRunner for direct use (e.g., by the RALPH
   * engine or one-off invocations).
   */
  createRunner(): ClaudeCliRunner {
    return new ClaudeCliRunner();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Fire a background reflection cycle for an agent if reflection is enabled.
   * Never awaited — runs asynchronously and logs errors without propagating.
   */
  private tryReflection(agentId: string): void {
    const agent = this.registry.tryGet(agentId);
    if (!agent) return;

    // Check agent config for reflection.enabled (default true)
    const reflectionCfg = (agent.config as Record<string, unknown>).reflection as
      | { enabled?: boolean }
      | undefined;
    if (reflectionCfg?.enabled === false) return;

    runReflectionCycle(agentId).catch((err) => {
      log.warn('Reflection cycle failed', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Build a combined system prompt: SOUL.md content + MEMORY.md + today's
   * daily log.  This ensures agents always start with their persistent
   * context regardless of which code path invokes the CLI (full gateway,
   * channel adapters, webhooks, etc.).
   */
  private buildSystemPrompt(agentId: string, soulContent: string): string {
    const parts: string[] = [];

    if (soulContent.trim()) {
      parts.push(soulContent.trim());
    }

    // Inject MEMORY.md so the agent starts with persistent context
    const homeDir = getConfigDir();
    const memoryPath = join(homeDir, 'agents', agentId, 'MEMORY.md');
    if (existsSync(memoryPath)) {
      const memory = readFileSync(memoryPath, 'utf-8').trim();
      const defaultMemory = '# Memory\n\n_Curated knowledge and observations._';
      if (
        memory &&
        memory !== defaultMemory &&
        memory !== '# Memory\n_Curated knowledge and observations._'
      ) {
        parts.push(
          '## Your Persistent Memory\n\nThe following is your curated long-term memory. Use it as context:\n\n' +
            memory,
        );
      }
    }

    // Inject today's daily log if it exists (recent session context)
    const today = new Date().toISOString().split('T')[0];
    const dailyLogPath = join(homeDir, 'agents', agentId, 'memory', `${today}.md`);
    if (existsSync(dailyLogPath)) {
      const dailyLog = readFileSync(dailyLogPath, 'utf-8').trim();
      if (dailyLog) {
        // Truncate to last ~2000 chars to avoid blowing context
        const truncated =
          dailyLog.length > 2000
            ? '...\n' + dailyLog.slice(-2000)
            : dailyLog;
        parts.push("## Today's Activity Log\n\n" + truncated);
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Queue operations per session key to prevent concurrent claude CLI
   * invocations on the same session.
   */
  private async enqueue<T>(
    sessionKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.queues.get(sessionKey) ?? Promise.resolve();
    // Always run fn after prev completes, regardless of prev's outcome
    const current = prev.catch(() => {}).then(() => fn());
    // Store a void-resolved version to prevent unhandled rejections
    this.queues.set(
      sessionKey,
      current.then(
        () => {},
        () => {},
      ),
    );
    return current;
  }

  /**
   * Build a temporary MCP config JSON file for the given agent.
   * Includes built-in servers (memory, sessions, messaging, skills) based on
   * the agent's tool preset, plus any active third-party skills.
   *
   * Returns the path to the temp file, or undefined if no MCP servers needed.
   */
  private buildMcpConfig(
    agentId: string,
    agentCfg: AgentConfig,
  ): string | undefined {
    const preset = agentCfg.toolPreset;
    const builtinServers = MCP_SERVERS_BY_PRESET[preset] ?? [];

    // If no built-in servers and no third-party skills, skip MCP config
    if (
      builtinServers.length === 0 &&
      (!agentCfg.skills || agentCfg.skills.length === 0)
    ) {
      return undefined;
    }

    const mcpConfig: McpConfig = { mcpServers: {} };
    const homeDir = getConfigDir();

    // Resolve the dist directory for built-in MCP server scripts.
    // In the built output, engine modules are at dist/index.js and
    // MCP servers are at dist/mcp/{name}-server.js.
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const distDir = join(currentDir, '..');

    const serverScripts: Record<string, string> = {
      memory: join(distDir, 'mcp', 'memory-server.js'),
      sessions: join(distDir, 'mcp', 'sessions-server.js'),
      messaging: join(distDir, 'mcp', 'messaging-server.js'),
      skills: join(distDir, 'mcp', 'skills-server.js'),
      admin: join(distDir, 'mcp', 'admin-server.js'),
    };

    // Add built-in MCP servers
    for (const serverName of builtinServers) {
      const scriptPath = serverScripts[serverName];
      if (!scriptPath) continue;

      mcpConfig.mcpServers[serverName] = {
        command: 'node',
        args: [scriptPath],
        env: {
          CLADE_AGENT_ID: agentId,
          CLADE_HOME: homeDir,
          ...(process.env['CLADE_IPC_SOCKET'] ? { CLADE_IPC_SOCKET: process.env['CLADE_IPC_SOCKET'] } : {}),
        },
      };
    }

    // Inject admin MCP server if agent has admin privileges
    const adminCfg = (agentCfg as Record<string, unknown>).admin as
      | { enabled?: boolean }
      | undefined;
    if (adminCfg?.enabled) {
      const adminScriptPath = serverScripts['admin'];
      if (adminScriptPath) {
        mcpConfig.mcpServers['admin'] = {
          command: 'node',
          args: [adminScriptPath],
          env: {
            CLADE_AGENT_ID: agentId,
            CLADE_HOME: homeDir,
            ...(process.env['CLADE_IPC_SOCKET'] ? { CLADE_IPC_SOCKET: process.env['CLADE_IPC_SOCKET'] } : {}),
          },
        };
        log.info('Admin MCP server enabled for agent', { agentId });
      }
    }

    // Add agent-specific third-party skills from ~/.clade/skills/active/
    if (agentCfg.skills && agentCfg.skills.length > 0) {
      const skillsDir = join(homeDir, 'skills', 'active');
      for (const skillName of agentCfg.skills) {
        // Skip built-in server names to avoid duplicates
        if ((builtinServers as readonly string[]).includes(skillName)) {
          continue;
        }

        const skillConfigPath = join(skillsDir, `${skillName}.json`);
        if (existsSync(skillConfigPath)) {
          try {
            const raw = readFileSync(skillConfigPath, 'utf-8');
            const skillConfig = JSON.parse(raw) as McpServerEntry;
            mcpConfig.mcpServers[skillName] = skillConfig;
          } catch (err: unknown) {
            log.warn('Failed to load skill config', {
              skill: skillName,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    // Add Playwright browser MCP if enabled in global config
    this.injectBrowserMcp(mcpConfig, this.config.browser);

    // Write to a temp file
    const tmpDir = join(tmpdir(), 'clade-mcp');
    mkdirSync(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `${agentId}-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');

    return tmpPath;
  }

  /**
   * Inject a Playwright MCP server entry into the config when browser
   * automation is enabled.
   *
   * Uses a persistent user-data-dir so that cookies, logins, and
   * localStorage survive across sessions.  Optionally connects to an
   * already-running browser via CDP to avoid the open/close cycle.
   */
  private injectBrowserMcp(
    mcpConfig: McpConfig,
    browserCfg: BrowserConfig | undefined,
  ): void {
    if (!browserCfg?.enabled) return;

    const args: string[] = ['@playwright/mcp@latest'];

    // Persistent profile directory — keeps logged-in state across sessions
    const defaultProfileDir = join(
      process.env['CLADE_HOME'] || join(homedir(), '.clade'),
      'browser-profile',
    );
    const userDataDir = browserCfg.userDataDir || defaultProfileDir;
    mkdirSync(userDataDir, { recursive: true });
    args.push('--user-data-dir', userDataDir);

    // CDP endpoint — connect to an existing browser instead of launching one.
    // This prevents the browser from closing/reopening on every session.
    if (browserCfg.cdpEndpoint) {
      args.push('--cdp-endpoint', browserCfg.cdpEndpoint);
    } else {
      // Only set browser channel and headless when launching (not CDP)
      if (browserCfg.browser && browserCfg.browser !== 'chromium') {
        args.push('--browser', browserCfg.browser);
      }
      if (browserCfg.headless) {
        args.push('--headless');
      }
    }

    mcpConfig.mcpServers['playwright'] = {
      command: 'npx',
      args,
    };

    log.debug('Injected Playwright MCP', {
      userDataDir,
      cdpEndpoint: browserCfg.cdpEndpoint ?? 'none (launches browser)',
      browser: browserCfg.browser,
    });
  }

  /**
   * Remove a temporary MCP config file (best-effort).
   */
  private cleanupMcpConfig(path: string | undefined): void {
    if (!path) return;
    try {
      unlinkSync(path);
    } catch {
      // Best-effort cleanup; temp files will be cleaned by OS eventually
    }
  }
}

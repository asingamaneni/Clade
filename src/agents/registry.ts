import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Config, AgentConfig } from '../config/schema.js';
import type { Agent } from './types.js';
import { getAgentsDir } from '../config/index.js';
import { DEFAULT_SOUL, DEFAULT_HEARTBEAT } from '../config/defaults.js';
import { AgentNotFoundError, AgentConfigError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('registry');

// ---------------------------------------------------------------------------
// Agent directory structure
// ---------------------------------------------------------------------------

/**
 * Returns the base directory for a given agent ID.
 */
function agentDir(agentId: string): string {
  return join(getAgentsDir(), agentId);
}

/**
 * Ensures the on-disk directory structure for an agent exists.
 * Creates the directory and default files if they are missing.
 */
function ensureAgentDir(agentId: string): void {
  const base = agentDir(agentId);
  const memDir = join(base, 'memory');

  mkdirSync(base, { recursive: true });
  mkdirSync(memDir, { recursive: true });

  // Create default SOUL.md if absent
  const soulPath = join(base, 'SOUL.md');
  if (!existsSync(soulPath)) {
    writeFileSync(soulPath, DEFAULT_SOUL, 'utf-8');
    log.info('Created default SOUL.md', { agent: agentId });
  }

  // Create default HEARTBEAT.md if absent
  const heartbeatPath = join(base, 'HEARTBEAT.md');
  if (!existsSync(heartbeatPath)) {
    writeFileSync(heartbeatPath, DEFAULT_HEARTBEAT, 'utf-8');
    log.info('Created default HEARTBEAT.md', { agent: agentId });
  }

  // Create empty MEMORY.md if absent
  const memoryPath = join(base, 'MEMORY.md');
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, '# Memory\n\n_No curated memories yet._\n', 'utf-8');
    log.info('Created default MEMORY.md', { agent: agentId });
  }
}

// ---------------------------------------------------------------------------
// Build an Agent object from config + disk
// ---------------------------------------------------------------------------

function buildAgent(agentId: string, agentConfig: AgentConfig): Agent {
  const base = agentDir(agentId);
  return {
    id: agentId,
    config: agentConfig,
    soulPath: join(base, 'SOUL.md'),
    memoryDir: join(base, 'memory'),
    heartbeatPath: join(base, 'HEARTBEAT.md'),
    baseDir: base,
  };
}

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

/**
 * The agent registry loads agent definitions from the global config and
 * materializes their on-disk directory structures. It provides lookup
 * and enumeration over all configured agents.
 */
export class AgentRegistry {
  private readonly agents: Map<string, Agent> = new Map();

  /**
   * Initialize the registry from the parsed global config.
   * Creates on-disk directories and default files for every configured agent.
   */
  constructor(config: Config) {
    const agentEntries = Object.entries(config.agents);

    if (agentEntries.length === 0) {
      log.warn('No agents defined in config — nothing to register');
    }

    for (const [id, agentConfig] of agentEntries) {
      if (!agentConfig) continue;
      ensureAgentDir(id);
      const agent = buildAgent(id, agentConfig);
      this.agents.set(id, agent);
      log.debug('Registered agent', { id, name: agentConfig.name });
    }

    log.info(`Agent registry initialized`, { count: this.agents.size });
  }

  // -----------------------------------------------------------------------
  // Lookups
  // -----------------------------------------------------------------------

  /**
   * Get an agent by ID.
   * @throws {AgentNotFoundError} if the agent does not exist.
   */
  get(agentId: string): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }
    return agent;
  }

  /**
   * Get an agent by ID, returning `undefined` if not found.
   */
  tryGet(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Check whether an agent ID is registered.
   */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Return all registered agents.
   */
  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Return all registered agent IDs.
   */
  ids(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Number of registered agents.
   */
  get size(): number {
    return this.agents.size;
  }

  // -----------------------------------------------------------------------
  // SOUL.md helpers
  // -----------------------------------------------------------------------

  /**
   * Read the SOUL.md content for a given agent.
   * Falls back to the built-in default if the file doesn't exist.
   */
  readSoul(agentId: string): string {
    const agent = this.get(agentId);
    if (existsSync(agent.soulPath)) {
      return readFileSync(agent.soulPath, 'utf-8');
    }
    return DEFAULT_SOUL;
  }

  /**
   * Read the HEARTBEAT.md content for a given agent.
   * Falls back to the built-in default if the file doesn't exist.
   */
  readHeartbeat(agentId: string): string {
    const agent = this.get(agentId);
    if (existsSync(agent.heartbeatPath)) {
      return readFileSync(agent.heartbeatPath, 'utf-8');
    }
    return DEFAULT_HEARTBEAT;
  }

  // -----------------------------------------------------------------------
  // Mutation (for runtime config changes via admin API)
  // -----------------------------------------------------------------------

  /**
   * Register or update an agent from a new config entry.
   * Creates the on-disk directory if needed.
   */
  register(agentId: string, agentConfig: AgentConfig): Agent {
    if (!agentConfig.name) {
      throw new AgentConfigError(agentId, 'agent must have a name');
    }
    ensureAgentDir(agentId);
    const agent = buildAgent(agentId, agentConfig);
    this.agents.set(agentId, agent);
    log.info('Agent registered', { id: agentId, name: agentConfig.name });
    return agent;
  }

  /**
   * Remove an agent from the registry.
   * Does NOT delete on-disk files (that requires explicit user action).
   * @returns `true` if the agent was removed, `false` if it wasn't registered.
   */
  unregister(agentId: string): boolean {
    const removed = this.agents.delete(agentId);
    if (removed) {
      log.info('Agent unregistered', { id: agentId });
    }
    return removed;
  }
}

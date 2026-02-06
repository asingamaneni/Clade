// ---------------------------------------------------------------------------
// Config migration system.
// Each migration transforms config from version N to version N+1.
// Migrations are additive — they add new fields with defaults, never remove.
// Agent state (SOUL.md, IDENTITY.md, MEMORY.md) is NEVER touched by migrations.
// ---------------------------------------------------------------------------

import { createLogger } from '../utils/logger.js';

const log = createLogger('migrations');

export interface Migration {
  /** Version this migration upgrades FROM. */
  fromVersion: number;
  /** Version this migration upgrades TO. */
  toVersion: number;
  /** Human-readable description. */
  description: string;
  /** Transform function — receives raw config, returns transformed config. */
  up: (config: Record<string, unknown>) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Migration definitions
// ---------------------------------------------------------------------------

const migrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    description: 'Add config versioning, reflection config, enable heartbeat by default',
    up: (config) => {
      const result: Record<string, unknown> = { ...config, version: 2 };

      // Add reflection config to all agents if missing
      const agents = (result.agents ?? {}) as Record<string, Record<string, unknown>>;
      for (const agentConfig of Object.values(agents)) {
        if (!agentConfig.reflection) {
          agentConfig.reflection = { enabled: true, interval: 10 };
        }
        // Enable heartbeat by default if it was disabled
        const hb = agentConfig.heartbeat as Record<string, unknown> | undefined;
        if (hb && hb.enabled === undefined) {
          hb.enabled = true;
        }
      }
      result.agents = agents;

      return result;
    },
  },
  {
    fromVersion: 2,
    toVersion: 3,
    description: 'Rename skills → mcp (align with Claude Code terminology)',
    up: (config) => {
      const result: Record<string, unknown> = { ...config, version: 3 };

      // Rename root-level skills → mcp
      if (result.skills !== undefined && result.mcp === undefined) {
        result.mcp = result.skills;
        delete result.skills;
      }

      // Rename agent.skills → agent.mcp for each agent
      const agents = (result.agents ?? {}) as Record<string, Record<string, unknown>>;
      for (const agentConfig of Object.values(agents)) {
        if (agentConfig.skills !== undefined && agentConfig.mcp === undefined) {
          agentConfig.mcp = agentConfig.skills;
          delete agentConfig.skills;
        }
      }
      result.agents = agents;

      return result;
    },
  },
];

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

/**
 * Returns the current schema version (the latest version migrations can produce).
 */
export function currentSchemaVersion(): number {
  if (migrations.length === 0) return 1;
  return Math.max(...migrations.map((m) => m.toVersion));
}

/**
 * Detect the version of a raw config object.
 * Config without a version field is assumed to be version 1.
 */
export function detectVersion(config: Record<string, unknown>): number {
  if (typeof config.version === 'number') return config.version;
  return 1;
}

/**
 * Run all applicable migrations on a raw config object.
 * Returns the migrated config and a list of migrations that were applied.
 */
export function migrateConfig(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  applied: string[];
} {
  let current = { ...config };
  let version = detectVersion(current);
  const target = currentSchemaVersion();
  const applied: string[] = [];

  if (version >= target) {
    return { config: current, applied };
  }

  log.info(`Migrating config from v${version} to v${target}`);

  while (version < target) {
    const migration = migrations.find((m) => m.fromVersion === version);
    if (!migration) {
      log.warn(`No migration found from v${version} — stopping`);
      break;
    }

    log.info(`Applying migration: ${migration.description}`, {
      from: migration.fromVersion,
      to: migration.toVersion,
    });

    current = migration.up(current);
    version = migration.toVersion;
    applied.push(migration.description);
  }

  return { config: current, applied };
}

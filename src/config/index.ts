import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type { Config } from './schema.js';
import { ConfigSchema } from './schema.js';
import { ConfigError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/**
 * Root directory for all Clade data.
 * Respects the CLADE_HOME env var; defaults to ~/.clade.
 */
export function getConfigDir(): string {
  return process.env['CLADE_HOME'] || join(homedir(), '.clade');
}

/**
 * Directory containing per-agent data (SOUL.md, MEMORY.md, etc.).
 */
export function getAgentsDir(): string {
  return join(getConfigDir(), 'agents');
}

/**
 * Path to the global config file.
 */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

/**
 * Path to the SQLite database.
 */
export function getDatabasePath(): string {
  return join(getConfigDir(), 'clade.db');
}

/**
 * Directory for MCP skill packages.
 */
export function getSkillsDir(): string {
  return join(getConfigDir(), 'skills');
}

// ---------------------------------------------------------------------------
// Environment variable expansion
// ---------------------------------------------------------------------------

/**
 * Replaces `${VAR_NAME}` tokens in a string with values from process.env.
 * Unknown variables resolve to the empty string.
 *
 * Only simple identifiers are matched (word characters: [A-Za-z0-9_]).
 */
export function expandEnvVars(str: string): string {
  return str.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    return process.env[name] ?? '';
  });
}

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

/**
 * Load and validate the config from disk.
 *
 * - If the config file does not exist, returns a fully-defaulted config
 *   (equivalent to `ConfigSchema.parse({})`).
 * - Environment variable tokens (`${VAR}`) in the JSON are expanded before
 *   parsing.
 * - Throws `ConfigError` on validation failure.
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return ConfigSchema.parse({});
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new ConfigError(
      `Failed to read config file at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const expanded = expandEnvVars(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(expanded);
  } catch (err) {
    throw new ConfigError(
      `Invalid JSON in config file at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Config validation failed:\n${issues}`);
  }

  return result.data;
}

/**
 * Write the config to disk. Creates the config directory if it does not exist.
 *
 * The config is serialized as pretty-printed JSON (2-space indent).
 */
export function saveConfig(config: Config): void {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Ensure the full directory tree for Clade data exists.
 * Called once at startup.
 */
export function ensureDirectories(): void {
  const dirs = [
    getConfigDir(),
    getAgentsDir(),
    getSkillsDir(),
    join(getSkillsDir(), 'pending'),
    join(getSkillsDir(), 'active'),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

// Re-export schema types for convenience
export { ConfigSchema } from './schema.js';
export type {
  Config,
  AgentConfig,
  HeartbeatConfig,
  ToolPreset,
  ChannelsConfig,
  GatewayConfig,
  RoutingRule,
  RoutingConfig,
  SkillsConfig,
} from './schema.js';

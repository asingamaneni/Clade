/**
 * Claude CLI compatibility layer.
 *
 * Detects the installed Claude CLI version and available features, then
 * provides a consistent interface for building CLI arguments regardless of
 * which version is installed.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCapabilities {
  version: string;
  hasPlugins: boolean;
  hasAgentsFlag: boolean;
  hasAppendSystemPromptFile: boolean;
  hasMcpToolSearch: boolean;
  hasStreamJson: boolean;
  hasResume: boolean;
  hasMaxTurns: boolean;
  hasAllowedTools: boolean;
  hasMcpConfig: boolean;
  hasModel: boolean;
}

export interface CliOptions {
  prompt: string;
  sessionId?: string;
  appendSystemPrompt?: string;
  appendSystemPromptFile?: string;
  allowedTools?: string[];
  mcpConfig?: string;
  maxTurns?: number;
  model?: string;
  outputFormat?: 'stream-json' | 'json' | 'text';
  agents?: Record<string, {
    description: string;
    prompt: string;
    tools?: string[];
    model?: string;
  }>;
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MINIMUM_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Cached state
// ---------------------------------------------------------------------------

let cachedCapabilities: ClaudeCapabilities | null = null;

/**
 * Whether --append-system-prompt (not the file variant) was found in --help.
 * Tracked separately because it is not in the ClaudeCapabilities interface
 * but is checked during compatibility validation.
 */
let cachedHasAppendSystemPrompt = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compare two semver version strings.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Handles non-semver gracefully by treating unparseable parts as 0.
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const match = v.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return [0, 0, 0];
    return [
      parseInt(match[1] ?? '0', 10),
      parseInt(match[2] ?? '0', 10),
      parseInt(match[3] ?? '0', 10),
    ];
  };

  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

/**
 * Extract the version string from `claude --version` output.
 * Handles formats like "claude 1.2.3", "1.2.3", "claude v1.2.3", etc.
 */
function parseVersionOutput(output: string): string {
  const trimmed = output.trim();
  // Match a semver-like pattern anywhere in the output
  const match = trimmed.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  if (match?.[1]) return match[1];
  // Fall back to the full trimmed output
  return trimmed;
}

/**
 * Parse `claude --help` output to determine which flags are available.
 */
function parseFlagsFromHelp(helpOutput: string): Set<string> {
  const flags = new Set<string>();
  // Match both --flag and --flag-name patterns
  const matches = helpOutput.matchAll(/--[\w][\w-]*/g);
  for (const m of matches) {
    flags.add(m[0]);
  }
  return flags;
}

/**
 * Resolve the Clade home directory.
 * Respects the CLADE_HOME env var; defaults to ~/.clade.
 */
function getHomeDir(): string {
  return process.env['CLADE_HOME'] || join(process.env['HOME'] || '', '.clade');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the capabilities of the installed Claude CLI.
 *
 * Runs `claude --version` and `claude --help` to determine the version and
 * available flags. The result is cached for the lifetime of the process.
 */
export function detectCapabilities(): ClaudeCapabilities {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  let versionOutput = '';
  try {
    versionOutput = execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // CLI not found or errored -- return minimal capabilities
    cachedHasAppendSystemPrompt = false;
    cachedCapabilities = {
      version: 'unknown',
      hasPlugins: false,
      hasAgentsFlag: false,
      hasAppendSystemPromptFile: false,
      hasMcpToolSearch: false,
      hasStreamJson: false,
      hasResume: false,
      hasMaxTurns: false,
      hasAllowedTools: false,
      hasMcpConfig: false,
      hasModel: false,
    };
    return cachedCapabilities;
  }

  const version = parseVersionOutput(versionOutput);

  let helpOutput = '';
  try {
    helpOutput = execSync('claude --help', {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // --help failed; we still have the version
  }

  const flags = parseFlagsFromHelp(helpOutput);

  // Track --append-system-prompt separately for compatibility checks
  cachedHasAppendSystemPrompt = flags.has('--append-system-prompt');

  cachedCapabilities = {
    version,
    hasPlugins: flags.has('--plugins'),
    hasAgentsFlag: flags.has('--agents'),
    hasAppendSystemPromptFile: flags.has('--append-system-prompt-file'),
    hasMcpToolSearch: flags.has('--mcp-tool-search'),
    hasStreamJson:
      flags.has('--output-format') || helpOutput.includes('stream-json'),
    hasResume: flags.has('--resume'),
    hasMaxTurns: flags.has('--max-turns'),
    hasAllowedTools: flags.has('--allowedTools') || flags.has('--allowed-tools'),
    hasMcpConfig: flags.has('--mcp-config'),
    hasModel: flags.has('--model'),
  };

  return cachedCapabilities;
}

/**
 * Returns the minimum required Claude CLI version for Clade.
 */
export function getMinimumVersion(): string {
  return MINIMUM_VERSION;
}

/**
 * Check whether the installed Claude CLI meets Clade requirements.
 *
 * - Errors are generated for missing critical features (stream-json, resume,
 *   append-system-prompt).
 * - Warnings are generated for missing optional features (plugins, agents
 *   flag, MCP tool search).
 */
export function checkCompatibility(): CompatibilityResult {
  const caps = detectCapabilities();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Version check
  if (caps.version === 'unknown') {
    errors.push(
      'Claude CLI is not installed or not found in PATH. ' +
      'Install it from https://docs.anthropic.com/en/docs/claude-cli',
    );
    return { compatible: false, warnings, errors };
  }

  if (compareSemver(caps.version, MINIMUM_VERSION) < 0) {
    errors.push(
      `Claude CLI version ${caps.version} is below the minimum required ` +
      `version ${MINIMUM_VERSION}. Please upgrade your Claude CLI.`,
    );
  }

  // Critical features
  if (!caps.hasStreamJson) {
    errors.push(
      'Claude CLI does not support --output-format stream-json. ' +
      'This is required for Clade to parse CLI output. Please upgrade.',
    );
  }

  if (!caps.hasResume) {
    errors.push(
      'Claude CLI does not support --resume. ' +
      'Session persistence requires this flag. Please upgrade.',
    );
  }

  if (!caps.hasAppendSystemPromptFile && !cachedHasAppendSystemPrompt) {
    errors.push(
      'Claude CLI does not support --append-system-prompt. ' +
      'Agent personality injection requires this flag. Please upgrade.',
    );
  }

  // Optional features
  if (!caps.hasPlugins) {
    warnings.push(
      'Claude CLI does not support --plugins (available in October 2025+). ' +
      'Plugin export will be disabled.',
    );
  }

  if (!caps.hasAgentsFlag) {
    warnings.push(
      'Claude CLI does not support --agents for inline subagents. ' +
      'Subagent definitions in buildCliArgs will be ignored.',
    );
  }

  if (!caps.hasMcpToolSearch) {
    warnings.push(
      'Claude CLI does not support MCP lazy tool loading (--mcp-tool-search, January 2026+). ' +
      'All MCP tools will be loaded eagerly.',
    );
  }

  return {
    compatible: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Build CLI argument array from options, respecting detected capabilities.
 *
 * Only includes flags that are supported by the installed CLI version.
 * Falls back gracefully when a preferred flag is unavailable (e.g. reads
 * the file content and passes it via --append-system-prompt when
 * --append-system-prompt-file is not available).
 *
 * Note: --append-system-prompt is always emitted when appendSystemPrompt or
 * appendSystemPromptFile is provided, since it is a fundamental feature that
 * all supported CLI versions include.
 */
export function buildCliArgs(options: CliOptions): string[] {
  const caps = detectCapabilities();
  const args: string[] = ['-p', options.prompt];

  // Output format
  if (options.outputFormat === 'stream-json' && caps.hasStreamJson) {
    args.push('--output-format', 'stream-json');
  } else if (options.outputFormat === 'json' && caps.hasStreamJson) {
    args.push('--output-format', 'json');
  } else if (options.outputFormat === 'text') {
    args.push('--output-format', 'text');
  } else if (caps.hasStreamJson) {
    // Default to stream-json when supported and no explicit format given
    args.push('--output-format', 'stream-json');
  }

  // Session resume
  if (options.sessionId && caps.hasResume) {
    args.push('--resume', options.sessionId);
  }

  // System prompt injection
  if (options.appendSystemPromptFile && caps.hasAppendSystemPromptFile) {
    // Prefer file-based injection when supported
    args.push('--append-system-prompt-file', options.appendSystemPromptFile);
  } else if (options.appendSystemPromptFile && !caps.hasAppendSystemPromptFile) {
    // Fallback: read the file and pass content inline
    try {
      const content = readFileSync(options.appendSystemPromptFile, 'utf-8');
      args.push('--append-system-prompt', content);
    } catch {
      // If the file cannot be read, fall through to the inline prompt if any
      if (options.appendSystemPrompt) {
        args.push('--append-system-prompt', options.appendSystemPrompt);
      }
    }
  } else if (options.appendSystemPrompt) {
    args.push('--append-system-prompt', options.appendSystemPrompt);
  }

  // Allowed tools
  if (options.allowedTools && options.allowedTools.length > 0 && caps.hasAllowedTools) {
    args.push('--allowedTools', options.allowedTools.join(','));
  }

  // MCP config
  if (options.mcpConfig && caps.hasMcpConfig) {
    args.push('--mcp-config', options.mcpConfig);
  }

  // Max turns
  if (options.maxTurns !== undefined && options.maxTurns > 0 && caps.hasMaxTurns) {
    args.push('--max-turns', String(options.maxTurns));
  }

  // Model
  if (options.model && caps.hasModel) {
    args.push('--model', options.model);
  }

  // Agents (inline subagents)
  if (options.agents && caps.hasAgentsFlag) {
    const agentsJson = JSON.stringify(options.agents);
    args.push('--agents', agentsJson);
  }

  return args;
}

/**
 * Export an agent's configuration as a Claude Code plugin directory structure.
 *
 * Creates:
 * ```
 * outputDir/
 * +-- .claude-plugin/
 * |   +-- plugin.json
 * +-- agents/
 * |   +-- <agentId>.md      (frontmatter with model, tools + SOUL.md content)
 * +-- .mcp.json              (agent's MCP server config)
 * ```
 *
 * @throws Error if the --plugins capability is not available.
 */
export function exportAsPlugin(agentId: string, outputDir: string): void {
  const caps = detectCapabilities();

  if (!caps.hasPlugins) {
    throw new Error(
      'Cannot export as plugin: the installed Claude CLI does not support --plugins. ' +
      'This feature requires the October 2025+ release or later.',
    );
  }

  // Resolve agent paths using the same logic as the config module
  const homeDir = getHomeDir();
  const agentBaseDir = join(homeDir, 'agents', agentId);

  // Read SOUL.md for the agent
  const soulPath = join(agentBaseDir, 'SOUL.md');
  let soulContent = '';
  if (existsSync(soulPath)) {
    soulContent = readFileSync(soulPath, 'utf-8');
  }

  // Attempt to read agent config from config.json
  let agentModel = 'sonnet';
  let agentTools: string[] = [];
  let agentDescription = '';
  let mcpServers: Record<string, unknown> = {};

  const configPath = join(homeDir, 'config.json');
  if (existsSync(configPath)) {
    try {
      const rawConfig = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(rawConfig) as {
        agents?: Record<string, {
          model?: string;
          description?: string;
          customTools?: string[];
        }>;
      };
      const agentConfig = config.agents?.[agentId];
      if (agentConfig) {
        agentModel = agentConfig.model ?? 'sonnet';
        agentDescription = agentConfig.description ?? '';
        if (agentConfig.customTools && agentConfig.customTools.length > 0) {
          agentTools = agentConfig.customTools;
        }
      }
    } catch {
      // Config unavailable or invalid; proceed with defaults
    }
  }

  // Read existing MCP config if present
  const agentMcpConfigPath = join(agentBaseDir, 'mcp.json');
  if (existsSync(agentMcpConfigPath)) {
    try {
      mcpServers = JSON.parse(
        readFileSync(agentMcpConfigPath, 'utf-8'),
      ) as Record<string, unknown>;
    } catch {
      // Invalid JSON; proceed with empty config
    }
  }

  // Create directory structure
  const pluginDir = join(outputDir, '.claude-plugin');
  const agentsDir = join(outputDir, 'agents');

  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });

  // Write plugin.json
  const pluginJson = {
    name: agentId,
    version: '1.0.0',
    description: agentDescription || `Clade plugin for ${agentId}`,
  };
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify(pluginJson, null, 2) + '\n',
    'utf-8',
  );

  // Write agent markdown with YAML frontmatter
  const toolsLine = agentTools.length > 0
    ? `tools:\n${agentTools.map((t) => `  - ${t}`).join('\n')}`
    : '';
  const frontmatter = [
    '---',
    `model: ${agentModel}`,
    ...(toolsLine ? [toolsLine] : []),
    '---',
    '',
  ].join('\n');

  const agentMd = frontmatter + soulContent;
  writeFileSync(join(agentsDir, `${agentId}.md`), agentMd, 'utf-8');

  // Write .mcp.json
  writeFileSync(
    join(outputDir, '.mcp.json'),
    JSON.stringify(mcpServers, null, 2) + '\n',
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset the cached capabilities. Only intended for use in tests.
 * @internal
 */
export function _resetCachedCapabilities(): void {
  cachedCapabilities = null;
  cachedHasAppendSystemPrompt = false;
}

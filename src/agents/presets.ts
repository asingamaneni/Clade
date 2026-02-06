import type { ToolPreset } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Claude Code native tool names
// ---------------------------------------------------------------------------

/** File reading. */
const READ = 'Read';
/** File editing (string replacement). */
const EDIT = 'Edit';
/** File writing (create / overwrite). */
const WRITE = 'Write';
/** Bash shell execution. */
const BASH = 'Bash';
/** Glob-based file search. */
const GLOB = 'Glob';
/** Grep-based content search. */
const GREP = 'Grep';
/** Jupyter notebook editing. */
const NOTEBOOK_EDIT = 'NotebookEdit';
/** Web fetching. */
const WEB_FETCH = 'WebFetch';
/** Web search. */
const WEB_SEARCH = 'WebSearch';
/** Task / sub-agent tool. */
const TASK = 'Task';
/** Todo management. */
const TODO_WRITE = 'TodoWrite';

// ---------------------------------------------------------------------------
// MCP tool wildcard patterns
//
// Each MCP server's tools are referenced with `mcp__<server>__<tool>`.
// Using wildcards so new tools added to an MCP server are automatically
// available.
// ---------------------------------------------------------------------------

const MCP_MEMORY = 'mcp__memory__*';
const MCP_SESSIONS = 'mcp__sessions__*';
const MCP_MESSAGING = 'mcp__messaging__*';
const MCP_MCP_MANAGER = 'mcp__mcp-manager__*';
const MCP_PLATFORM = 'mcp__platform__*';

// ---------------------------------------------------------------------------
// Grouped tool sets
// ---------------------------------------------------------------------------

/** Core file-system and code tools. */
const CODING_TOOLS = [READ, EDIT, WRITE, BASH, GLOB, GREP, NOTEBOOK_EDIT] as const;

/** Extended tools for autonomous work. */
const EXTENDED_TOOLS = [WEB_FETCH, WEB_SEARCH, TASK, TODO_WRITE] as const;

/** All native Claude Code tools. */
const ALL_NATIVE_TOOLS = [...CODING_TOOLS, ...EXTENDED_TOOLS] as const;

/** All custom MCP server tool wildcards. */
const ALL_MCP_TOOLS = [MCP_MEMORY, MCP_SESSIONS, MCP_MESSAGING, MCP_MCP_MANAGER, MCP_PLATFORM] as const;

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

/**
 * Maps a tool preset name to the `--allowedTools` array passed to the
 * `claude` CLI.
 *
 * - **potato**: No tools at all. The agent can only chat.
 * - **coding**: File-system tools + memory and sessions MCP. No messaging, no
 *   MCP server installation, no web access.
 * - **messaging**: Only MCP tools (memory, sessions, messaging). No file system
 *   or code execution. Suitable for agents that only relay messages.
 * - **full**: Everything. All native tools and all MCP tools.
 * - **custom**: Returns an empty array. The caller should use the agent's
 *   `customTools` list instead.
 */
const PRESET_MAP: Record<ToolPreset, readonly string[]> = {
  potato: [],

  coding: [
    ...CODING_TOOLS,
    MCP_MEMORY,
    MCP_SESSIONS,
    MCP_MCP_MANAGER,
  ],

  messaging: [
    MCP_MEMORY,
    MCP_SESSIONS,
    MCP_MESSAGING,
    MCP_MCP_MANAGER,
  ],

  full: [
    ...ALL_NATIVE_TOOLS,
    ...ALL_MCP_TOOLS,
  ],

  custom: [],
};

/**
 * Resolve the allowed-tools list for a given preset and optional custom tools.
 *
 * @param preset - Tool preset name from agent config.
 * @param customTools - Explicit tool list, used when preset is "custom".
 * @returns An array of tool name strings for `--allowedTools`.
 */
export function resolveAllowedTools(
  preset: ToolPreset,
  customTools: readonly string[] = [],
): string[] {
  if (preset === 'custom') {
    return [...customTools];
  }
  return [...PRESET_MAP[preset]];
}

/**
 * Return a human-readable summary of what a preset grants.
 * Useful for CLI `agent list` output.
 */
export function describePreset(preset: ToolPreset): string {
  switch (preset) {
    case 'potato':
      return 'No tools (chat only)';
    case 'coding':
      return 'File system + code tools, memory, sessions & MCP manager';
    case 'messaging':
      return 'Memory, sessions, messaging & MCP manager only';
    case 'full':
      return 'All tools (native + MCP)';
    case 'custom':
      return 'Custom tool list';
  }
}

/**
 * Get the raw preset map. Useful for admin UI / diagnostics.
 */
export function getPresetMap(): Readonly<Record<ToolPreset, readonly string[]>> {
  return PRESET_MAP;
}

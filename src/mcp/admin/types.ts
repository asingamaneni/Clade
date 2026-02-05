// ---------------------------------------------------------------------------
// Admin MCP Server Types
// ---------------------------------------------------------------------------

/**
 * Agent Skill following the AgentSkills.io specification
 */
export interface AgentSkill {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  // Resolved paths
  path?: string;
  source?: SkillSource;
}

/**
 * Where a skill was discovered/installed from
 */
export interface SkillSource {
  type: 'local' | 'github' | 'npm' | 'url' | 'gist' | 'registry' | 'created';
  url?: string;
  repo?: string;
  registry?: string;
  installedAt?: string;
}

/**
 * Search result from any skill source
 */
export interface SkillSearchResult {
  name: string;
  description: string;
  source: SkillSource;
  url?: string;
  stars?: number;
  downloads?: number;
  author?: string;
  lastUpdated?: string;
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
  source?: string;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  name: string;
  description: string;
  version: string;
  author?: {
    name: string;
    url?: string;
  };
  repository?: string;
  skills?: string[];
  agents?: string[];
  hooks?: boolean;
  mcp?: boolean;
}

/**
 * Skill creation request
 */
export interface SkillCreateRequest {
  name: string;
  description: string;
  instructions: string;
  scripts?: Array<{
    filename: string;
    content: string;
    language: string;
  }>;
  references?: Array<{
    filename: string;
    content: string;
  }>;
  allowedTools?: string;
  license?: string;
  metadata?: Record<string, string>;
}

/**
 * Registry search options
 */
export interface RegistrySearchOptions {
  query: string;
  registries?: string[];
  limit?: number;
}

/**
 * GitHub search options
 */
export interface GitHubSearchOptions {
  query: string;
  topic?: string;
  language?: string;
  limit?: number;
}

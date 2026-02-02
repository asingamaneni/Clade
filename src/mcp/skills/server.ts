import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
} from 'node:fs';

import { searchNpmRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const baseDir =
  process.env['TEAMAGENTS_HOME'] ?? join(homedir(), '.teamagents');

const skillsDir = join(baseDir, 'skills');
const activeDir = join(skillsDir, 'active');
const pendingDir = join(skillsDir, 'pending');

// Ensure directories exist
mkdirSync(activeDir, { recursive: true });
mkdirSync(pendingDir, { recursive: true });

// ---------------------------------------------------------------------------
// Skill config type
// ---------------------------------------------------------------------------

interface SkillConfig {
  name: string;
  description: string;
  package?: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a short directory-safe name from an npm package name or arbitrary string.
 */
function toSkillDirName(nameOrPackage: string): string {
  // Strip scope prefix (@org/) and replace non-alphanumeric with dashes
  return nameOrPackage
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Read a skill's mcp.json config from a directory.
 */
function readSkillConfig(dir: string): SkillConfig | null {
  const configPath = join(dir, 'mcp.json');
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as SkillConfig;
  } catch {
    return null;
  }
}

/**
 * List skills from a given parent directory (active/ or pending/).
 */
function listSkillsInDir(
  dir: string,
  status: string,
): Array<{
  name: string;
  status: string;
  package: string;
  description: string;
}> {
  const results: Array<{
    name: string;
    status: string;
    package: string;
    description: string;
  }> = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(entryPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const config = readSkillConfig(entryPath);
    results.push({
      name: config?.name ?? entry,
      status,
      package: config?.package ?? config?.command ?? 'custom',
      description: config?.description ?? '',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'teamagents-skills',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Tool: skills_search
// ---------------------------------------------------------------------------

server.tool(
  'skills_search',
  'Search for MCP server packages on the npm registry.',
  {
    query: z.string().describe('Search query'),
  },
  async ({ query }) => {
    try {
      const packages = await searchNpmRegistry(query);

      if (packages.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No packages found.',
            },
          ],
        };
      }

      const lines = packages.map((pkg, i) => {
        return [
          `### ${i + 1}. ${pkg.name} (v${pkg.version})`,
          pkg.description ? `> ${pkg.description}` : '',
          `- **Downloads:** ~${pkg.weeklyDownloads.toLocaleString()}/week`,
          `- **Published:** ${pkg.date}`,
          `- **Publisher:** ${pkg.publisher}`,
          pkg.keywords.length > 0
            ? `- **Keywords:** ${pkg.keywords.join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `## NPM Search Results\n\n${lines.join('\n\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error searching registry: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: skills_install
// ---------------------------------------------------------------------------

server.tool(
  'skills_install',
  'Stage a skill for installation (placed in pending/ for approval).',
  {
    package: z
      .string()
      .describe('npm package name or URL to install'),
    config: z
      .object({
        env: z.record(z.string()).optional().describe('Environment variables'),
        args: z.array(z.string()).optional().describe('Additional arguments'),
      })
      .optional()
      .describe('Optional configuration for the skill'),
  },
  async ({ package: pkgName, config }) => {
    try {
      const dirName = toSkillDirName(pkgName);
      const skillDir = join(pendingDir, dirName);

      // Check if already exists
      if (existsSync(join(activeDir, dirName))) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Skill "${dirName}" is already installed and active.`,
            },
          ],
        };
      }

      mkdirSync(skillDir, { recursive: true });

      const skillConfig: SkillConfig = {
        name: dirName,
        description: `MCP server from ${pkgName}`,
        package: pkgName,
        command: 'npx',
        args: ['-y', pkgName, ...(config?.args ?? [])],
        env: config?.env,
      };

      writeFileSync(
        join(skillDir, 'mcp.json'),
        JSON.stringify(skillConfig, null, 2) + '\n',
        'utf-8',
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Skill "${dirName}" staged for approval in pending/.`,
              '',
              '**Config:**',
              '```json',
              JSON.stringify(skillConfig, null, 2),
              '```',
              '',
              'The skill will become active after operator approval.',
            ].join('\n'),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error staging skill: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: skills_create
// ---------------------------------------------------------------------------

server.tool(
  'skills_create',
  'Create a custom skill configuration (staged in pending/ for approval).',
  {
    name: z.string().describe('Skill name'),
    description: z.string().describe('Description of the skill'),
    command: z.string().describe('Command to run the MCP server'),
    args: z.array(z.string()).describe('Command arguments'),
    env: z
      .record(z.string())
      .optional()
      .describe('Optional environment variables'),
  },
  async ({ name, description, command, args, env }) => {
    try {
      const dirName = toSkillDirName(name);
      const skillDir = join(pendingDir, dirName);

      if (existsSync(join(activeDir, dirName))) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Skill "${dirName}" already exists in active/.`,
            },
          ],
        };
      }

      mkdirSync(skillDir, { recursive: true });

      const skillConfig: SkillConfig = {
        name: dirName,
        description,
        command,
        args,
        env: env ?? undefined,
      };

      writeFileSync(
        join(skillDir, 'mcp.json'),
        JSON.stringify(skillConfig, null, 2) + '\n',
        'utf-8',
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Custom skill "${dirName}" created in pending/.`,
              '',
              '**Config:**',
              '```json',
              JSON.stringify(skillConfig, null, 2),
              '```',
              '',
              'The skill will become active after operator approval.',
            ].join('\n'),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error creating skill: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: skills_list
// ---------------------------------------------------------------------------

server.tool(
  'skills_list',
  'List all skills (active, pending, and disabled).',
  {},
  async () => {
    try {
      const active = listSkillsInDir(activeDir, 'active');
      const pending = listSkillsInDir(pendingDir, 'pending');

      // Check for a disabled/ directory too
      const disabledDir = join(skillsDir, 'disabled');
      const disabled = existsSync(disabledDir)
        ? listSkillsInDir(disabledDir, 'disabled')
        : [];

      const all = [...active, ...pending, ...disabled];

      if (all.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No skills installed.',
            },
          ],
        };
      }

      const lines = all.map(
        (s) =>
          `- **${s.name}** [${s.status}] - ${s.description || 'No description'} (${s.package})`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `## Installed Skills\n\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing skills: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: skills_remove
// ---------------------------------------------------------------------------

server.tool(
  'skills_remove',
  'Remove a skill (from active/ or pending/).',
  {
    name: z.string().describe('Skill name to remove'),
  },
  async ({ name }) => {
    try {
      const dirName = toSkillDirName(name);

      // Look in active/ first, then pending/
      const activePath = join(activeDir, dirName);
      const pendingPath = join(pendingDir, dirName);

      let removedFrom: string | null = null;

      if (existsSync(activePath)) {
        rmSync(activePath, { recursive: true, force: true });
        removedFrom = 'active';
      } else if (existsSync(pendingPath)) {
        rmSync(pendingPath, { recursive: true, force: true });
        removedFrom = 'pending';
      }

      // Also check disabled/
      const disabledPath = join(skillsDir, 'disabled', dirName);
      if (existsSync(disabledPath)) {
        rmSync(disabledPath, { recursive: true, force: true });
        removedFrom = removedFrom ? `${removedFrom} and disabled` : 'disabled';
      }

      if (!removedFrom) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Skill "${dirName}" not found in active/, pending/, or disabled/.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Skill "${dirName}" removed from ${removedFrom}/.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error removing skill: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

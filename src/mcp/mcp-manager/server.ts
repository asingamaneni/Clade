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
  process.env['CLADE_HOME'] ?? join(homedir(), '.clade');

const mcpDir = join(baseDir, 'mcp');
const activeDir = join(mcpDir, 'active');
const pendingDir = join(mcpDir, 'pending');

// Ensure directories exist
mkdirSync(activeDir, { recursive: true });
mkdirSync(pendingDir, { recursive: true });

// ---------------------------------------------------------------------------
// MCP package config type
// ---------------------------------------------------------------------------

interface McpPackageConfig {
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
function toMcpDirName(nameOrPackage: string): string {
  // Strip scope prefix (@org/) and replace non-alphanumeric with dashes
  return nameOrPackage
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Read an MCP server's mcp.json config from a directory.
 */
function readMcpConfig(dir: string): McpPackageConfig | null {
  const configPath = join(dir, 'mcp.json');
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as McpPackageConfig;
  } catch {
    return null;
  }
}

/**
 * List MCP servers from a given parent directory (active/ or pending/).
 */
function listMcpInDir(
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

    const config = readMcpConfig(entryPath);
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
  name: 'clade-mcp-manager',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Tool: mcp_search
// ---------------------------------------------------------------------------

server.tool(
  'mcp_search',
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
// Tool: mcp_install
// ---------------------------------------------------------------------------

server.tool(
  'mcp_install',
  'Stage an MCP server for installation (placed in pending/ for approval).',
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
      .describe('Optional configuration for the MCP server'),
  },
  async ({ package: pkgName, config }) => {
    try {
      const dirName = toMcpDirName(pkgName);
      const mcpServerDir = join(pendingDir, dirName);

      // Check if already exists
      if (existsSync(join(activeDir, dirName))) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `MCP server "${dirName}" is already installed and active.`,
            },
          ],
        };
      }

      mkdirSync(mcpServerDir, { recursive: true });

      const mcpConfig: McpPackageConfig = {
        name: dirName,
        description: `MCP server from ${pkgName}`,
        package: pkgName,
        command: 'npx',
        args: ['-y', pkgName, ...(config?.args ?? [])],
        env: config?.env,
      };

      writeFileSync(
        join(mcpServerDir, 'mcp.json'),
        JSON.stringify(mcpConfig, null, 2) + '\n',
        'utf-8',
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `MCP server "${dirName}" staged for approval in pending/.`,
              '',
              '**Config:**',
              '```json',
              JSON.stringify(mcpConfig, null, 2),
              '```',
              '',
              'The MCP server will become active after operator approval.',
            ].join('\n'),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error staging MCP server: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: mcp_create
// ---------------------------------------------------------------------------

server.tool(
  'mcp_create',
  'Create a custom MCP server configuration (staged in pending/ for approval).',
  {
    name: z.string().describe('MCP server name'),
    description: z.string().describe('Description of the MCP server'),
    command: z.string().describe('Command to run the MCP server'),
    args: z.array(z.string()).describe('Command arguments'),
    env: z
      .record(z.string())
      .optional()
      .describe('Optional environment variables'),
  },
  async ({ name, description, command, args, env }) => {
    try {
      const dirName = toMcpDirName(name);
      const mcpServerDir = join(pendingDir, dirName);

      if (existsSync(join(activeDir, dirName))) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `MCP server "${dirName}" already exists in active/.`,
            },
          ],
        };
      }

      mkdirSync(mcpServerDir, { recursive: true });

      const mcpConfig: McpPackageConfig = {
        name: dirName,
        description,
        command,
        args,
        env: env ?? undefined,
      };

      writeFileSync(
        join(mcpServerDir, 'mcp.json'),
        JSON.stringify(mcpConfig, null, 2) + '\n',
        'utf-8',
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Custom MCP server "${dirName}" created in pending/.`,
              '',
              '**Config:**',
              '```json',
              JSON.stringify(mcpConfig, null, 2),
              '```',
              '',
              'The MCP server will become active after operator approval.',
            ].join('\n'),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error creating MCP server: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: mcp_list
// ---------------------------------------------------------------------------

server.tool(
  'mcp_list',
  'List all MCP servers (active, pending, and disabled).',
  {},
  async () => {
    try {
      const active = listMcpInDir(activeDir, 'active');
      const pending = listMcpInDir(pendingDir, 'pending');

      // Check for a disabled/ directory too
      const disabledDir = join(mcpDir, 'disabled');
      const disabled = existsSync(disabledDir)
        ? listMcpInDir(disabledDir, 'disabled')
        : [];

      const all = [...active, ...pending, ...disabled];

      if (all.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No MCP servers installed.',
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
            text: `## Installed MCP Servers\n\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing MCP servers: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: mcp_remove
// ---------------------------------------------------------------------------

server.tool(
  'mcp_remove',
  'Remove an MCP server (from active/ or pending/).',
  {
    name: z.string().describe('MCP server name to remove'),
  },
  async ({ name }) => {
    try {
      const dirName = toMcpDirName(name);

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
      const disabledPath = join(mcpDir, 'disabled', dirName);
      if (existsSync(disabledPath)) {
        rmSync(disabledPath, { recursive: true, force: true });
        removedFrom = removedFrom ? `${removedFrom} and disabled` : 'disabled';
      }

      if (!removedFrom) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `MCP server "${dirName}" not found in active/, pending/, or disabled/.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `MCP server "${dirName}" removed from ${removedFrom}/.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error removing MCP server: ${err instanceof Error ? err.message : String(err)}`,
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

// ---------------------------------------------------------------------------
// Admin MCP Server - Full autonomous skill and MCP management for orchestrator
// ---------------------------------------------------------------------------

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  searchLocalSkills,
  searchGitHub,
  searchNpm,
  searchKnownRepos,
  searchWeb,
  searchAllSources,
} from './discovery.js';

import {
  installFromGitHub,
  installFromUrl,
  installFromNpm,
  removeSkill,
  installMcpServer,
  removeMcpServer,
  listMcpServers,
} from './installer.js';

import {
  createSkill,
  createFromTemplate,
  updateSkill,
  SKILL_TEMPLATES,
  validateSkillName,
  toValidSkillName,
} from './creator.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CLAUDE_HOME = join(homedir(), '.claude');
const SKILLS_DIR = join(CLAUDE_HOME, 'skills');
const CLADE_HOME = process.env['CLADE_HOME'] ?? join(homedir(), '.clade');
const CONFIG_PATH = join(CLADE_HOME, 'config.json');

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'clade-admin',
  version: '0.1.0',
});

// ===========================================================================
// SKILL DISCOVERY TOOLS
// ===========================================================================

// ---------------------------------------------------------------------------
// Tool: admin_skill_search_local
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_search_local',
  'Search for skills installed locally in ~/.claude/skills/',
  {
    query: z.string().optional().describe('Search query to filter skills'),
  },
  async ({ query }) => {
    try {
      const skills = searchLocalSkills(query);

      if (skills.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: query
              ? `No local skills found matching "${query}".`
              : 'No skills installed locally.',
          }],
        };
      }

      const lines = [
        `## Local Skills (${skills.length})`,
        '',
        ...skills.map((s) =>
          `- **${s.name}**: ${s.description || 'No description'}\n  Path: \`${s.path}\``,
        ),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching local skills: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_search_github
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_search_github',
  'Search GitHub for skill repositories containing SKILL.md files.',
  {
    query: z.string().describe('Search query'),
    topic: z.string().optional().describe('GitHub topic to filter by (e.g., "agent-skills")'),
    limit: z.number().optional().default(10).describe('Maximum results'),
  },
  async ({ query, topic, limit }) => {
    try {
      const results = await searchGitHub({ query, topic, limit });

      if (results.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No GitHub repositories found for "${query}".`,
          }],
        };
      }

      const lines = [
        `## GitHub Results (${results.length})`,
        '',
        ...results.map((r) =>
          `- **${r.name}** ⭐${r.stars ?? 0}\n  ${r.description || 'No description'}\n  ${r.url}\n  By: ${r.author}`,
        ),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching GitHub: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_search_npm
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_search_npm',
  'Search npm registry for skill packages.',
  {
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10).describe('Maximum results'),
  },
  async ({ query, limit }) => {
    try {
      const results = await searchNpm(query, limit);

      if (results.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No npm packages found for "${query}".`,
          }],
        };
      }

      const lines = [
        `## NPM Results (${results.length})`,
        '',
        ...results.map((r) =>
          `- **${r.name}** (~${r.downloads ?? 0} downloads)\n  ${r.description || 'No description'}\n  By: ${r.author}`,
        ),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching npm: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_search_web
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_search_web',
  'Search the web for skills using DuckDuckGo.',
  {
    query: z.string().describe('Search query'),
  },
  async ({ query }) => {
    try {
      const results = await searchWeb(query);

      if (results.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No web results found for "${query}".`,
          }],
        };
      }

      const lines = [
        `## Web Results (${results.length})`,
        '',
        ...results.map((r) => `- **${r.name}**\n  ${r.url}`),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching web: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_search_all
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_search_all',
  'Search all sources (local, GitHub, npm, known repos, web) for skills.',
  {
    query: z.string().describe('Search query'),
    includeWeb: z.boolean().optional().default(true).describe('Include web search results'),
  },
  async ({ query, includeWeb }) => {
    try {
      const results = await searchAllSources(query, { includeWeb });

      const sections: string[] = ['## Skill Search Results', ''];

      if (results.local.length > 0) {
        sections.push(`### Local (${results.local.length})`);
        sections.push(...results.local.map((s) => `- **${s.name}**: ${s.description}`));
        sections.push('');
      }

      if (results.knownRepos.length > 0) {
        sections.push(`### Known Repositories (${results.knownRepos.length})`);
        sections.push(...results.knownRepos.map((r) => `- **${r.name}** from ${r.source.repo}`));
        sections.push('');
      }

      if (results.github.length > 0) {
        sections.push(`### GitHub (${results.github.length})`);
        sections.push(...results.github.slice(0, 5).map((r) => `- **${r.name}** ⭐${r.stars} - ${r.url}`));
        sections.push('');
      }

      if (results.npm.length > 0) {
        sections.push(`### NPM (${results.npm.length})`);
        sections.push(...results.npm.slice(0, 5).map((r) => `- **${r.name}** - ${r.description}`));
        sections.push('');
      }

      if (results.web.length > 0) {
        sections.push(`### Web (${results.web.length})`);
        sections.push(...results.web.slice(0, 5).map((r) => `- ${r.name} - ${r.url}`));
      }

      const totalFound =
        results.local.length +
        results.github.length +
        results.npm.length +
        results.knownRepos.length +
        results.web.length;

      if (totalFound === 0) {
        sections.push('No skills found. Consider creating one with `admin_skill_create`.');
      }

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ===========================================================================
// SKILL INSTALLATION TOOLS
// ===========================================================================

// ---------------------------------------------------------------------------
// Tool: admin_skill_install_github
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_install_github',
  'Install a skill from a GitHub repository.',
  {
    repo: z.string().describe('GitHub repo (e.g., "anthropics/skills")'),
    skillPath: z.string().optional().describe('Path to skill in repo (e.g., "skills/code-review")'),
    branch: z.string().optional().default('main').describe('Branch to clone from'),
    name: z.string().optional().describe('Override skill name'),
  },
  async ({ repo, skillPath, branch, name }) => {
    try {
      const result = await installFromGitHub({
        repo,
        skillPath,
        branch,
        targetName: name,
      });

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to install skill: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✅ Skill installed successfully!`,
            '',
            `**Name:** ${result.skill!.name}`,
            `**Description:** ${result.skill!.description}`,
            `**Path:** ${result.skill!.path}`,
            `**Source:** ${repo}`,
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error installing skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_install_url
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_install_url',
  'Install a skill from a URL (raw GitHub, Gist, etc.).',
  {
    url: z.string().describe('URL to SKILL.md or skill directory'),
    name: z.string().optional().describe('Override skill name'),
  },
  async ({ url, name }) => {
    try {
      const result = await installFromUrl({ url, targetName: name });

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to install skill: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✅ Skill installed from URL!`,
            '',
            `**Name:** ${result.skill!.name}`,
            `**Description:** ${result.skill!.description}`,
            `**Path:** ${result.skill!.path}`,
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error installing skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_install_npm
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_install_npm',
  'Install a skill from an npm package.',
  {
    package: z.string().describe('npm package name'),
    name: z.string().optional().describe('Override skill name'),
  },
  async ({ package: pkgName, name }) => {
    try {
      const result = await installFromNpm({ package: pkgName, targetName: name });

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to install skill: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✅ Skill installed from npm!`,
            '',
            `**Name:** ${result.skill!.name}`,
            `**Description:** ${result.skill!.description}`,
            `**Path:** ${result.skill!.path}`,
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error installing skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_remove
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_remove',
  'Remove an installed skill.',
  {
    name: z.string().describe('Skill name to remove'),
  },
  async ({ name }) => {
    try {
      const result = removeSkill(name);

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to remove skill: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Skill "${name}" removed successfully.`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error removing skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_approve
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_approve',
  'Approve a pending skill by moving it from pending/ to active/. This makes the skill available for use.',
  {
    name: z.string().describe('Skill name to approve'),
  },
  async ({ name }) => {
    try {
      const { renameSync, existsSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');

      const skillsDir = join(homedir(), '.clade', 'skills');
      const pendingPath = join(skillsDir, 'pending', name);
      const activePath = join(skillsDir, 'active', name);

      if (!existsSync(pendingPath)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Skill "${name}" not found in pending/. Available pending skills can be listed with admin_skill_search_local.`,
          }],
          isError: true,
        };
      }

      if (existsSync(activePath)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Skill "${name}" already exists in active/. Remove it first if you want to replace it.`,
          }],
          isError: true,
        };
      }

      // Ensure active directory exists
      const activeDir = join(skillsDir, 'active');
      if (!existsSync(activeDir)) {
        mkdirSync(activeDir, { recursive: true });
      }

      // Move from pending to active
      renameSync(pendingPath, activePath);

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Skill "${name}" approved and moved to active/. It is now available for use.`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error approving skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_reject
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_reject',
  'Reject a pending skill by removing it from pending/.',
  {
    name: z.string().describe('Skill name to reject'),
  },
  async ({ name }) => {
    try {
      const { rmSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');

      const pendingPath = join(homedir(), '.clade', 'skills', 'pending', name);

      if (!existsSync(pendingPath)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Skill "${name}" not found in pending/.`,
          }],
          isError: true,
        };
      }

      rmSync(pendingPath, { recursive: true });

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Skill "${name}" rejected and removed from pending/.`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error rejecting skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ===========================================================================
// SKILL CREATION TOOLS
// ===========================================================================

// ---------------------------------------------------------------------------
// Tool: admin_skill_create
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_create',
  'Create a new skill from scratch. Use this when no existing skill meets the need.',
  {
    name: z.string().describe('Skill name (lowercase, hyphens, max 64 chars)'),
    description: z.string().describe('What the skill does and when to use it (max 1024 chars)'),
    instructions: z.string().describe('Detailed instructions for the skill'),
    allowedTools: z.string().optional().describe('Space-separated list of allowed tools'),
    license: z.string().optional().describe('License for the skill'),
  },
  async ({ name, description, instructions, allowedTools, license }) => {
    try {
      // Validate and fix name if needed
      const validation = validateSkillName(name);
      const finalName = validation.valid ? name : toValidSkillName(name);

      const result = createSkill({
        name: finalName,
        description,
        instructions,
        allowedTools,
        license,
      });

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to create skill: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✅ Skill created successfully!`,
            '',
            `**Name:** ${result.skill!.name}`,
            `**Description:** ${result.skill!.description}`,
            `**Path:** ${result.skill!.path}`,
            '',
            'The skill is now available for use.',
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error creating skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_create_with_scripts
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_create_with_scripts',
  'Create a skill with helper scripts.',
  {
    name: z.string().describe('Skill name'),
    description: z.string().describe('Skill description'),
    instructions: z.string().describe('Skill instructions'),
    scripts: z.array(z.object({
      filename: z.string().describe('Script filename'),
      content: z.string().describe('Script content'),
      language: z.string().describe('Script language (python, bash, javascript)'),
    })).describe('Helper scripts to include'),
    allowedTools: z.string().optional().describe('Allowed tools'),
  },
  async ({ name, description, instructions, scripts, allowedTools }) => {
    try {
      const validation = validateSkillName(name);
      const finalName = validation.valid ? name : toValidSkillName(name);

      const result = createSkill({
        name: finalName,
        description,
        instructions,
        scripts,
        allowedTools,
      });

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to create skill: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✅ Skill with scripts created!`,
            '',
            `**Name:** ${result.skill!.name}`,
            `**Scripts:** ${scripts.map((s) => s.filename).join(', ')}`,
            `**Path:** ${result.skill!.path}`,
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error creating skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_create_from_template
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_create_from_template',
  'Create a skill from a predefined template.',
  {
    template: z.string().describe(`Template name: ${SKILL_TEMPLATES.map((t) => t.name).join(', ')}`),
    name: z.string().optional().describe('Override skill name'),
    description: z.string().optional().describe('Override description'),
  },
  async ({ template, name, description }) => {
    try {
      const result = createFromTemplate(template, name, description);

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to create from template: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✅ Skill created from template!`,
            '',
            `**Name:** ${result.skill!.name}`,
            `**Template:** ${template}`,
            `**Path:** ${result.skill!.path}`,
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error creating from template: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_list_templates
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_list_templates',
  'List available skill templates.',
  {},
  async () => {
    const lines = [
      '## Available Skill Templates',
      '',
      ...SKILL_TEMPLATES.map((t) =>
        `### ${t.name}\n- **Category:** ${t.category}\n- **Description:** ${t.description}\n- **Suggested Tools:** ${t.suggestedTools ?? 'None'}`,
      ),
    ];

    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_skill_update
// ---------------------------------------------------------------------------

server.tool(
  'admin_skill_update',
  'Update an existing skill.',
  {
    name: z.string().describe('Skill name to update'),
    instructions: z.string().optional().describe('New instructions'),
    description: z.string().optional().describe('New description'),
    allowedTools: z.string().optional().describe('New allowed tools'),
  },
  async ({ name, instructions, description, allowedTools }) => {
    try {
      const result = updateSkill(name, { instructions, description, allowedTools });

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to update skill: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Skill "${name}" updated successfully.`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error updating skill: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ===========================================================================
// MCP SERVER MANAGEMENT TOOLS
// ===========================================================================

// ---------------------------------------------------------------------------
// Tool: admin_mcp_list
// ---------------------------------------------------------------------------

server.tool(
  'admin_mcp_list',
  'List configured MCP servers.',
  {},
  async () => {
    try {
      const servers = listMcpServers();

      if (servers.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No MCP servers configured.',
          }],
        };
      }

      const lines = [
        '## Configured MCP Servers',
        '',
        ...servers.map((s) =>
          `### ${s.name}\n- **Command:** \`${s.command} ${s.args.join(' ')}\``,
        ),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error listing MCP servers: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_mcp_install
// ---------------------------------------------------------------------------

server.tool(
  'admin_mcp_install',
  'Install and configure an MCP server.',
  {
    name: z.string().describe('Server name'),
    command: z.string().describe('Command to run (e.g., "npx")'),
    args: z.array(z.string()).describe('Command arguments'),
    env: z.record(z.string()).optional().describe('Environment variables'),
  },
  async ({ name, command, args, env }) => {
    try {
      const result = installMcpServer({ name, command, args, env });

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to install MCP server: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✅ MCP server "${name}" installed!`,
            '',
            `**Command:** \`${command} ${args.join(' ')}\``,
            '',
            'Restart Claude Code to activate the new MCP server.',
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error installing MCP server: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_mcp_remove
// ---------------------------------------------------------------------------

server.tool(
  'admin_mcp_remove',
  'Remove an MCP server configuration.',
  {
    name: z.string().describe('Server name to remove'),
  },
  async ({ name }) => {
    try {
      const result = removeMcpServer(name);

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to remove MCP server: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ MCP server "${name}" removed.`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error removing MCP server: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_mcp_search_npm
// ---------------------------------------------------------------------------

server.tool(
  'admin_mcp_search_npm',
  'Search npm for MCP server packages.',
  {
    query: z.string().describe('Search query'),
  },
  async ({ query }) => {
    try {
      const searchQuery = `${query} mcp server`;
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(searchQuery)}&size=10`;

      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return {
          content: [{
            type: 'text' as const,
            text: `NPM search failed: ${response.status}`,
          }],
          isError: true,
        };
      }

      const data = (await response.json()) as {
        objects: Array<{
          package: {
            name: string;
            description?: string;
            version: string;
          };
        }>;
      };

      if (data.objects.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No MCP servers found for "${query}".`,
          }],
        };
      }

      const lines = [
        '## MCP Servers on NPM',
        '',
        ...data.objects.map((obj) =>
          `- **${obj.package.name}** (v${obj.package.version})\n  ${obj.package.description ?? 'No description'}`,
        ),
        '',
        'Install with: `admin_mcp_install` using `npx` command.',
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching npm: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ===========================================================================
// CLADE AGENT MANAGEMENT TOOLS
// ===========================================================================

// ---------------------------------------------------------------------------
// Tool: admin_agent_list
// ---------------------------------------------------------------------------

server.tool(
  'admin_agent_list',
  'List all Clade agents.',
  {},
  async () => {
    try {
      if (!existsSync(CONFIG_PATH)) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No Clade configuration found.',
          }],
        };
      }

      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as {
        agents?: Record<string, { name: string; description?: string; toolPreset?: string }>;
      };

      const agents = config.agents ?? {};
      const agentList = Object.entries(agents);

      if (agentList.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No agents configured.',
          }],
        };
      }

      const lines = [
        '## Clade Agents',
        '',
        ...agentList.map(([id, agent]) =>
          `### ${id}\n- **Name:** ${agent.name}\n- **Description:** ${agent.description ?? 'None'}\n- **Tool Preset:** ${agent.toolPreset ?? 'full'}`,
        ),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error listing agents: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_agent_assign_mcp
// ---------------------------------------------------------------------------

server.tool(
  'admin_agent_assign_mcp',
  'Assign an MCP server to a Clade agent.',
  {
    agentId: z.string().describe('Agent ID'),
    mcpServer: z.string().describe('MCP server name to assign'),
  },
  async ({ agentId, mcpServer }) => {
    try {
      if (!existsSync(CONFIG_PATH)) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No Clade configuration found.',
          }],
          isError: true,
        };
      }

      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as {
        agents?: Record<string, { mcp?: string[] }>;
      };

      if (!config.agents?.[agentId]) {
        return {
          content: [{
            type: 'text' as const,
            text: `Agent "${agentId}" not found.`,
          }],
          isError: true,
        };
      }

      config.agents[agentId].mcp = config.agents[agentId].mcp ?? [];
      if (!config.agents[agentId].mcp!.includes(mcpServer)) {
        config.agents[agentId].mcp!.push(mcpServer);
      }

      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

      return {
        content: [{
          type: 'text' as const,
          text: `✅ MCP server "${mcpServer}" assigned to agent "${agentId}".`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error assigning MCP server: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ===========================================================================
// PLUGIN MANAGEMENT TOOLS
// ===========================================================================

// ---------------------------------------------------------------------------
// Tool: admin_plugin_list
// ---------------------------------------------------------------------------

server.tool(
  'admin_plugin_list',
  'List installed Claude Code plugins.',
  {},
  async () => {
    try {
      // Check for plugins in various locations
      const pluginLocations = [
        join(CLAUDE_HOME, 'plugins'),
        join(process.cwd(), '.claude-plugins'),
      ];

      const plugins: Array<{ name: string; path: string; description?: string }> = [];

      for (const location of pluginLocations) {
        if (existsSync(location)) {
          const entries = readdirSync(location, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const manifestPath = join(location, entry.name, '.claude-plugin', 'plugin.json');
              if (existsSync(manifestPath)) {
                try {
                  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
                    name: string;
                    description?: string;
                  };
                  plugins.push({
                    name: manifest.name,
                    path: join(location, entry.name),
                    description: manifest.description,
                  });
                } catch {
                  plugins.push({
                    name: entry.name,
                    path: join(location, entry.name),
                  });
                }
              }
            }
          }
        }
      }

      if (plugins.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No plugins installed.',
          }],
        };
      }

      const lines = [
        '## Installed Plugins',
        '',
        ...plugins.map((p) =>
          `- **${p.name}**\n  ${p.description ?? 'No description'}\n  Path: \`${p.path}\``,
        ),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error listing plugins: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: admin_plugin_install_github
// ---------------------------------------------------------------------------

server.tool(
  'admin_plugin_install_github',
  'Install a Claude Code plugin from GitHub.',
  {
    repo: z.string().describe('GitHub repo (e.g., "user/plugin-name")'),
    branch: z.string().optional().default('main').describe('Branch to clone'),
  },
  async ({ repo, branch }) => {
    try {
      const pluginsDir = join(CLAUDE_HOME, 'plugins');
      mkdirSync(pluginsDir, { recursive: true });

      const pluginName = repo.split('/').pop() ?? repo;
      const targetDir = join(pluginsDir, pluginName);

      // Clone the repository
      const cloneCmd = `git clone --depth 1 -b ${branch} https://github.com/${repo}.git ${targetDir}`;
      execSync(cloneCmd, { timeout: 120_000, stdio: 'pipe' });

      // Verify it's a valid plugin
      const manifestPath = join(targetDir, '.claude-plugin', 'plugin.json');
      if (!existsSync(manifestPath)) {
        // Clean up
        execSync(`rm -rf ${targetDir}`);
        return {
          content: [{
            type: 'text' as const,
            text: 'Repository is not a valid Claude Code plugin (missing .claude-plugin/plugin.json).',
          }],
          isError: true,
        };
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        name: string;
        description?: string;
      };

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✅ Plugin installed!`,
            '',
            `**Name:** ${manifest.name}`,
            `**Description:** ${manifest.description ?? 'None'}`,
            `**Path:** ${targetDir}`,
            '',
            'Restart Claude Code to activate the plugin.',
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error installing plugin: ${err instanceof Error ? err.message : String(err)}`,
        }],
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

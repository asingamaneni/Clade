// ---------------------------------------------------------------------------
// Skill Installer - Install skills from various sources
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { AgentSkill, SkillSource, McpServerConfig } from './types.js';
import { parseSkillMd } from './discovery.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CLAUDE_HOME = join(homedir(), '.claude');
const SKILLS_DIR = join(CLAUDE_HOME, 'skills');
const CLADE_HOME = process.env['CLADE_HOME'] ?? join(homedir(), '.clade');
const MCP_CONFIG_PATH = join(CLAUDE_HOME, '.mcp.json');

// Ensure directories exist
mkdirSync(SKILLS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeExec(
  command: string,
  options: { timeout?: number; cwd?: string } = {},
): string | null {
  try {
    return execSync(command, {
      timeout: options.timeout ?? 60_000,
      encoding: 'utf-8',
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Generate a valid skill name from a string
 */
function toSkillName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

// ---------------------------------------------------------------------------
// Install from GitHub
// ---------------------------------------------------------------------------

export interface GitHubInstallOptions {
  repo: string;           // e.g., "anthropics/skills"
  skillPath?: string;     // e.g., "skills/code-review"
  branch?: string;        // e.g., "main"
  targetName?: string;    // Override skill name
}

/**
 * Install a skill from a GitHub repository
 */
export async function installFromGitHub(
  options: GitHubInstallOptions,
): Promise<{ success: boolean; skill?: AgentSkill; error?: string }> {
  const { repo, skillPath, branch = 'main', targetName } = options;

  try {
    const tempDir = join(tmpdir(), `skill-install-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Clone the repository (sparse checkout if skillPath provided)
    if (skillPath) {
      // Use sparse checkout for efficiency
      safeExec(`git clone --depth 1 --filter=blob:none --sparse https://github.com/${repo}.git ${tempDir}`, { timeout: 120_000 });
      safeExec(`git sparse-checkout set ${skillPath}`, { cwd: tempDir });
    } else {
      safeExec(`git clone --depth 1 -b ${branch} https://github.com/${repo}.git ${tempDir}`, { timeout: 120_000 });
    }

    // Find SKILL.md
    let skillDir: string;
    if (skillPath) {
      skillDir = join(tempDir, skillPath);
    } else {
      // Look for SKILL.md in root or common locations
      if (existsSync(join(tempDir, 'SKILL.md'))) {
        skillDir = tempDir;
      } else if (existsSync(join(tempDir, 'skills'))) {
        // Use first skill found
        const entries = require('node:fs').readdirSync(join(tempDir, 'skills'), { withFileTypes: true });
        const firstSkill = entries.find((e: { isDirectory: () => boolean }) => e.isDirectory());
        if (firstSkill) {
          skillDir = join(tempDir, 'skills', firstSkill.name);
        } else {
          return { success: false, error: 'No skills found in repository' };
        }
      } else {
        return { success: false, error: 'No SKILL.md found in repository' };
      }
    }

    if (!existsSync(join(skillDir, 'SKILL.md'))) {
      return { success: false, error: 'SKILL.md not found at specified path' };
    }

    // Parse skill
    const skillMdContent = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
    const skillData = parseSkillMd(skillMdContent);
    const skillName = targetName ?? skillData.name ?? toSkillName(basename(skillDir));

    // Copy to skills directory
    const destDir = join(SKILLS_DIR, skillName);
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true });
    }
    cpSync(skillDir, destDir, { recursive: true });

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });

    // Create source metadata
    const sourceFile = join(destDir, '.source.json');
    const source: SkillSource = {
      type: 'github',
      repo,
      url: `https://github.com/${repo}`,
      installedAt: new Date().toISOString(),
    };
    writeFileSync(sourceFile, JSON.stringify(source, null, 2));

    const skill: AgentSkill = {
      name: skillName,
      description: skillData.description ?? '',
      license: skillData.license,
      compatibility: skillData.compatibility,
      allowedTools: skillData.allowedTools,
      metadata: skillData.metadata,
      path: destDir,
      source,
    };

    return { success: true, skill };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Install from URL
// ---------------------------------------------------------------------------

export interface UrlInstallOptions {
  url: string;            // Direct URL to SKILL.md or skill directory
  targetName?: string;    // Override skill name
}

/**
 * Install a skill from a URL (raw GitHub, Gist, etc.)
 */
export async function installFromUrl(
  options: UrlInstallOptions,
): Promise<{ success: boolean; skill?: AgentSkill; error?: string }> {
  const { url, targetName } = options;

  try {
    // Handle different URL types
    let skillMdContent: string;
    let additionalFiles: Map<string, string> = new Map();

    if (url.includes('gist.github.com') || url.includes('gist.githubusercontent.com')) {
      // GitHub Gist
      const gistContent = await fetchGist(url);
      if (!gistContent) {
        return { success: false, error: 'Failed to fetch Gist' };
      }
      skillMdContent = gistContent.skillMd;
      additionalFiles = gistContent.files;
    } else if (url.includes('raw.githubusercontent.com') || url.endsWith('.md')) {
      // Direct file URL
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        return { success: false, error: `Failed to fetch: ${response.status}` };
      }
      skillMdContent = await response.text();
    } else if (url.includes('github.com')) {
      // Convert GitHub URL to raw URL
      const rawUrl = url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
      const response = await fetch(rawUrl, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        return { success: false, error: `Failed to fetch: ${response.status}` };
      }
      skillMdContent = await response.text();
    } else {
      // Generic URL
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        return { success: false, error: `Failed to fetch: ${response.status}` };
      }
      skillMdContent = await response.text();
    }

    // Parse skill
    const skillData = parseSkillMd(skillMdContent);
    const skillName = targetName ?? skillData.name ?? toSkillName(new URL(url).pathname.split('/').pop() ?? 'skill');

    // Create skill directory
    const destDir = join(SKILLS_DIR, skillName);
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true });
    }
    mkdirSync(destDir, { recursive: true });

    // Write SKILL.md
    writeFileSync(join(destDir, 'SKILL.md'), skillMdContent);

    // Write additional files (from Gist)
    for (const [filename, content] of additionalFiles) {
      if (filename !== 'SKILL.md') {
        const filePath = join(destDir, filename);
        const fileDir = join(destDir, ...filename.split('/').slice(0, -1));
        mkdirSync(fileDir, { recursive: true });
        writeFileSync(filePath, content);
      }
    }

    // Create source metadata
    const source: SkillSource = {
      type: 'url',
      url,
      installedAt: new Date().toISOString(),
    };
    writeFileSync(join(destDir, '.source.json'), JSON.stringify(source, null, 2));

    const skill: AgentSkill = {
      name: skillName,
      description: skillData.description ?? '',
      license: skillData.license,
      compatibility: skillData.compatibility,
      allowedTools: skillData.allowedTools,
      metadata: skillData.metadata,
      path: destDir,
      source,
    };

    return { success: true, skill };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Install from Gist
// ---------------------------------------------------------------------------

interface GistContent {
  skillMd: string;
  files: Map<string, string>;
}

async function fetchGist(url: string): Promise<GistContent | null> {
  try {
    // Extract Gist ID
    const match = url.match(/gist\.github(?:usercontent)?\.com\/[^\/]+\/([a-f0-9]+)/);
    if (!match) return null;

    const gistId = match[1];
    const apiUrl = `https://api.github.com/gists/${gistId}`;

    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'clade-admin-mcp',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;

    const gist = (await response.json()) as {
      files: Record<string, { filename: string; content: string }>;
    };

    const files = new Map<string, string>();
    let skillMd = '';

    for (const [filename, file] of Object.entries(gist.files)) {
      files.set(filename, file.content);
      if (filename.toUpperCase() === 'SKILL.MD') {
        skillMd = file.content;
      }
    }

    if (!skillMd) return null;

    return { skillMd, files };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Install from NPM
// ---------------------------------------------------------------------------

export interface NpmInstallOptions {
  package: string;        // npm package name
  targetName?: string;    // Override skill name
}

/**
 * Install a skill from an npm package
 */
export async function installFromNpm(
  options: NpmInstallOptions,
): Promise<{ success: boolean; skill?: AgentSkill; error?: string }> {
  const { package: pkgName, targetName } = options;

  try {
    const tempDir = join(tmpdir(), `skill-npm-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Install package
    const result = safeExec(`npm pack ${pkgName} --pack-destination ${tempDir}`, { timeout: 60_000 });
    if (!result) {
      return { success: false, error: 'Failed to download npm package' };
    }

    // Extract package
    const tgzFile = result.trim();
    safeExec(`tar -xzf ${tgzFile}`, { cwd: tempDir });

    // Look for SKILL.md
    const packageDir = join(tempDir, 'package');
    let skillDir = packageDir;

    if (!existsSync(join(skillDir, 'SKILL.md'))) {
      // Check in skills subdirectory
      if (existsSync(join(packageDir, 'skills'))) {
        const entries = require('node:fs').readdirSync(join(packageDir, 'skills'), { withFileTypes: true });
        const firstSkill = entries.find((e: { isDirectory: () => boolean }) => e.isDirectory());
        if (firstSkill) {
          skillDir = join(packageDir, 'skills', firstSkill.name);
        }
      }
    }

    if (!existsSync(join(skillDir, 'SKILL.md'))) {
      rmSync(tempDir, { recursive: true, force: true });
      return { success: false, error: 'No SKILL.md found in npm package' };
    }

    // Parse and install
    const skillMdContent = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
    const skillData = parseSkillMd(skillMdContent);
    const skillName = targetName ?? skillData.name ?? toSkillName(pkgName);

    const destDir = join(SKILLS_DIR, skillName);
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true });
    }
    cpSync(skillDir, destDir, { recursive: true });

    // Clean up
    rmSync(tempDir, { recursive: true, force: true });

    // Create source metadata
    const source: SkillSource = {
      type: 'npm',
      url: `https://www.npmjs.com/package/${pkgName}`,
      installedAt: new Date().toISOString(),
    };
    writeFileSync(join(destDir, '.source.json'), JSON.stringify(source, null, 2));

    const skill: AgentSkill = {
      name: skillName,
      description: skillData.description ?? '',
      license: skillData.license,
      path: destDir,
      source,
    };

    return { success: true, skill };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Remove Skill
// ---------------------------------------------------------------------------

/**
 * Remove an installed skill
 */
export function removeSkill(name: string): { success: boolean; error?: string } {
  const skillDir = join(SKILLS_DIR, name);

  if (!existsSync(skillDir)) {
    return { success: false, error: `Skill "${name}" not found` };
  }

  try {
    rmSync(skillDir, { recursive: true });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// MCP Server Management
// ---------------------------------------------------------------------------

interface McpConfig {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * Load MCP configuration
 */
function loadMcpConfig(): McpConfig {
  if (!existsSync(MCP_CONFIG_PATH)) {
    return { mcpServers: {} };
  }
  try {
    return JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8')) as McpConfig;
  } catch {
    return { mcpServers: {} };
  }
}

/**
 * Save MCP configuration
 */
function saveMcpConfig(config: McpConfig): void {
  mkdirSync(CLAUDE_HOME, { recursive: true });
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Install an MCP server
 */
export function installMcpServer(
  server: McpServerConfig,
): { success: boolean; error?: string } {
  try {
    const config = loadMcpConfig();
    config.mcpServers = config.mcpServers ?? {};

    config.mcpServers[server.name] = {
      command: server.command,
      args: server.args,
      env: server.env,
    };

    saveMcpConfig(config);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove an MCP server
 */
export function removeMcpServer(name: string): { success: boolean; error?: string } {
  try {
    const config = loadMcpConfig();

    if (!config.mcpServers?.[name]) {
      return { success: false, error: `MCP server "${name}" not found` };
    }

    delete config.mcpServers[name];
    saveMcpConfig(config);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * List installed MCP servers
 */
export function listMcpServers(): McpServerConfig[] {
  const config = loadMcpConfig();
  const servers: McpServerConfig[] = [];

  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    servers.push({
      name,
      command: server.command,
      args: server.args ?? [],
      env: server.env,
    });
  }

  return servers;
}

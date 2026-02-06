import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import type { Command } from 'commander';

const CLADE_HOME = join(homedir(), '.clade');
const MCP_DIR = join(CLADE_HOME, 'mcp');
const ACTIVE_DIR = join(MCP_DIR, 'active');
const PENDING_DIR = join(MCP_DIR, 'pending');
const CONFIG_PATH = join(CLADE_HOME, 'config.json');

interface McpServerConfig {
  name: string;
  description?: string;
  package?: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  status: 'active' | 'pending' | 'disabled';
  installedAt?: string;
  approvedAt?: string;
}

export function registerMcpCommand(program: Command): void {
  const mcp = program.command('mcp').description('Manage MCP servers');

  mcp
    .command('list')
    .alias('ls')
    .description('List all MCP servers')
    .option('--json', 'Output as JSON')
    .option('--pending', 'Show only pending MCP servers')
    .option('--active', 'Show only active MCP servers')
    .action(
      async (opts: {
        json?: boolean;
        pending?: boolean;
        active?: boolean;
      }) => {
        try {
          await listMcpServers(opts);
        } catch (err: unknown) {
          console.error(
            'Error:',
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );

  mcp
    .command('add')
    .description('Add a new MCP server from an npm package or local path')
    .argument('<package>', 'npm package name or local path')
    .option('-n, --name <name>', 'MCP server name (defaults to package name)')
    .option('--approve', 'Auto-approve the MCP server (skip pending)')
    .action(
      async (
        pkg: string,
        opts: { name?: string; approve?: boolean },
      ) => {
        try {
          await addMcpServer(pkg, opts);
        } catch (err: unknown) {
          console.error(
            'Error:',
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );

  mcp
    .command('remove')
    .alias('rm')
    .description('Remove an MCP server')
    .argument('<name>', 'MCP server name to remove')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name: string, opts: { force?: boolean }) => {
      try {
        await removeMcpServer(name, opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });

  mcp
    .command('approve')
    .description('Approve a pending MCP server')
    .argument('<name>', 'MCP server name to approve')
    .action(async (name: string) => {
      try {
        await approveMcpServer(name);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function listMcpServers(opts: {
  json?: boolean;
  pending?: boolean;
  active?: boolean;
}): Promise<void> {
  ensureMcpDirs();

  const activeServers = loadMcpFromDir(ACTIVE_DIR, 'active');
  const pendingServers = loadMcpFromDir(PENDING_DIR, 'pending');

  let servers: McpServerConfig[] = [];
  if (opts.active) {
    servers = activeServers;
  } else if (opts.pending) {
    servers = pendingServers;
  } else {
    servers = [...activeServers, ...pendingServers];
  }

  if (opts.json) {
    console.log(JSON.stringify(servers, null, 2));
    return;
  }

  if (servers.length === 0) {
    console.log(
      'No MCP servers installed. Run "clade mcp add <package>" to add one.',
    );
    return;
  }

  console.log(`\n  MCP Servers (${servers.length})\n`);

  for (const s of servers) {
    const statusTag =
      s.status === 'active' ? '[active]' : '[pending]';
    console.log(`  ${statusTag} ${s.name}`);
    if (s.description) {
      console.log(`          ${s.description}`);
    }
    if (s.package) {
      console.log(`          Package: ${s.package}`);
    }
    console.log(`          Command: ${s.command} ${s.args.join(' ')}`);
    console.log('');
  }
}

async function addMcpServer(
  pkg: string,
  opts: { name?: string; approve?: boolean },
): Promise<void> {
  ensureMcpDirs();

  const mcpName = opts.name ?? deriveMcpName(pkg);

  // Validate name
  if (!/^[a-z0-9_-]+$/.test(mcpName)) {
    throw new Error(
      'MCP server name must contain only lowercase letters, numbers, hyphens, and underscores.',
    );
  }

  // Check for duplicates
  if (
    existsSync(join(ACTIVE_DIR, `${mcpName}.json`)) ||
    existsSync(join(PENDING_DIR, `${mcpName}.json`))
  ) {
    throw new Error(
      `MCP server "${mcpName}" already exists. Remove it first or use a different name.`,
    );
  }

  console.log(`Installing MCP server "${mcpName}" from ${pkg}...`);

  // Determine if it's a local path or npm package
  let command: string;
  let args: string[];
  let description = '';

  if (existsSync(pkg)) {
    // Local path -- use node to run it directly
    command = 'node';
    args = [pkg];
    description = `Local MCP server at ${pkg}`;
  } else {
    // npm package -- install via npx
    try {
      // Verify the package exists by checking npm info
      const info = execSync(`npm info ${pkg} --json 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 30_000,
      });
      const pkgInfo = JSON.parse(info) as Record<string, unknown>;
      description =
        typeof pkgInfo.description === 'string'
          ? pkgInfo.description
          : `MCP server from ${pkg}`;
    } catch {
      // Package info lookup failed -- still allow installation
      description = `MCP server from ${pkg}`;
    }

    command = 'npx';
    args = ['-y', pkg];
  }

  const mcpConfig: McpServerConfig = {
    name: mcpName,
    description,
    package: pkg,
    command,
    args,
    status: opts.approve ? 'active' : 'pending',
    installedAt: new Date().toISOString(),
  };

  if (opts.approve) {
    mcpConfig.approvedAt = new Date().toISOString();
  }

  // Write to appropriate directory
  const targetDir = opts.approve ? ACTIVE_DIR : PENDING_DIR;
  const configPath = join(targetDir, `${mcpName}.json`);
  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');

  if (opts.approve) {
    console.log(`\nMCP server "${mcpName}" installed and activated.`);
  } else {
    console.log(
      `\nMCP server "${mcpName}" installed and pending approval.`,
    );
    console.log(
      `Run "clade mcp approve ${mcpName}" to activate it.\n`,
    );
  }
}

async function removeMcpServer(
  name: string,
  opts: { force?: boolean },
): Promise<void> {
  ensureMcpDirs();

  const activePath = join(ACTIVE_DIR, `${name}.json`);
  const pendingPath = join(PENDING_DIR, `${name}.json`);

  if (!existsSync(activePath) && !existsSync(pendingPath)) {
    throw new Error(`MCP server "${name}" not found.`);
  }

  if (!opts.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Remove MCP server "${name}"?`,
        default: false,
      },
    ]);
    if (!confirm) {
      console.log('Cancelled.');
      return;
    }
  }

  // Remove from both directories
  if (existsSync(activePath)) {
    rmSync(activePath);
  }
  if (existsSync(pendingPath)) {
    rmSync(pendingPath);
  }

  // Remove from agent MCP lists in config
  const config = loadConfig();
  const agents = (config.agents ?? {}) as Record<
    string,
    { mcp?: string[] }
  >;
  for (const agentId of Object.keys(agents)) {
    const agent = agents[agentId];
    if (agent?.mcp) {
      agent.mcp = agent.mcp.filter((s) => s !== name);
    }
  }
  saveConfig(config);

  console.log(`MCP server "${name}" removed.`);
}

async function approveMcpServer(name: string): Promise<void> {
  ensureMcpDirs();

  const pendingPath = join(PENDING_DIR, `${name}.json`);
  const activePath = join(ACTIVE_DIR, `${name}.json`);

  if (existsSync(activePath)) {
    console.log(`MCP server "${name}" is already active.`);
    return;
  }

  if (!existsSync(pendingPath)) {
    throw new Error(
      `MCP server "${name}" not found in pending. Run "clade mcp list --pending" to see pending MCP servers.`,
    );
  }

  // Read pending config
  const raw = readFileSync(pendingPath, 'utf-8');
  const mcpConfig = JSON.parse(raw) as McpServerConfig;

  // Update status
  mcpConfig.status = 'active';
  mcpConfig.approvedAt = new Date().toISOString();

  // Write to active directory
  writeFileSync(activePath, JSON.stringify(mcpConfig, null, 2), 'utf-8');

  // Remove from pending
  rmSync(pendingPath);

  console.log(`MCP server "${name}" approved and activated.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureMcpDirs(): void {
  mkdirSync(ACTIVE_DIR, { recursive: true });
  mkdirSync(PENDING_DIR, { recursive: true });
}

function loadMcpFromDir(
  dir: string,
  status: 'active' | 'pending',
): McpServerConfig[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const servers: McpServerConfig[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const config = JSON.parse(raw) as McpServerConfig;
      config.status = status;
      servers.push(config);
    } catch {
      // Skip invalid configs
    }
  }

  return servers;
}

function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) {
    return { agents: {} };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { agents: {} };
  }
}

function saveConfig(config: Record<string, unknown>): void {
  mkdirSync(CLADE_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Derive an MCP server name from a package identifier.
 * e.g., "@anthropic/mcp-memory" -> "mcp-memory"
 *       "some-mcp-server" -> "some-mcp-server"
 *       "./path/to/server.js" -> "server"
 */
function deriveMcpName(pkg: string): string {
  // Handle scoped packages
  if (pkg.startsWith('@')) {
    const parts = pkg.split('/');
    const name = parts[1] ?? parts[0] ?? pkg;
    return name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  }

  // Handle local paths
  if (pkg.startsWith('.') || pkg.startsWith('/')) {
    const base = basename(pkg, '.js').replace(/[^a-z0-9_-]/gi, '-');
    return base.toLowerCase();
  }

  // Regular package name
  return pkg.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

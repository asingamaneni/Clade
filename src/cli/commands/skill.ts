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

const TEAMAGENTS_HOME = join(homedir(), '.teamagents');
const SKILLS_DIR = join(TEAMAGENTS_HOME, 'skills');
const ACTIVE_DIR = join(SKILLS_DIR, 'active');
const PENDING_DIR = join(SKILLS_DIR, 'pending');
const CONFIG_PATH = join(TEAMAGENTS_HOME, 'config.json');

interface SkillConfig {
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

export function registerSkillCommand(program: Command): void {
  const skill = program.command('skill').description('Manage MCP skills');

  skill
    .command('list')
    .alias('ls')
    .description('List all skills')
    .option('--json', 'Output as JSON')
    .option('--pending', 'Show only pending skills')
    .option('--active', 'Show only active skills')
    .action(
      async (opts: {
        json?: boolean;
        pending?: boolean;
        active?: boolean;
      }) => {
        try {
          await listSkills(opts);
        } catch (err: unknown) {
          console.error(
            'Error:',
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );

  skill
    .command('add')
    .description('Add a new skill from an npm package or local path')
    .argument('<package>', 'npm package name or local path')
    .option('-n, --name <name>', 'Skill name (defaults to package name)')
    .option('--approve', 'Auto-approve the skill (skip pending)')
    .action(
      async (
        pkg: string,
        opts: { name?: string; approve?: boolean },
      ) => {
        try {
          await addSkill(pkg, opts);
        } catch (err: unknown) {
          console.error(
            'Error:',
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );

  skill
    .command('remove')
    .alias('rm')
    .description('Remove a skill')
    .argument('<name>', 'Skill name to remove')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name: string, opts: { force?: boolean }) => {
      try {
        await removeSkill(name, opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });

  skill
    .command('approve')
    .description('Approve a pending skill')
    .argument('<name>', 'Skill name to approve')
    .action(async (name: string) => {
      try {
        await approveSkill(name);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function listSkills(opts: {
  json?: boolean;
  pending?: boolean;
  active?: boolean;
}): Promise<void> {
  ensureSkillDirs();

  const activeSkills = loadSkillsFromDir(ACTIVE_DIR, 'active');
  const pendingSkills = loadSkillsFromDir(PENDING_DIR, 'pending');

  let skills: SkillConfig[] = [];
  if (opts.active) {
    skills = activeSkills;
  } else if (opts.pending) {
    skills = pendingSkills;
  } else {
    skills = [...activeSkills, ...pendingSkills];
  }

  if (opts.json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  if (skills.length === 0) {
    console.log(
      'No skills installed. Run "teamagents skill add <package>" to add one.',
    );
    return;
  }

  console.log(`\n  Skills (${skills.length})\n`);

  for (const s of skills) {
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

async function addSkill(
  pkg: string,
  opts: { name?: string; approve?: boolean },
): Promise<void> {
  ensureSkillDirs();

  const skillName = opts.name ?? deriveSkillName(pkg);

  // Validate name
  if (!/^[a-z0-9_-]+$/.test(skillName)) {
    throw new Error(
      'Skill name must contain only lowercase letters, numbers, hyphens, and underscores.',
    );
  }

  // Check for duplicates
  if (
    existsSync(join(ACTIVE_DIR, `${skillName}.json`)) ||
    existsSync(join(PENDING_DIR, `${skillName}.json`))
  ) {
    throw new Error(
      `Skill "${skillName}" already exists. Remove it first or use a different name.`,
    );
  }

  console.log(`Installing skill "${skillName}" from ${pkg}...`);

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

  const skillConfig: SkillConfig = {
    name: skillName,
    description,
    package: pkg,
    command,
    args,
    status: opts.approve ? 'active' : 'pending',
    installedAt: new Date().toISOString(),
  };

  if (opts.approve) {
    skillConfig.approvedAt = new Date().toISOString();
  }

  // Write to appropriate directory
  const targetDir = opts.approve ? ACTIVE_DIR : PENDING_DIR;
  const configPath = join(targetDir, `${skillName}.json`);
  writeFileSync(configPath, JSON.stringify(skillConfig, null, 2), 'utf-8');

  if (opts.approve) {
    console.log(`\nSkill "${skillName}" installed and activated.`);
  } else {
    console.log(
      `\nSkill "${skillName}" installed and pending approval.`,
    );
    console.log(
      `Run "teamagents skill approve ${skillName}" to activate it.\n`,
    );
  }
}

async function removeSkill(
  name: string,
  opts: { force?: boolean },
): Promise<void> {
  ensureSkillDirs();

  const activePath = join(ACTIVE_DIR, `${name}.json`);
  const pendingPath = join(PENDING_DIR, `${name}.json`);

  if (!existsSync(activePath) && !existsSync(pendingPath)) {
    throw new Error(`Skill "${name}" not found.`);
  }

  if (!opts.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Remove skill "${name}"?`,
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

  // Remove from agent skills lists in config
  const config = loadConfig();
  const agents = (config.agents ?? {}) as Record<
    string,
    { skills?: string[] }
  >;
  for (const agentId of Object.keys(agents)) {
    const agent = agents[agentId];
    if (agent?.skills) {
      agent.skills = agent.skills.filter((s) => s !== name);
    }
  }
  saveConfig(config);

  console.log(`Skill "${name}" removed.`);
}

async function approveSkill(name: string): Promise<void> {
  ensureSkillDirs();

  const pendingPath = join(PENDING_DIR, `${name}.json`);
  const activePath = join(ACTIVE_DIR, `${name}.json`);

  if (existsSync(activePath)) {
    console.log(`Skill "${name}" is already active.`);
    return;
  }

  if (!existsSync(pendingPath)) {
    throw new Error(
      `Skill "${name}" not found in pending. Run "teamagents skill list --pending" to see pending skills.`,
    );
  }

  // Read pending config
  const raw = readFileSync(pendingPath, 'utf-8');
  const skillConfig = JSON.parse(raw) as SkillConfig;

  // Update status
  skillConfig.status = 'active';
  skillConfig.approvedAt = new Date().toISOString();

  // Write to active directory
  writeFileSync(activePath, JSON.stringify(skillConfig, null, 2), 'utf-8');

  // Remove from pending
  rmSync(pendingPath);

  console.log(`Skill "${name}" approved and activated.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureSkillDirs(): void {
  mkdirSync(ACTIVE_DIR, { recursive: true });
  mkdirSync(PENDING_DIR, { recursive: true });
}

function loadSkillsFromDir(
  dir: string,
  status: 'active' | 'pending',
): SkillConfig[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const skills: SkillConfig[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const config = JSON.parse(raw) as SkillConfig;
      config.status = status;
      skills.push(config);
    } catch {
      // Skip invalid configs
    }
  }

  return skills;
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
  mkdirSync(TEAMAGENTS_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Derive a skill name from a package identifier.
 * e.g., "@anthropic/mcp-memory" -> "mcp-memory"
 *       "some-mcp-server" -> "some-mcp-server"
 *       "./path/to/server.js" -> "server"
 */
function deriveSkillName(pkg: string): string {
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

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import inquirer from 'inquirer';
import type { Command } from 'commander';

const CLADE_HOME = join(homedir(), '.clade');
const SKILLS_DIR = join(CLADE_HOME, 'skills');
const ACTIVE_DIR = join(SKILLS_DIR, 'active');
const PENDING_DIR = join(SKILLS_DIR, 'pending');
const DISABLED_DIR = join(SKILLS_DIR, 'disabled');
const CONFIG_PATH = join(CLADE_HOME, 'config.json');

interface SkillInfo {
  name: string;
  description?: string;
  status: 'active' | 'pending' | 'disabled';
  path: string;
  installedAt?: string;
  approvedAt?: string;
}

export function registerSkillCommand(program: Command): void {
  const skill = program.command('skill').description('Manage skills (SKILL.md instruction files)');

  skill
    .command('list')
    .alias('ls')
    .description('List all skills')
    .option('--json', 'Output as JSON')
    .option('--pending', 'Show only pending skills')
    .option('--active', 'Show only active skills')
    .option('--disabled', 'Show only disabled skills')
    .action(
      async (opts: {
        json?: boolean;
        pending?: boolean;
        active?: boolean;
        disabled?: boolean;
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
    .description('Add a new skill')
    .argument('<name>', 'Skill name')
    .option('-d, --description <desc>', 'Skill description')
    .option('--approve', 'Auto-approve the skill (skip pending)')
    .action(
      async (
        name: string,
        opts: { description?: string; approve?: boolean },
      ) => {
        try {
          await addSkill(name, opts);
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
    .command('create')
    .description('Create a new SKILL.md skill from scratch')
    .argument('<name>', 'Skill name')
    .option('-d, --description <desc>', 'Skill description')
    .option('--approve', 'Auto-approve the skill (skip pending)')
    .action(
      async (
        name: string,
        opts: { description?: string; approve?: boolean },
      ) => {
        try {
          await createSkill(name, opts);
        } catch (err: unknown) {
          console.error(
            'Error:',
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );
}

async function listSkills(opts: {
  json?: boolean;
  pending?: boolean;
  active?: boolean;
  disabled?: boolean;
}): Promise<void> {
  ensureSkillDirs();

  const activeSkills = loadSkillsFromDir(ACTIVE_DIR, 'active');
  const pendingSkills = loadSkillsFromDir(PENDING_DIR, 'pending');
  const disabledSkills = loadSkillsFromDir(DISABLED_DIR, 'disabled');

  let skills: SkillInfo[] = [];
  if (opts.active) {
    skills = activeSkills;
  } else if (opts.pending) {
    skills = pendingSkills;
  } else if (opts.disabled) {
    skills = disabledSkills;
  } else {
    skills = [...activeSkills, ...pendingSkills, ...disabledSkills];
  }

  if (opts.json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  if (skills.length === 0) {
    console.log(
      'No skills installed. Run "clade skill add <name>" to add one.',
    );
    return;
  }

  console.log(`\n  Skills (${skills.length})\n`);

  for (const s of skills) {
    const statusTag =
      s.status === 'active'
        ? '[active]'
        : s.status === 'pending'
          ? '[pending]'
          : '[disabled]';
    console.log(`  ${statusTag} ${s.name}`);
    if (s.description) {
      console.log(`          ${s.description}`);
    }
    console.log(`          Path: ${s.path}`);
    console.log('');
  }
}

async function addSkill(
  name: string,
  opts: { description?: string; approve?: boolean },
): Promise<void> {
  ensureSkillDirs();

  // Validate name
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error(
      'Skill name must contain only lowercase letters, numbers, hyphens, and underscores.',
    );
  }

  // Check for duplicates across all directories
  if (
    existsSync(join(ACTIVE_DIR, name)) ||
    existsSync(join(PENDING_DIR, name)) ||
    existsSync(join(DISABLED_DIR, name))
  ) {
    throw new Error(
      `Skill "${name}" already exists. Remove it first or use a different name.`,
    );
  }

  const targetDir = opts.approve ? ACTIVE_DIR : PENDING_DIR;
  const skillDir = join(targetDir, name);
  mkdirSync(skillDir, { recursive: true });

  const description = opts.description ?? '';
  const skillContent = `# ${name}\n\n${description}\n\n<!-- Add your skill instructions below -->\n`;
  writeFileSync(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');

  if (opts.approve) {
    console.log(`\nSkill "${name}" added and activated.`);
  } else {
    console.log(`\nSkill "${name}" added and pending approval.`);
    console.log(`Run "clade skill approve ${name}" to activate it.\n`);
  }
}

async function approveSkill(name: string): Promise<void> {
  ensureSkillDirs();

  const activePath = join(ACTIVE_DIR, name);
  const pendingPath = join(PENDING_DIR, name);

  if (existsSync(activePath)) {
    console.log(`Skill "${name}" is already active.`);
    return;
  }

  if (!existsSync(pendingPath)) {
    throw new Error(
      `Skill "${name}" not found in pending. Run "clade skill list --pending" to see pending skills.`,
    );
  }

  // Move from pending to active
  const targetPath = join(ACTIVE_DIR, name);
  mkdirSync(targetPath, { recursive: true });

  const files = readdirSync(pendingPath);
  for (const file of files) {
    const content = readFileSync(join(pendingPath, file), 'utf-8');
    writeFileSync(join(targetPath, file), content, 'utf-8');
  }

  // Remove pending directory
  rmSync(pendingPath, { recursive: true });

  console.log(`Skill "${name}" approved and activated.`);
}

async function removeSkill(
  name: string,
  opts: { force?: boolean },
): Promise<void> {
  ensureSkillDirs();

  const activePath = join(ACTIVE_DIR, name);
  const pendingPath = join(PENDING_DIR, name);
  const disabledPath = join(DISABLED_DIR, name);

  if (
    !existsSync(activePath) &&
    !existsSync(pendingPath) &&
    !existsSync(disabledPath)
  ) {
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

  // Remove from all directories
  if (existsSync(activePath)) {
    rmSync(activePath, { recursive: true });
  }
  if (existsSync(pendingPath)) {
    rmSync(pendingPath, { recursive: true });
  }
  if (existsSync(disabledPath)) {
    rmSync(disabledPath, { recursive: true });
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

async function createSkill(
  name: string,
  opts: { description?: string; approve?: boolean },
): Promise<void> {
  ensureSkillDirs();

  // Validate name
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error(
      'Skill name must contain only lowercase letters, numbers, hyphens, and underscores.',
    );
  }

  // Check for duplicates
  if (
    existsSync(join(ACTIVE_DIR, name)) ||
    existsSync(join(PENDING_DIR, name)) ||
    existsSync(join(DISABLED_DIR, name))
  ) {
    throw new Error(
      `Skill "${name}" already exists. Remove it first or use a different name.`,
    );
  }

  const description = opts.description ?? '';

  // Prompt for content interactively
  const { content } = await inquirer.prompt<{ content: string }>([
    {
      type: 'editor',
      name: 'content',
      message: 'Write your SKILL.md content:',
      default: `# ${name}\n\n${description}\n\n## Instructions\n\n<!-- Add your skill instructions here -->\n`,
    },
  ]);

  const targetDir = opts.approve ? ACTIVE_DIR : PENDING_DIR;
  const skillDir = join(targetDir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');

  if (opts.approve) {
    console.log(`\nSkill "${name}" created and activated.`);
    console.log(`  Path: ${join(skillDir, 'SKILL.md')}`);
  } else {
    console.log(`\nSkill "${name}" created and pending approval.`);
    console.log(`  Path: ${join(skillDir, 'SKILL.md')}`);
    console.log(`Run "clade skill approve ${name}" to activate it.\n`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureSkillDirs(): void {
  mkdirSync(ACTIVE_DIR, { recursive: true });
  mkdirSync(PENDING_DIR, { recursive: true });
  mkdirSync(DISABLED_DIR, { recursive: true });
}

function loadSkillsFromDir(
  dir: string,
  status: 'active' | 'pending' | 'disabled',
): SkillInfo[] {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const skills: SkillInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillMdPath = join(dir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    // Extract description from the first non-empty, non-heading line
    let description = '';
    try {
      const content = readFileSync(skillMdPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--')) {
          description = trimmed;
          break;
        }
      }
    } catch {
      // Skip read errors
    }

    skills.push({
      name: entry.name,
      description,
      status,
      path: join(dir, entry.name),
    });
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
  mkdirSync(CLADE_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

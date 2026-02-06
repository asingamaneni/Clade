import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import inquirer from 'inquirer';
import type { Command } from 'commander';

const CLADE_HOME = join(homedir(), '.clade');
const AGENTS_DIR = join(CLADE_HOME, 'agents');
const CONFIG_PATH = join(CLADE_HOME, 'config.json');

const DEFAULT_SOUL_TEMPLATE = (name: string) => `# ${name}

You are ${name}, a Clade assistant.

## Personality
- Professional and helpful
- Concise and accurate
- Honest about limitations

## Guidelines
- Use tools when they help answer the question
- Remember context from previous conversations
- If a task is ambiguous, ask for clarification
`;

type ToolPreset = 'potato' | 'coding' | 'messaging' | 'full' | 'custom';

interface AgentConfigEntry {
  name: string;
  description?: string;
  model?: string;
  toolPreset: ToolPreset;
  customTools?: string[];
  mcp?: string[];
  heartbeat?: {
    enabled: boolean;
    interval: string;
    suppressOk: boolean;
  };
}

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage agents');

  agent
    .command('add')
    .description('Create a new agent')
    .argument('<name>', 'Agent name (lowercase, alphanumeric)')
    .option('-d, --description <desc>', 'Agent description')
    .option(
      '-m, --model <model>',
      'Model to use (e.g., sonnet, opus)',
      'sonnet',
    )
    .option(
      '-t, --tool-preset <preset>',
      'Tool preset (potato, coding, messaging, full, custom)',
      'full',
    )
    .option('--non-interactive', 'Skip interactive prompts')
    .action(
      async (
        name: string,
        opts: {
          description?: string;
          model?: string;
          toolPreset?: string;
          nonInteractive?: boolean;
        },
      ) => {
        try {
          await addAgent(name, opts);
        } catch (err: unknown) {
          console.error(
            'Error:',
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );

  agent
    .command('list')
    .alias('ls')
    .description('List all agents')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        await listAgents(opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });

  agent
    .command('remove')
    .alias('rm')
    .description('Remove an agent')
    .argument('<name>', 'Agent name to remove')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name: string, opts: { force?: boolean }) => {
      try {
        await removeAgent(name, opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });

  agent
    .command('edit')
    .description('Edit an agent configuration')
    .argument('<name>', 'Agent name to edit')
    .action(async (name: string) => {
      try {
        await editAgent(name);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes('User force closed')
        ) {
          console.log('\nEdit cancelled.');
          return;
        }
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function addAgent(
  name: string,
  opts: {
    description?: string;
    model?: string;
    toolPreset?: string;
    nonInteractive?: boolean;
  },
): Promise<void> {
  // Validate name
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error(
      'Agent name must contain only lowercase letters, numbers, hyphens, and underscores.',
    );
  }

  const agentDir = join(AGENTS_DIR, name);
  if (existsSync(agentDir)) {
    throw new Error(`Agent "${name}" already exists.`);
  }

  let description = opts.description ?? '';
  let model = opts.model ?? 'sonnet';
  let toolPreset: ToolPreset = validatePreset(opts.toolPreset ?? 'full');

  if (!opts.nonInteractive) {
    const answers = await inquirer.prompt<{
      description: string;
      model: string;
      toolPreset: string;
    }>([
      {
        type: 'input',
        name: 'description',
        message: 'Agent description:',
        default: description || `${name} agent`,
      },
      {
        type: 'list',
        name: 'model',
        message: 'Model:',
        choices: ['sonnet', 'opus', 'haiku'],
        default: model,
      },
      {
        type: 'list',
        name: 'toolPreset',
        message: 'Tool preset:',
        choices: [
          { name: 'full - All tools and MCP servers', value: 'full' },
          {
            name: 'coding - Read/Edit/Write/Bash + memory/sessions',
            value: 'coding',
          },
          {
            name: 'messaging - Memory/sessions/messaging MCP only',
            value: 'messaging',
          },
          { name: 'potato - No tools (chat only)', value: 'potato' },
          { name: 'custom - Specify tools manually', value: 'custom' },
        ],
        default: toolPreset,
      },
    ]);

    description = answers.description;
    model = answers.model;
    toolPreset = validatePreset(answers.toolPreset);
  }

  // Create agent directory
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, 'memory'), { recursive: true });

  // Create SOUL.md
  writeFileSync(
    join(agentDir, 'SOUL.md'),
    DEFAULT_SOUL_TEMPLATE(name),
    'utf-8',
  );

  // Create MEMORY.md
  writeFileSync(
    join(agentDir, 'MEMORY.md'),
    `# ${name} Memory\n\nCurated long-term memories.\n`,
    'utf-8',
  );

  // Create HEARTBEAT.md
  writeFileSync(
    join(agentDir, 'HEARTBEAT.md'),
    `# Heartbeat Checklist\n\nCheck the following on each heartbeat cycle:\n\n- [ ] Review pending items\n\nIf nothing needs attention, respond with: HEARTBEAT_OK\n`,
    'utf-8',
  );

  // Update config.json
  const config = loadConfig();
  const agents = (config.agents ?? {}) as Record<string, AgentConfigEntry>;
  agents[name] = {
    name: description || name,
    description,
    model,
    toolPreset,
    customTools: [],
    mcp: [],
    heartbeat: {
      enabled: false,
      interval: '30m',
      suppressOk: true,
    },
  };
  config.agents = agents;
  saveConfig(config);

  console.log(`\nAgent "${name}" created successfully.`);
  console.log(`  Directory: ${agentDir}`);
  console.log(`  Model: ${model}`);
  console.log(`  Tool preset: ${toolPreset}`);
  console.log(`\nEdit the SOUL.md to customize the agent's personality:`);
  console.log(`  ${join(agentDir, 'SOUL.md')}\n`);
}

async function listAgents(opts: { json?: boolean }): Promise<void> {
  const config = loadConfig();
  const agents = (config.agents ?? {}) as Record<string, AgentConfigEntry>;
  const agentIds = Object.keys(agents);

  if (agentIds.length === 0) {
    console.log('No agents configured. Run "clade agent add <name>" to create one.');
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  console.log(`\n  Agents (${agentIds.length})\n`);

  for (const id of agentIds) {
    const agent = agents[id];
    if (!agent) continue;

    const dirExists = existsSync(join(AGENTS_DIR, id));
    const hasSoul = existsSync(join(AGENTS_DIR, id, 'SOUL.md'));
    const statusIndicator = dirExists && hasSoul ? '[ok]' : '[!]';

    console.log(`  ${statusIndicator} ${id}`);
    console.log(`       Name: ${agent.name}`);
    if (agent.description) {
      console.log(`       Description: ${agent.description}`);
    }
    console.log(`       Model: ${agent.model ?? 'default'}`);
    console.log(`       Tools: ${agent.toolPreset}`);
    if (agent.mcp && agent.mcp.length > 0) {
      console.log(`       MCP Servers: ${agent.mcp.join(', ')}`);
    }
    if (agent.heartbeat?.enabled) {
      console.log(
        `       Heartbeat: every ${agent.heartbeat.interval}`,
      );
    }
    console.log('');
  }
}

async function removeAgent(
  name: string,
  opts: { force?: boolean },
): Promise<void> {
  const config = loadConfig();
  const agents = (config.agents ?? {}) as Record<string, AgentConfigEntry>;

  if (!agents[name]) {
    throw new Error(`Agent "${name}" not found in config.`);
  }

  if (!opts.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Remove agent "${name}"? This will delete its directory and all memory.`,
        default: false,
      },
    ]);
    if (!confirm) {
      console.log('Cancelled.');
      return;
    }
  }

  // Remove agent directory
  const agentDir = join(AGENTS_DIR, name);
  if (existsSync(agentDir)) {
    rmSync(agentDir, { recursive: true, force: true });
  }

  // Remove from config
  delete agents[name];
  config.agents = agents;

  // Update default agent if needed
  const routing = (config.routing ?? {}) as Record<string, unknown>;
  if (routing.defaultAgent === name) {
    const remainingAgents = Object.keys(agents);
    routing.defaultAgent = remainingAgents[0] ?? 'main';
    config.routing = routing;
  }

  saveConfig(config);

  console.log(`Agent "${name}" removed.`);
}

async function editAgent(name: string): Promise<void> {
  const config = loadConfig();
  const agents = (config.agents ?? {}) as Record<string, AgentConfigEntry>;
  const agent = agents[name];

  if (!agent) {
    throw new Error(
      `Agent "${name}" not found. Run "clade agent list" to see available agents.`,
    );
  }

  const answers = await inquirer.prompt<{
    description: string;
    model: string;
    toolPreset: string;
    heartbeatEnabled: boolean;
    heartbeatInterval: string;
  }>([
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      default: agent.description ?? '',
    },
    {
      type: 'list',
      name: 'model',
      message: 'Model:',
      choices: ['sonnet', 'opus', 'haiku'],
      default: agent.model ?? 'sonnet',
    },
    {
      type: 'list',
      name: 'toolPreset',
      message: 'Tool preset:',
      choices: [
        { name: 'full - All tools and MCP servers', value: 'full' },
        {
          name: 'coding - Read/Edit/Write/Bash + memory/sessions',
          value: 'coding',
        },
        {
          name: 'messaging - Memory/sessions/messaging MCP only',
          value: 'messaging',
        },
        { name: 'potato - No tools (chat only)', value: 'potato' },
        { name: 'custom - Specify tools manually', value: 'custom' },
      ],
      default: agent.toolPreset ?? 'full',
    },
    {
      type: 'confirm',
      name: 'heartbeatEnabled',
      message: 'Enable heartbeat?',
      default: agent.heartbeat?.enabled ?? false,
    },
    {
      type: 'list',
      name: 'heartbeatInterval',
      message: 'Heartbeat interval:',
      choices: ['15m', '30m', '1h', '4h', 'daily'],
      default: agent.heartbeat?.interval ?? '30m',
      when: (a: { heartbeatEnabled?: boolean }) =>
        a.heartbeatEnabled === true,
    },
  ]);

  agents[name] = {
    ...agent,
    description: answers.description,
    model: answers.model,
    toolPreset: validatePreset(answers.toolPreset),
    heartbeat: {
      enabled: answers.heartbeatEnabled,
      interval: answers.heartbeatInterval ?? agent.heartbeat?.interval ?? '30m',
      suppressOk: agent.heartbeat?.suppressOk ?? true,
    },
  };

  config.agents = agents;
  saveConfig(config);

  console.log(`\nAgent "${name}" updated.`);
  console.log(
    `Edit SOUL.md: ${join(AGENTS_DIR, name, 'SOUL.md')}\n`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function validatePreset(value: string): ToolPreset {
  const valid: ToolPreset[] = [
    'potato',
    'coding',
    'messaging',
    'full',
    'custom',
  ];
  if (valid.includes(value as ToolPreset)) {
    return value as ToolPreset;
  }
  return 'full';
}

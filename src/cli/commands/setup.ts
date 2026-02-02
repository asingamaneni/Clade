import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import type { Command } from 'commander';

const TEAMAGENTS_HOME = join(homedir(), '.teamagents');

const DEFAULT_SOUL = `# Main Assistant

You are the main TeamAgents assistant. You are helpful, concise, and accurate.

## Personality
- Professional and friendly
- Prefer concise answers unless asked for detail
- Always be honest about limitations

## Guidelines
- Use tools when they help answer the question
- Remember context from previous conversations via memory tools
- If a task is ambiguous, ask for clarification
`;

const DEFAULT_HEARTBEAT = `# Heartbeat Checklist

Check the following on each heartbeat cycle:

- [ ] Review any pending notifications
- [ ] Check for system health issues
- [ ] Report anything that needs attention

If nothing needs attention, respond with: HEARTBEAT_OK
`;

interface SetupAnswers {
  confirmSetup: boolean;
  createDefaultAgent: boolean;
  agentName: string;
  enableTelegram: boolean;
  telegramToken: string;
  enableSlack: boolean;
  slackBotToken: string;
  slackAppToken: string;
  enableDiscord: boolean;
  discordToken: string;
  gatewayPort: number;
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Interactive setup wizard for TeamAgents')
    .option('--non-interactive', 'Use defaults without prompting')
    .action(async (opts: { nonInteractive?: boolean }) => {
      try {
        await runSetup(opts.nonInteractive ?? false);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes('User force closed')
        ) {
          console.log('\nSetup cancelled.');
          process.exit(0);
        }
        console.error(
          'Setup failed:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function runSetup(nonInteractive: boolean): Promise<void> {
  console.log('\n  TeamAgents Setup Wizard\n');

  // Step 1: Check claude CLI
  console.log('Checking prerequisites...\n');
  const claudeInstalled = checkClaudeCli();
  if (!claudeInstalled) {
    console.error(
      'Error: claude CLI not found.\n' +
        'Install it from: https://docs.anthropic.com/en/docs/claude-cli\n',
    );
    process.exit(1);
  }
  console.log('  [ok] claude CLI found');

  // Check if claude is authenticated
  const claudeAuth = checkClaudeAuth();
  if (claudeAuth) {
    console.log('  [ok] claude CLI authenticated');
  } else {
    console.log(
      '  [warn] claude CLI may not be authenticated. Run "claude" to authenticate.',
    );
  }

  // Check if already set up
  const alreadySetup = existsSync(join(TEAMAGENTS_HOME, 'config.json'));
  if (alreadySetup && !nonInteractive) {
    const { confirmSetup } = await inquirer.prompt<
      Pick<SetupAnswers, 'confirmSetup'>
    >([
      {
        type: 'confirm',
        name: 'confirmSetup',
        message:
          'TeamAgents is already configured. Re-run setup? (existing config will be backed up)',
        default: false,
      },
    ]);
    if (!confirmSetup) {
      console.log('\nSetup cancelled.');
      return;
    }
    // Backup existing config
    const backupPath = join(
      TEAMAGENTS_HOME,
      `config.backup.${Date.now()}.json`,
    );
    const existing = readFileSync(
      join(TEAMAGENTS_HOME, 'config.json'),
      'utf-8',
    );
    writeFileSync(backupPath, existing, 'utf-8');
    console.log(`  Existing config backed up to: ${backupPath}`);
  }

  console.log('');

  // Step 2: Create directory structure
  createDirectoryStructure();
  console.log('  [ok] Created ~/.teamagents/ directory structure');

  // Step 3: Agent setup
  let agentName = 'main';
  if (!nonInteractive) {
    const agentAnswers = await inquirer.prompt<
      Pick<SetupAnswers, 'createDefaultAgent' | 'agentName'>
    >([
      {
        type: 'confirm',
        name: 'createDefaultAgent',
        message: 'Create a default "main" agent?',
        default: true,
      },
      {
        type: 'input',
        name: 'agentName',
        message: 'Agent name:',
        default: 'main',
        when: (answers: Partial<SetupAnswers>) =>
          answers.createDefaultAgent === true,
        validate: (input: string) =>
          /^[a-z0-9_-]+$/.test(input) ||
          'Use lowercase letters, numbers, hyphens, and underscores only',
      },
    ]);
    agentName = agentAnswers.agentName || 'main';
  }

  // Create default agent
  createAgent(agentName);
  console.log(`  [ok] Created agent "${agentName}" with SOUL.md`);

  // Step 4: Channel configuration
  let telegramToken = '';
  let slackBotToken = '';
  let slackAppToken = '';
  let discordToken = '';
  let gatewayPort = 7890;

  if (!nonInteractive) {
    const channelAnswers = await inquirer.prompt<
      Pick<
        SetupAnswers,
        | 'enableTelegram'
        | 'telegramToken'
        | 'enableSlack'
        | 'slackBotToken'
        | 'slackAppToken'
        | 'enableDiscord'
        | 'discordToken'
        | 'gatewayPort'
      >
    >([
      {
        type: 'confirm',
        name: 'enableTelegram',
        message: 'Enable Telegram channel?',
        default: false,
      },
      {
        type: 'input',
        name: 'telegramToken',
        message: 'Telegram Bot Token:',
        when: (answers: Partial<SetupAnswers>) =>
          answers.enableTelegram === true,
        validate: (input: string) =>
          input.trim().length > 0 || 'Token is required',
      },
      {
        type: 'confirm',
        name: 'enableSlack',
        message: 'Enable Slack channel?',
        default: false,
      },
      {
        type: 'input',
        name: 'slackBotToken',
        message: 'Slack Bot OAuth Token (xoxb-...):',
        when: (answers: Partial<SetupAnswers>) =>
          answers.enableSlack === true,
        validate: (input: string) =>
          input.trim().length > 0 || 'Token is required',
      },
      {
        type: 'input',
        name: 'slackAppToken',
        message: 'Slack App-level Token (xapp-...):',
        when: (answers: Partial<SetupAnswers>) =>
          answers.enableSlack === true,
        validate: (input: string) =>
          input.trim().length > 0 || 'Token is required',
      },
      {
        type: 'confirm',
        name: 'enableDiscord',
        message: 'Enable Discord channel?',
        default: false,
      },
      {
        type: 'input',
        name: 'discordToken',
        message: 'Discord Bot Token:',
        when: (answers: Partial<SetupAnswers>) =>
          answers.enableDiscord === true,
        validate: (input: string) =>
          input.trim().length > 0 || 'Token is required',
      },
      {
        type: 'number',
        name: 'gatewayPort',
        message: 'Gateway server port:',
        default: 7890,
        validate: (input: number) =>
          (input > 0 && input < 65536) || 'Port must be between 1 and 65535',
      },
    ]);

    telegramToken = channelAnswers.telegramToken || '';
    slackBotToken = channelAnswers.slackBotToken || '';
    slackAppToken = channelAnswers.slackAppToken || '';
    discordToken = channelAnswers.discordToken || '';
    gatewayPort = channelAnswers.gatewayPort || 7890;
  }

  // Step 5: Write config
  const config = buildConfig({
    agentName,
    telegramToken,
    slackBotToken,
    slackAppToken,
    discordToken,
    gatewayPort,
  });

  writeFileSync(
    join(TEAMAGENTS_HOME, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
  console.log('  [ok] Wrote config.json');

  // Step 6: Success message
  console.log('\n  Setup complete!\n');
  console.log('  Next steps:');
  console.log('    teamagents start       Start the gateway server');
  console.log(
    '    teamagents ask "hi"    Send a quick message to your agent',
  );
  console.log(
    '    teamagents doctor      Check that everything is working',
  );
  console.log('');
}

function checkClaudeCli(): boolean {
  try {
    execSync('which claude', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function checkClaudeAuth(): boolean {
  try {
    execSync('claude --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function createDirectoryStructure(): void {
  const dirs = [
    TEAMAGENTS_HOME,
    join(TEAMAGENTS_HOME, 'agents'),
    join(TEAMAGENTS_HOME, 'skills'),
    join(TEAMAGENTS_HOME, 'skills', 'active'),
    join(TEAMAGENTS_HOME, 'skills', 'pending'),
    join(TEAMAGENTS_HOME, 'data'),
    join(TEAMAGENTS_HOME, 'logs'),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

function createAgent(name: string): void {
  const agentDir = join(TEAMAGENTS_HOME, 'agents', name);
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, 'memory'), { recursive: true });

  const soulPath = join(agentDir, 'SOUL.md');
  if (!existsSync(soulPath)) {
    writeFileSync(soulPath, DEFAULT_SOUL.replace('Main Assistant', name === 'main' ? 'Main Assistant' : name), 'utf-8');
  }

  const heartbeatPath = join(agentDir, 'HEARTBEAT.md');
  if (!existsSync(heartbeatPath)) {
    writeFileSync(heartbeatPath, DEFAULT_HEARTBEAT, 'utf-8');
  }

  const memoryPath = join(agentDir, 'MEMORY.md');
  if (!existsSync(memoryPath)) {
    writeFileSync(
      memoryPath,
      `# ${name} Memory\n\nCurated long-term memories.\n`,
      'utf-8',
    );
  }
}

interface BuildConfigOptions {
  agentName: string;
  telegramToken: string;
  slackBotToken: string;
  slackAppToken: string;
  discordToken: string;
  gatewayPort: number;
}

function buildConfig(opts: BuildConfigOptions): Record<string, unknown> {
  const channels: Record<string, unknown> = {
    webchat: { enabled: true },
  };

  if (opts.telegramToken) {
    channels.telegram = {
      enabled: true,
      token: opts.telegramToken,
    };
  }

  if (opts.slackBotToken) {
    channels.slack = {
      enabled: true,
      botToken: opts.slackBotToken,
      appToken: opts.slackAppToken,
    };
  }

  if (opts.discordToken) {
    channels.discord = {
      enabled: true,
      token: opts.discordToken,
    };
  }

  return {
    version: 1,
    gateway: {
      port: opts.gatewayPort,
      host: '0.0.0.0',
    },
    agents: {
      [opts.agentName]: {
        name: opts.agentName === 'main' ? 'Main Assistant' : opts.agentName,
        description: 'General-purpose assistant',
        model: 'sonnet',
        toolPreset: 'full',
        customTools: [],
        skills: [],
        heartbeat: {
          enabled: false,
          interval: '30m',
          suppressOk: true,
        },
      },
    },
    channels,
    routing: {
      defaultAgent: opts.agentName,
      rules: [],
    },
    logging: {
      level: 'info',
      file: join(TEAMAGENTS_HOME, 'logs', 'teamagents.log'),
    },
  };
}

import { existsSync, readFileSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import type { Command } from 'commander';

const CLADE_HOME = join(homedir(), '.clade');
const CONFIG_PATH = join(CLADE_HOME, 'config.json');
const DB_PATH = join(CLADE_HOME, 'data', 'clade.db');

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  detail?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check system health and configuration')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (opts: { json?: boolean; verbose?: boolean }) => {
      try {
        await runDoctor(opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function runDoctor(opts: {
  json?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const results: CheckResult[] = [];

  // Run all checks
  results.push(checkClaudeCli());
  results.push(checkClaudeAuth());
  results.push(checkConfig());
  results.push(checkDirectoryStructure());
  results.push(checkAgents());
  results.push(checkSqlite());
  results.push(checkChannels());
  results.push(checkSkills());
  results.push(checkNodeVersion());

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Print results
  console.log(`\n  Clade Doctor\n`);

  let hasFailure = false;
  let hasWarning = false;

  for (const r of results) {
    const icon = r.status === 'ok' ? '[ok]' : r.status === 'warn' ? '[!!]' : '[FAIL]';
    console.log(`  ${icon} ${r.name}: ${r.message}`);

    if (opts.verbose && r.detail) {
      const detailLines = r.detail.split('\n');
      for (const line of detailLines) {
        console.log(`       ${line}`);
      }
    }

    if (r.status === 'fail') hasFailure = true;
    if (r.status === 'warn') hasWarning = true;
  }

  console.log('');

  if (hasFailure) {
    console.log(
      '  Some checks failed. Fix the issues above and run "clade doctor" again.',
    );
  } else if (hasWarning) {
    console.log(
      '  Everything looks good, but there are some warnings.',
    );
  } else {
    console.log('  All checks passed!');
  }

  console.log('');

  // Exit with non-zero if there are failures
  if (hasFailure) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkClaudeCli(): CheckResult {
  try {
    const output = execSync('which claude', {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return {
      name: 'Claude CLI',
      status: 'ok',
      message: 'Installed',
      detail: `Path: ${output}`,
    };
  } catch {
    return {
      name: 'Claude CLI',
      status: 'fail',
      message: 'Not found',
      detail: 'Install from: https://docs.anthropic.com/en/docs/claude-cli',
    };
  }
}

function checkClaudeAuth(): CheckResult {
  try {
    const output = execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return {
      name: 'Claude Auth',
      status: 'ok',
      message: `Authenticated (${output})`,
    };
  } catch {
    return {
      name: 'Claude Auth',
      status: 'warn',
      message:
        'Could not verify authentication. Run "claude" to authenticate.',
    };
  }
}

function checkConfig(): CheckResult {
  if (!existsSync(CONFIG_PATH)) {
    return {
      name: 'Config',
      status: 'fail',
      message: 'config.json not found',
      detail: 'Run "clade setup" to create the configuration.',
    };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;

    // Basic validation
    if (!config.agents || typeof config.agents !== 'object') {
      return {
        name: 'Config',
        status: 'warn',
        message: 'Config loaded but no agents defined',
        detail: 'Run "clade agent add <name>" to create an agent.',
      };
    }

    const agentCount = Object.keys(
      config.agents as Record<string, unknown>,
    ).length;
    return {
      name: 'Config',
      status: 'ok',
      message: `Valid (${agentCount} agent${agentCount !== 1 ? 's' : ''})`,
      detail: `Path: ${CONFIG_PATH}`,
    };
  } catch (err: unknown) {
    return {
      name: 'Config',
      status: 'fail',
      message: 'Invalid JSON in config.json',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkDirectoryStructure(): CheckResult {
  const requiredDirs = [
    CLADE_HOME,
    join(CLADE_HOME, 'agents'),
    join(CLADE_HOME, 'skills'),
    join(CLADE_HOME, 'data'),
  ];

  const missing = requiredDirs.filter((d) => !existsSync(d));

  if (missing.length > 0) {
    return {
      name: 'Directory Structure',
      status: 'fail',
      message: `Missing directories: ${missing.length}`,
      detail: missing.map((d) => `Missing: ${d}`).join('\n'),
    };
  }

  return {
    name: 'Directory Structure',
    status: 'ok',
    message: 'All required directories exist',
  };
}

function checkAgents(): CheckResult {
  const agentsDir = join(CLADE_HOME, 'agents');
  if (!existsSync(agentsDir)) {
    return {
      name: 'Agents',
      status: 'warn',
      message: 'No agents directory',
      detail: 'Run "clade setup" to initialize.',
    };
  }

  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    const agentDirs = entries.filter((e) => e.isDirectory());

    if (agentDirs.length === 0) {
      return {
        name: 'Agents',
        status: 'warn',
        message: 'No agents found',
        detail: 'Run "clade agent add <name>" to create an agent.',
      };
    }

    const details: string[] = [];
    let allHaveSoul = true;

    for (const dir of agentDirs) {
      const soulPath = join(agentsDir, dir.name, 'SOUL.md');
      const hasSoul = existsSync(soulPath);
      if (!hasSoul) allHaveSoul = false;
      details.push(
        `${dir.name}: ${hasSoul ? 'SOUL.md found' : 'SOUL.md MISSING'}`,
      );
    }

    return {
      name: 'Agents',
      status: allHaveSoul ? 'ok' : 'warn',
      message: `${agentDirs.length} agent${agentDirs.length !== 1 ? 's' : ''} found${allHaveSoul ? '' : ' (some missing SOUL.md)'}`,
      detail: details.join('\n'),
    };
  } catch (err: unknown) {
    return {
      name: 'Agents',
      status: 'warn',
      message: 'Could not read agents directory',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkSqlite(): CheckResult {
  // Check if better-sqlite3 is available
  try {
    require('better-sqlite3');
  } catch {
    return {
      name: 'SQLite',
      status: 'warn',
      message: 'better-sqlite3 not loaded',
      detail:
        'The better-sqlite3 module could not be loaded. Run "npm install" in the project directory.',
    };
  }

  // Check if data directory is writable
  const dataDir = join(CLADE_HOME, 'data');
  if (!existsSync(dataDir)) {
    return {
      name: 'SQLite',
      status: 'warn',
      message: 'Data directory does not exist',
      detail: `Expected: ${dataDir}`,
    };
  }

  try {
    accessSync(dataDir, constants.W_OK);
    return {
      name: 'SQLite',
      status: 'ok',
      message: existsSync(DB_PATH)
        ? 'Database exists and is writable'
        : 'Data directory is writable (database will be created on first use)',
      detail: `Path: ${DB_PATH}`,
    };
  } catch {
    return {
      name: 'SQLite',
      status: 'fail',
      message: 'Data directory is not writable',
      detail: `Path: ${dataDir}`,
    };
  }
}

function checkChannels(): CheckResult {
  if (!existsSync(CONFIG_PATH)) {
    return {
      name: 'Channels',
      status: 'warn',
      message: 'No config file (run setup first)',
    };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const channels = (config.channels ?? {}) as Record<
      string,
      { enabled?: boolean; token?: string; botToken?: string }
    >;

    const enabled: string[] = [];
    const issues: string[] = [];

    for (const [name, channelCfg] of Object.entries(channels)) {
      if (!channelCfg.enabled) continue;
      enabled.push(name);

      // Check for tokens
      if (name === 'telegram') {
        const token =
          channelCfg.token ?? process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          issues.push(
            'Telegram: No token (set TELEGRAM_BOT_TOKEN env var or configure in config.json)',
          );
        }
      }
      if (name === 'slack') {
        const token =
          channelCfg.botToken ?? process.env.SLACK_BOT_TOKEN;
        if (!token) {
          issues.push(
            'Slack: No bot token (set SLACK_BOT_TOKEN env var or configure in config.json)',
          );
        }
      }
      if (name === 'discord') {
        const token =
          channelCfg.token ?? process.env.DISCORD_BOT_TOKEN;
        if (!token) {
          issues.push(
            'Discord: No token (set DISCORD_BOT_TOKEN env var or configure in config.json)',
          );
        }
      }
    }

    if (enabled.length === 0) {
      return {
        name: 'Channels',
        status: 'warn',
        message: 'No channels enabled',
        detail: 'Enable channels in config.json or re-run setup.',
      };
    }

    if (issues.length > 0) {
      return {
        name: 'Channels',
        status: 'warn',
        message: `${enabled.length} enabled, ${issues.length} issue${issues.length !== 1 ? 's' : ''}`,
        detail: issues.join('\n'),
      };
    }

    return {
      name: 'Channels',
      status: 'ok',
      message: `${enabled.join(', ')} enabled`,
    };
  } catch {
    return {
      name: 'Channels',
      status: 'warn',
      message: 'Could not parse config for channel info',
    };
  }
}

function checkSkills(): CheckResult {
  const activeDir = join(CLADE_HOME, 'skills', 'active');
  const pendingDir = join(CLADE_HOME, 'skills', 'pending');

  let activeCount = 0;
  let pendingCount = 0;

  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    if (existsSync(activeDir)) {
      activeCount = readdirSync(activeDir).filter((f) =>
        f.endsWith('.json'),
      ).length;
    }
    if (existsSync(pendingDir)) {
      pendingCount = readdirSync(pendingDir).filter((f) =>
        f.endsWith('.json'),
      ).length;
    }
  } catch {
    return {
      name: 'Skills',
      status: 'warn',
      message: 'Could not read skills directories',
    };
  }

  if (pendingCount > 0) {
    return {
      name: 'Skills',
      status: 'warn',
      message: `${activeCount} active, ${pendingCount} pending approval`,
      detail: `Run "clade skill list --pending" to see pending skills.`,
    };
  }

  return {
    name: 'Skills',
    status: 'ok',
    message: `${activeCount} active skill${activeCount !== 1 ? 's' : ''}`,
  };
}

function checkNodeVersion(): CheckResult {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0] ?? '0', 10);

  if (major < 20) {
    return {
      name: 'Node.js',
      status: 'fail',
      message: `v${version} (requires v20+)`,
      detail: 'Upgrade Node.js to version 20 or later.',
    };
  }

  return {
    name: 'Node.js',
    status: 'ok',
    message: `v${version}`,
  };
}

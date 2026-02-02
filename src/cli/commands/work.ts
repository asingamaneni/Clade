import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { RalphEngine } from '../../engine/ralph.js';
import type { RalphConfig, RalphProgressEvent, RalphResult } from '../../engine/ralph.js';
import type { Command } from 'commander';

const CLADE_HOME = join(homedir(), '.clade');

interface WorkOptions {
  agent?: string;
  plan?: string;
  progress?: string;
  verify?: string;
  maxRetries?: string;
  maxIterations?: string;
  maxTurns?: string;
  model?: string;
  cwd?: string;
  verbose?: boolean;
}

export function registerWorkCommand(program: Command): void {
  program
    .command('work')
    .description('Launch RALPH autonomous work loop')
    .option('-a, --agent <name>', 'Agent to use', 'main')
    .option(
      '-p, --plan <path>',
      'Path to PLAN.md',
      './PLAN.md',
    )
    .option('--progress <path>', 'Path to progress.md')
    .option(
      '--verify <command>',
      'Verification command (e.g., "npm test")',
    )
    .option('--max-retries <n>', 'Max retries per task', '3')
    .option('--max-iterations <n>', 'Max total iterations', '50')
    .option('--max-turns <n>', 'Max claude turns per task', '25')
    .option('-m, --model <model>', 'Override model')
    .option('--cwd <dir>', 'Working directory')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (opts: WorkOptions) => {
      try {
        await runWork(opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function runWork(opts: WorkOptions): Promise<void> {
  const planPath = resolve(opts.plan ?? './PLAN.md');
  const agentId = opts.agent ?? 'main';

  // Validate plan file exists
  if (!existsSync(planPath)) {
    console.error(`Error: Plan file not found: ${planPath}`);
    console.error(
      '\nCreate a PLAN.md with tasks in checkbox format:',
    );
    console.error('  - [ ] First task');
    console.error('  - [ ] Second task');
    console.error('  - [ ] Third task\n');
    process.exit(1);
  }

  // Load agent SOUL.md if available
  let systemPrompt: string | undefined;
  const soulPath = join(CLADE_HOME, 'agents', agentId, 'SOUL.md');
  if (existsSync(soulPath)) {
    systemPrompt = readFileSync(soulPath, 'utf-8');
  }

  // Load agent model from config if available
  let agentModel: string | undefined;
  const configPath = join(CLADE_HOME, 'config.json');
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agents = (config.agents ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const agentCfg = agents[agentId];
      if (agentCfg && typeof agentCfg.model === 'string') {
        agentModel = agentCfg.model;
      }
    } catch {
      // Continue without config
    }
  }

  const config: RalphConfig = {
    agentId,
    planPath,
    progressPath: opts.progress ? resolve(opts.progress) : undefined,
    verifyCommand: opts.verify,
    maxRetries: opts.maxRetries ? parseInt(opts.maxRetries, 10) : 3,
    maxIterations: opts.maxIterations
      ? parseInt(opts.maxIterations, 10)
      : 50,
    maxTurnsPerTask: opts.maxTurns ? parseInt(opts.maxTurns, 10) : 25,
    workingDirectory: opts.cwd ? resolve(opts.cwd) : process.cwd(),
    systemPrompt,
    model: opts.model ?? agentModel,
  };

  // Preview the plan
  const engine = new RalphEngine();
  const planContent = readFileSync(planPath, 'utf-8');
  const tasks = engine.parsePlan(planContent);

  const openCount = tasks.filter((t) => t.status === 'open').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const blockedCount = tasks.filter((t) => t.status === 'blocked').length;

  console.log(`\n  RALPH Work Loop\n`);
  console.log(`  Agent: ${agentId}`);
  console.log(`  Plan:  ${planPath}`);
  console.log(
    `  Tasks: ${tasks.length} total, ${openCount} open, ${doneCount} done, ${blockedCount} blocked`,
  );
  if (config.verifyCommand) {
    console.log(`  Verify: ${config.verifyCommand}`);
  }
  console.log(`  Max retries: ${config.maxRetries}`);
  console.log(`  Max iterations: ${config.maxIterations}`);
  console.log('');

  if (openCount === 0) {
    console.log('  No open tasks. Nothing to do.\n');
    return;
  }

  console.log(`  Starting work loop...\n`);
  console.log('  ' + '='.repeat(60));

  // Graceful shutdown
  let shutdownRequested = false;

  const handleShutdown = () => {
    if (shutdownRequested) {
      console.log('\n  Force shutdown.');
      process.exit(1);
    }
    shutdownRequested = true;
    console.log(
      '\n  Shutdown requested. Finishing current task...',
    );
    engine.abort();
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  const startTime = Date.now();

  const result = await engine.run(config, (event: RalphProgressEvent) => {
    printProgressEvent(event, opts.verbose ?? false);
  });

  // Cleanup signal handlers
  process.removeListener('SIGINT', handleShutdown);
  process.removeListener('SIGTERM', handleShutdown);

  // Print summary
  printSummary(result, startTime);
}

function printProgressEvent(
  event: RalphProgressEvent,
  verbose: boolean,
): void {
  const timestamp = new Date().toLocaleTimeString();

  switch (event.type) {
    case 'loop_start':
      console.log(`  [${timestamp}] ${event.message}`);
      break;

    case 'task_start':
      console.log('');
      console.log(`  [${timestamp}] >> ${event.message}`);
      break;

    case 'task_working':
      if (verbose) {
        console.log(`  [${timestamp}]    Working...`);
      }
      break;

    case 'task_verify':
      if (verbose) {
        console.log(`  [${timestamp}]    Running verification...`);
      }
      break;

    case 'task_done': {
      const duration = event.durationMs
        ? ` (${(event.durationMs / 1000).toFixed(1)}s)`
        : '';
      console.log(
        `  [${timestamp}]    [DONE] ${event.task?.text ?? ''}${duration}`,
      );
      break;
    }

    case 'task_retry': {
      console.log(
        `  [${timestamp}]    [RETRY] ${event.message}`,
      );
      if (verbose && event.output) {
        const lines = event.output.split('\n').slice(0, 5);
        for (const line of lines) {
          console.log(`  [${timestamp}]      ${line}`);
        }
      }
      break;
    }

    case 'task_blocked':
      console.log(
        `  [${timestamp}]    [BLOCKED] ${event.task?.text ?? ''}`,
      );
      break;

    case 'task_error':
      console.log(
        `  [${timestamp}]    [ERROR] ${event.message}`,
      );
      break;

    case 'loop_done':
      console.log('');
      console.log('  ' + '='.repeat(60));
      console.log(`  [${timestamp}] ${event.message}`);
      break;

    default:
      if (verbose) {
        console.log(`  [${timestamp}] ${event.message}`);
      }
  }
}

function printSummary(result: RalphResult, startTime: number): void {
  const elapsed = Date.now() - startTime;
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000);

  console.log(`\n  Summary\n`);
  console.log(`  Total iterations: ${result.totalIterations}`);
  console.log(`  Tasks completed:  ${result.tasksCompleted}`);
  console.log(`  Tasks blocked:    ${result.tasksBlocked}`);
  console.log(`  Tasks remaining:  ${result.tasksRemaining}`);
  console.log(`  Duration:         ${minutes}m ${seconds}s`);

  if (result.aborted) {
    console.log(`  Status:           Aborted (graceful shutdown)`);
  } else if (result.tasksRemaining === 0 && result.tasksBlocked === 0) {
    console.log(`  Status:           All tasks completed!`);
  } else if (result.tasksRemaining === 0) {
    console.log(
      `  Status:           Finished (some tasks blocked)`,
    );
  } else {
    console.log(
      `  Status:           Stopped (max iterations reached)`,
    );
  }

  console.log('');
}

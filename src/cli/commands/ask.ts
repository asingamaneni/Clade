import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ClaudeCliRunner } from '../../engine/claude-cli.js';
import type { ClaudeOptions } from '../../engine/claude-cli.js';
import type { Command } from 'commander';

const CLADE_HOME = join(homedir(), '.clade');

interface AskOptions {
  agent?: string;
  model?: string;
  maxTurns?: string;
  stream?: boolean;
  verbose?: boolean;
}

export function registerAskCommand(program: Command): void {
  program
    .command('ask')
    .description('Send a one-off question to an agent')
    .argument('<prompt>', 'The question or prompt to send')
    .option('-a, --agent <name>', 'Agent to use', 'main')
    .option('-m, --model <model>', 'Override model')
    .option('--max-turns <n>', 'Maximum turns', '5')
    .option('-s, --stream', 'Stream output in real-time', false)
    .option('-v, --verbose', 'Show detailed output')
    .action(async (prompt: string, opts: AskOptions) => {
      try {
        await runAsk(prompt, opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function runAsk(prompt: string, opts: AskOptions): Promise<void> {
  const agentId = opts.agent ?? 'main';

  // Load agent SOUL.md if available
  let systemPrompt: string | undefined;
  const soulPath = join(CLADE_HOME, 'agents', agentId, 'SOUL.md');
  if (existsSync(soulPath)) {
    systemPrompt = readFileSync(soulPath, 'utf-8');
  }

  // Load agent config for model/tools if available
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
      // Config parse error -- continue without it
    }
  }

  const options: ClaudeOptions = {
    prompt,
    systemPrompt,
    model: opts.model ?? agentModel,
    maxTurns: opts.maxTurns ? parseInt(opts.maxTurns, 10) : 5,
    verbose: opts.verbose,
  };

  const runner = new ClaudeCliRunner();

  if (opts.stream) {
    // Stream mode: print text chunks as they arrive
    runner.on('text', (chunk: string) => {
      process.stdout.write(chunk);
    });
  }

  if (opts.verbose) {
    runner.on('data', (event) => {
      if (event.type === 'tool_use') {
        console.error(
          `  [tool] ${String(event.name ?? event.tool ?? 'unknown')}`,
        );
      }
    });
  }

  const startTime = Date.now();

  try {
    const result = await runner.run(options);
    const elapsed = Date.now() - startTime;

    if (!opts.stream) {
      // Non-stream mode: print full result at the end
      console.log(result.text);
    } else {
      // Ensure a trailing newline after streaming
      console.log('');
    }

    if (opts.verbose) {
      console.error('');
      console.error(`  Session: ${result.sessionId || 'n/a'}`);
      console.error(`  Duration: ${(elapsed / 1000).toFixed(1)}s`);
      if (result.usage) {
        console.error(
          `  Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`,
        );
      }
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('claude CLI not found')
    ) {
      console.error(
        'Error: claude CLI not found.\n' +
          'Install it from: https://docs.anthropic.com/en/docs/claude-cli\n',
      );
      process.exit(1);
    }
    throw err;
  }
}

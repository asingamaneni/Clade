import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerStartCommand } from './commands/start.js';
import { registerAskCommand } from './commands/ask.js';
import { registerAgentCommand } from './commands/agent.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerWorkCommand } from './commands/work.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerUiCommand } from './commands/ui.js';
import { registerDocsCommand } from './commands/docs.js';

/**
 * Create and configure the Clade CLI program.
 */
export function createCli(): Command {
  const program = new Command();

  program
    .name('clade')
    .description(
      'Multi-agent orchestration platform built on the Claude CLI',
    )
    .version('0.1.0');

  registerSetupCommand(program);
  registerStartCommand(program);
  registerAskCommand(program);
  registerAgentCommand(program);
  registerMcpCommand(program);
  registerWorkCommand(program);
  registerDoctorCommand(program);
  registerUiCommand(program);
  registerDocsCommand(program);

  // Default action: show help
  program.action(() => {
    program.help();
  });

  return program;
}

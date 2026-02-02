// ---------------------------------------------------------------------------
// Tests: UI Command
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_HOME = join(tmpdir(), `clade-test-ui-${Date.now()}`);

describe('UI Command', () => {
  beforeEach(() => {
    process.env['CLADE_HOME'] = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    delete process.env['CLADE_HOME'];
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should register the ui command on the program', async () => {
    const { registerUiCommand } = await import(
      '../../src/cli/commands/ui.js'
    );
    const program = new Command();
    registerUiCommand(program);

    const uiCmd = program.commands.find((c) => c.name() === 'ui');
    expect(uiCmd).toBeDefined();
    expect(uiCmd!.description()).toBe(
      'Open the Clade admin dashboard in your browser',
    );
  });

  it('should accept --port and --host options', async () => {
    const { registerUiCommand } = await import(
      '../../src/cli/commands/ui.js'
    );
    const program = new Command();
    registerUiCommand(program);

    const uiCmd = program.commands.find((c) => c.name() === 'ui');
    expect(uiCmd).toBeDefined();

    const portOpt = uiCmd!.options.find((o) => o.long === '--port');
    const hostOpt = uiCmd!.options.find((o) => o.long === '--host');
    const noBrowserOpt = uiCmd!.options.find((o) => o.long === '--no-browser');

    expect(portOpt).toBeDefined();
    expect(hostOpt).toBeDefined();
    expect(noBrowserOpt).toBeDefined();
  });

  it('should be registered in the main CLI', async () => {
    const { createCli } = await import('../../src/cli/index.js');
    const program = createCli();
    const uiCmd = program.commands.find((c) => c.name() === 'ui');
    expect(uiCmd).toBeDefined();
  });
});

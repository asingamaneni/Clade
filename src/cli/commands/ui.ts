import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import type { Command } from 'commander';

const CLADE_HOME = join(homedir(), '.clade');

interface UiOptions {
  port?: string;
  host?: string;
  noBrowser?: boolean;
}

export function registerUiCommand(program: Command): void {
  program
    .command('ui')
    .description('Open the Clade admin dashboard in your browser')
    .option('-p, --port <port>', 'Gateway port (default: from config or 7890)')
    .option('--host <host>', 'Gateway host (default: from config or 127.0.0.1)')
    .option('--no-browser', 'Print the URL without opening a browser')
    .action(async (opts: UiOptions) => {
      try {
        await runUi(opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function runUi(opts: UiOptions): Promise<void> {
  // Resolve port and host from config or flags
  const configPath = join(CLADE_HOME, 'config.json');
  let configPort = 7890;
  let configHost = '127.0.0.1';

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const gw = (config.gateway ?? {}) as Record<string, unknown>;
      if (typeof gw.port === 'number') configPort = gw.port;
      if (typeof gw.host === 'string') configHost = gw.host;
    } catch {
      // Use defaults if config is unreadable
    }
  }

  const port = opts.port ? parseInt(opts.port, 10) : configPort;
  // For browser URLs, 0.0.0.0 should map to localhost
  const host = opts.host ?? configHost;
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const url = `http://${displayHost}:${port}/admin`;

  // Check if the gateway is already running
  const isRunning = await checkGateway(displayHost, port);

  if (!isRunning) {
    console.log(`\n  Gateway is not running on ${displayHost}:${port}.`);
    console.log(`  Start it with: clade start\n`);
    console.log(`  Admin URL: ${url}\n`);
    return;
  }

  if (opts.noBrowser === false) {
    // --no-browser flag was passed (commander inverts it)
    console.log(`\n  Admin URL: ${url}\n`);
    return;
  }

  // Open browser
  const opened = openBrowser(url);
  if (opened) {
    console.log(`\n  Opened ${url} in your browser.\n`);
  } else {
    console.log(`\n  Could not open browser automatically.`);
    console.log(`  Open this URL manually: ${url}\n`);
  }
}

/**
 * Check if the gateway is running by hitting the health endpoint.
 */
async function checkGateway(host: string, port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);

    const res = await fetch(`http://${host}:${port}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Open a URL in the default browser. Returns true on success.
 */
function openBrowser(url: string): boolean {
  const platform = process.platform;
  const commands: Record<string, string> = {
    darwin: 'open',
    win32: 'start',
    linux: 'xdg-open',
  };

  const cmd = commands[platform];
  if (!cmd) return false;

  try {
    execSync(`${cmd} "${url}"`, {
      stdio: 'ignore',
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

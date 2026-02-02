import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

interface DocsOptions {
  serve?: boolean;
  port?: string;
}

export function registerDocsCommand(program: Command): void {
  program
    .command('docs')
    .description('Open or serve the Clade documentation')
    .option('--serve', 'Start a local documentation dev server')
    .option('-p, --port <port>', 'Port for the docs server', '5173')
    .action(async (opts: DocsOptions) => {
      try {
        await runDocs(opts);
      } catch (err: unknown) {
        console.error(
          'Error:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function runDocs(opts: DocsOptions): Promise<void> {
  // Find the docs directory relative to this package
  const packageRoot = findPackageRoot();
  const docsDir = join(packageRoot, 'docs');

  if (!existsSync(docsDir)) {
    console.error(
      '\n  Documentation directory not found.\n' +
        '  Expected at: ' + docsDir + '\n' +
        '\n  If you installed Clade globally, clone the repo to access docs:\n' +
        '    git clone https://github.com/asingamaneni/Clade.git\n' +
        '    cd Clade && npm run docs:dev\n',
    );
    process.exit(1);
  }

  if (opts.serve) {
    await serveDocsDevServer(packageRoot, opts.port ?? '5173');
  } else {
    // Try to open pre-built docs, otherwise tell user to use --serve
    const builtDir = join(docsDir, '.vitepress', 'dist');
    if (existsSync(builtDir)) {
      const url = `file://${join(builtDir, 'index.html')}`;
      openBrowser(url);
      console.log(`\n  Opened built docs at: ${url}\n`);
    } else {
      console.log('\n  Clade Documentation\n');
      console.log('  To start the docs dev server with hot-reload:');
      console.log('    clade docs --serve\n');
      console.log('  Or use npm directly:');
      console.log('    npm run docs:dev\n');
      console.log(`  Docs source: ${docsDir}\n`);
    }
  }
}

async function serveDocsDevServer(packageRoot: string, port: string): Promise<void> {
  const vitepressBin = join(packageRoot, 'node_modules', '.bin', 'vitepress');

  if (!existsSync(vitepressBin)) {
    console.error(
      '\n  VitePress not found. Install dev dependencies first:\n' +
        '    npm install\n',
    );
    process.exit(1);
  }

  console.log(`\n  Starting documentation server on port ${port}...\n`);

  const child = spawn(vitepressBin, ['dev', 'docs', '--port', port], {
    cwd: packageRoot,
    stdio: 'inherit',
    env: { ...process.env },
  });

  // Forward signals to child process
  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`VitePress exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function findPackageRoot(): string {
  // Walk up from this file to find the package root (where package.json lives)
  let dir: string;

  // When running from source (ts-node / tsx)
  if (typeof __dirname !== 'undefined') {
    dir = __dirname;
  } else {
    // ESM: use import.meta.url equivalent
    try {
      dir = dirname(fileURLToPath(import.meta.url));
    } catch {
      dir = process.cwd();
    }
  }

  // Walk up to find package.json
  let current = dir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Fallback to cwd
  return process.cwd();
}

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

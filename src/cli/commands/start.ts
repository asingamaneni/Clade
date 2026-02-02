import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

interface StartOptions {
  port?: string;
  host?: string;
  verbose?: boolean;
}

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the Clade gateway server')
    .option('-p, --port <port>', 'Override gateway port')
    .option('--host <host>', 'Override gateway host')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (opts: StartOptions) => {
      try {
        await runStart(opts);
      } catch (err: unknown) {
        console.error(
          'Failed to start:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

async function runStart(opts: StartOptions): Promise<void> {
  const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  const configPath = join(cladeHome, 'config.json');

  // Auto-bootstrap if no config exists
  if (!existsSync(configPath)) {
    bootstrapDefaultConfig(cladeHome, configPath);
  }

  let config: Record<string, unknown>;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    console.error(
      'Error: Failed to parse config.json:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }

  // Apply CLI overrides
  const gateway = (config.gateway ?? {}) as Record<string, unknown>;
  const port = opts.port ? parseInt(opts.port, 10) : (gateway.port as number) ?? 7890;
  const host = opts.host ?? (gateway.host as string) ?? '0.0.0.0';

  if (opts.verbose) {
    console.log('Config loaded from:', configPath);
    console.log('Gateway config:', { port, host });
  }

  console.log(`\n  Clade Gateway\n`);
  console.log(`  Starting server on ${host}:${port}...\n`);

  // Graceful shutdown handler
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  Received ${signal}. Shutting down gracefully...\n`);

    // Allow time for cleanup then force exit
    setTimeout(() => {
      console.log('  Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Dynamically import gateway module (built by another agent)
  // This allows the start command to work even before gateway is implemented
  try {
    const gatewayModule = await import('../../gateway/server.js').catch(
      () => null,
    );

    if (gatewayModule && typeof gatewayModule.createGateway === 'function') {
      await (gatewayModule.createGateway as Function)({ port, host, config, verbose: opts.verbose });
    } else {
      // Gateway not yet implemented -- start a minimal placeholder
      await startPlaceholderServer(port, host, config);
    }
  } catch {
    // If gateway module is not available, start minimal server
    await startPlaceholderServer(port, host, config);
  }
}

/**
 * Create a minimal default config so `clade start` works out of the box.
 * No agents, no channels — just the gateway.
 */
function bootstrapDefaultConfig(cladeHome: string, configPath: string): void {
  console.log('  No config found. Creating default configuration...\n');

  // Create directory structure
  const dirs = [
    cladeHome,
    join(cladeHome, 'agents'),
    join(cladeHome, 'skills'),
    join(cladeHome, 'skills', 'active'),
    join(cladeHome, 'skills', 'pending'),
    join(cladeHome, 'data'),
    join(cladeHome, 'logs'),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  const config = {
    version: 2,
    agents: {},
    channels: {
      webchat: { enabled: true },
    },
    gateway: {
      port: 7890,
      host: '0.0.0.0',
    },
    routing: {
      defaultAgent: '',
      rules: [],
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`  [ok] Created ${configPath}`);
  console.log('  [ok] Created ~/.clade/ directory structure');
  console.log('');
  console.log('  Tip: Add agents with "clade agent add <name>"');
  console.log('  Tip: Run "clade setup" for interactive channel configuration\n');
}

/**
 * Locate admin.html by searching known paths relative to this file.
 * Works both from source (src/cli/commands/) and from built output (dist/cli/commands/).
 */
function findAdminHtml(): string | null {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = __dirname ?? process.cwd();
  }

  // Search paths relative to this file (src/cli/commands/ or dist/cli/commands/)
  const candidates = [
    join(dir, '..', '..', 'gateway', 'admin.html'),           // from dist: dist/gateway/admin.html
    join(dir, '..', '..', '..', 'src', 'gateway', 'admin.html'), // from dist: src/gateway/admin.html
    join(dir, '..', '..', '..', 'gateway', 'admin.html'),     // alternate layout
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Minimal server that serves the admin dashboard, health check, and config API.
 * Used when the full gateway (with session manager, store, etc.) isn't available.
 */
async function startPlaceholderServer(
  port: number,
  host: string,
  config: Record<string, unknown>,
): Promise<void> {
  const { default: Fastify } = await import('fastify');
  const fastify = Fastify({ logger: false });

  // ── Health check ──────────────────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
  }));

  // ── Config API (sanitized) ────────────────────────────────────
  fastify.get('/api/config', async () => {
    const agents = config.agents ?? {};
    return {
      agents: Object.keys(agents as Record<string, unknown>),
      channels: Object.keys(
        (config.channels ?? {}) as Record<string, unknown>,
      ),
    };
  });

  // ── Stub API endpoints so the admin UI doesn't get errors ─────
  fastify.get('/api/agents', async () => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    return {
      agents: Object.entries(agents).map(([id, a]) => ({
        id,
        name: a.name ?? id,
        description: a.description ?? '',
        model: a.model ?? 'sonnet',
        toolPreset: a.toolPreset ?? 'full',
      })),
    };
  });

  fastify.get('/api/sessions', async () => ({ sessions: [] }));
  fastify.get('/api/skills', async () => ({ skills: [] }));
  fastify.get('/api/channels', async () => ({ channels: [] }));
  fastify.get('/api/cron', async () => ({ jobs: [] }));

  // ── Admin dashboard ───────────────────────────────────────────
  const adminHtmlPath = findAdminHtml();

  fastify.get('/admin', async (_req, reply) => {
    if (adminHtmlPath) {
      const html = readFileSync(adminHtmlPath, 'utf-8');
      reply.type('text/html').send(html);
    } else {
      reply.type('text/html').send(FALLBACK_ADMIN_HTML);
    }
  });

  // ── Root redirects to admin ───────────────────────────────────
  fastify.get('/', async (_req, reply) => {
    reply.redirect('/admin');
  });

  await fastify.listen({ port, host });

  const agentCount = Object.keys(
    (config.agents ?? {}) as Record<string, unknown>,
  ).length;
  const channelList = Object.entries(
    (config.channels ?? {}) as Record<string, { enabled?: boolean }>,
  )
    .filter(([, v]) => v.enabled)
    .map(([k]) => k);

  console.log(`  Server listening on http://${host}:${port}`);
  console.log(`  Agents: ${agentCount}`);
  console.log(`  Channels: ${channelList.join(', ') || 'none'}`);
  console.log(`\n  Health check: http://${host}:${port}/health`);
  console.log(`  Admin UI:     http://${host}:${port}/admin`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  await new Promise(() => {});
}

const FALLBACK_ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clade Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f1117; color: #e6edf3; font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { text-align: center; max-width: 480px; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { color: #8b949e; margin-bottom: 2rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; text-align: left; }
    .card h3 { font-size: 0.875rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
    .link { color: #58a6ff; text-decoration: none; display: block; padding: 0.25rem 0; }
    .link:hover { text-decoration: underline; }
    .tip { color: #8b949e; font-size: 0.875rem; margin-top: 1.5rem; }
    code { background: #161b22; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Clade</h1>
    <p class="subtitle">Gateway is running</p>
    <div class="card">
      <h3>API Endpoints</h3>
      <a class="link" href="/health">/health</a>
      <a class="link" href="/api/config">/api/config</a>
      <a class="link" href="/api/agents">/api/agents</a>
      <a class="link" href="/api/sessions">/api/sessions</a>
    </div>
    <p class="tip">Add agents with <code>clade agent create --name jarvis --template coding</code></p>
  </div>
</body>
</html>`;

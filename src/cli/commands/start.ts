import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Command } from 'commander';

const TEAMAGENTS_HOME = join(homedir(), '.teamagents');

interface StartOptions {
  port?: string;
  host?: string;
  verbose?: boolean;
}

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the TeamAgents gateway server')
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
  // Load config
  const configPath = join(TEAMAGENTS_HOME, 'config.json');
  if (!existsSync(configPath)) {
    console.error(
      'Error: TeamAgents is not configured.\n' +
        'Run "teamagents setup" first.\n',
    );
    process.exit(1);
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

  console.log(`\n  TeamAgents Gateway\n`);
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
  } catch (err: unknown) {
    // If gateway module is not available, start minimal server
    await startPlaceholderServer(port, host, config);
  }
}

/**
 * Minimal placeholder server until the full gateway is implemented.
 * Serves basic health check and prints status.
 */
async function startPlaceholderServer(
  port: number,
  host: string,
  config: Record<string, unknown>,
): Promise<void> {
  // Dynamically import fastify
  const { default: Fastify } = await import('fastify');
  const fastify = Fastify({ logger: false });

  fastify.get('/health', async () => {
    return {
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
    };
  });

  fastify.get('/api/config', async () => {
    // Return a sanitized version (no tokens)
    const agents = config.agents ?? {};
    return {
      agents: Object.keys(agents as Record<string, unknown>),
      channels: Object.keys(
        (config.channels ?? {}) as Record<string, unknown>,
      ),
    };
  });

  fastify.get('/', async (_req, reply) => {
    reply.type('text/html');
    return `<!DOCTYPE html>
<html>
<head><title>TeamAgents</title></head>
<body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 0 20px;">
  <h1>TeamAgents Gateway</h1>
  <p>Server is running. The admin dashboard will be available here once built.</p>
  <h3>Status</h3>
  <ul>
    <li>Health: <a href="/health">/health</a></li>
    <li>Config: <a href="/api/config">/api/config</a></li>
  </ul>
</body>
</html>`;
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

  // Keep process alive
  await new Promise(() => {
    // This promise never resolves -- the server runs until killed
  });
}

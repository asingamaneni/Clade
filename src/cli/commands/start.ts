import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { listTemplates, getTemplate, configFromTemplate } from '../../agents/templates.js';
import { DEFAULT_SOUL, DEFAULT_HEARTBEAT } from '../../config/defaults.js';

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

  // After tsup bundling, code runs from dist/bin/clade.js so dir = dist/bin/
  // Before bundling (source), dir = src/cli/commands/
  const candidates = [
    join(dir, '..', 'gateway', 'admin.html'),                    // dist/bin/ → dist/gateway/admin.html
    join(dir, '..', '..', 'gateway', 'admin.html'),              // src/cli/commands/ → src/gateway/admin.html
    join(dir, '..', '..', 'src', 'gateway', 'admin.html'),      // dist/bin/ → src/gateway/admin.html
    join(dir, '..', '..', '..', 'src', 'gateway', 'admin.html'), // dist/cli/commands/ → src/gateway/admin.html
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

  // ── WebSocket support for admin dashboard ─────────────────────
  const wsMod = await import('@fastify/websocket').catch(() => null);
  const wsClients = new Set<import('ws').WebSocket>();
  if (wsMod) {
    await fastify.register(wsMod.default);
    fastify.get('/ws/admin', { websocket: true }, (socket) => {
      wsClients.add(socket);
      socket.on('close', () => wsClients.delete(socket));
    });
  }

  // ── Health check ──────────────────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
  }));

  // ── Config API ───────────────────────────────────────────────
  fastify.get('/api/config', async () => {
    return { config };
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

  // ── Get specific agent ────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    const a = agents[id];
    if (!a) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    return { agent: { id, ...a } };
  });

  // ── Get agent SOUL.md ───────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/soul', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const soulPath = join(cladeHome, 'agents', id, 'SOUL.md');
    try {
      const content = readFileSync(soulPath, 'utf-8');
      return { agentId: id, content };
    } catch {
      return { agentId: id, content: '' };
    }
  });

  // ── Update agent SOUL.md ────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/agents/:id/soul', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const body = req.body as Record<string, unknown>;
    const content = body.content;
    if (typeof content !== 'string') {
      reply.status(400);
      return { error: 'content must be a string' };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const soulPath = join(cladeHome, 'agents', id, 'SOUL.md');
    writeFileSync(soulPath, content, 'utf-8');
    return { success: true };
  });

  // ── Get agent HEARTBEAT.md ──────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/heartbeat', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const hbPath = join(cladeHome, 'agents', id, 'HEARTBEAT.md');
    try {
      const content = readFileSync(hbPath, 'utf-8');
      return { agentId: id, content };
    } catch {
      return { agentId: id, content: '' };
    }
  });

  // ── Update agent HEARTBEAT.md ───────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/agents/:id/heartbeat', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const body = req.body as Record<string, unknown>;
    const content = body.content;
    if (typeof content !== 'string') {
      reply.status(400);
      return { error: 'content must be a string' };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const hbPath = join(cladeHome, 'agents', id, 'HEARTBEAT.md');
    writeFileSync(hbPath, content, 'utf-8');
    return { success: true };
  });

  // ── Get agent memory ────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/memory', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const memPath = join(cladeHome, 'agents', id, 'MEMORY.md');
    try {
      const content = readFileSync(memPath, 'utf-8');
      return { agentId: id, content };
    } catch {
      return { agentId: id, content: '' };
    }
  });

  // ── Update agent config (PUT) ───────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    const body = req.body as Record<string, unknown>;
    agents[id] = { ...agents[id], ...body };
    (config as Record<string, unknown>).agents = agents;
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { agent: { id, ...agents[id] } };
  });

  // ── Delete agent ────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;
    const { id } = req.params;
    if (!agents[id]) {
      reply.status(404);
      return { error: `Agent "${id}" not found` };
    }
    delete agents[id];
    (config as Record<string, unknown>).agents = agents;
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  });

  // ── Get full config ─────────────────────────────────────────
  fastify.get('/api/config/full', async () => config);

  // ── Update full config ──────────────────────────────────────
  fastify.put('/api/config', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      reply.status(400);
      return { error: 'Invalid config' };
    }
    Object.assign(config, body);
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  });

  fastify.get('/api/sessions', async () => ({ sessions: [] }));
  fastify.get('/api/skills', async () => ({ skills: [] }));
  fastify.get('/api/channels', async () => ({ channels: [] }));
  fastify.get('/api/cron', async () => ({ jobs: [] }));

  // ── Templates API ──────────────────────────────────────────
  fastify.get('/api/templates', async () => {
    const templates = listTemplates().map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      toolPreset: t.toolPreset,
      model: t.model,
      heartbeat: t.heartbeat,
    }));
    return { templates };
  });

  // ── Agent creation API ─────────────────────────────────────
  fastify.post('/api/agents', async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || !body.name) {
      reply.status(400);
      return { error: 'Agent name is required' };
    }

    const agentName = String(body.name).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;

    if (agents[agentName]) {
      reply.status(409);
      return { error: `Agent "${agentName}" already exists` };
    }

    // Build agent config from template or custom fields
    const templateId = String(body.template || 'coding');
    const isCustom = templateId === 'custom';
    const template = isCustom ? undefined : getTemplate(templateId);
    let agentConfig: Record<string, unknown>;

    // Identity defaults per template type
    const IDENTITY_DEFAULTS: Record<string, { creature: string; vibe: string; emoji: string }> = {
      coding:   { creature: 'Code architect', vibe: 'precise, focused, pragmatic', emoji: '\u{1F4BB}' },
      research: { creature: 'Knowledge seeker', vibe: 'curious, thorough, analytical', emoji: '\u{1F50D}' },
      ops:      { creature: 'System sentinel', vibe: 'vigilant, calm, reliable', emoji: '\u{1F4E1}' },
      pm:       { creature: 'Project navigator', vibe: 'organized, clear, supportive', emoji: '\u{1F4CB}' },
      custom:   { creature: 'AI assistant', vibe: 'helpful, adaptive, thoughtful', emoji: '\u{2728}' },
    };
    const identityDefaults = IDENTITY_DEFAULTS[templateId] || IDENTITY_DEFAULTS['custom'];

    if (template) {
      const built = configFromTemplate(template, {
        name: String(body.description || template.name),
        model: body.model ? String(body.model) : undefined,
      });
      agentConfig = {
        ...built,
        name: body.description || template.name,
        creature: identityDefaults.creature,
        vibe: identityDefaults.vibe,
        emoji: identityDefaults.emoji,
        avatar: '',
      };
    } else {
      // Custom agent — use fields from request body
      const hbEnabled = body.heartbeatEnabled !== undefined ? Boolean(body.heartbeatEnabled) : true;
      const hbInterval = body.heartbeatInterval ? String(body.heartbeatInterval) : '30m';
      agentConfig = {
        name: String(body.description || agentName),
        description: String(body.agentDescription || ''),
        model: String(body.model || 'sonnet'),
        toolPreset: String(body.toolPreset || 'full'),
        customTools: [],
        skills: [],
        heartbeat: { enabled: hbEnabled, interval: hbInterval, mode: 'check', suppressOk: true },
        reflection: { enabled: true, interval: 10 },
        maxTurns: 25,
        notifications: { minSeverity: 'info', batchDigest: false, digestIntervalMinutes: 30 },
        creature: identityDefaults.creature,
        vibe: identityDefaults.vibe,
        emoji: identityDefaults.emoji,
        avatar: '',
      };
    }

    // Create agent directory structure
    const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
    const agentDir = join(cladeHome, 'agents', agentName);
    mkdirSync(join(agentDir, 'memory'), { recursive: true });
    mkdirSync(join(agentDir, 'soul-history'), { recursive: true });

    // Write SOUL.md, MEMORY.md, HEARTBEAT.md
    // Custom agents can provide their own content; templates use seeds; fallback to defaults
    const soulOut = (isCustom && body.soulContent) ? String(body.soulContent) : (template?.soulSeed ?? DEFAULT_SOUL);
    const hbOut = (isCustom && body.heartbeatContent) ? String(body.heartbeatContent) : (template?.heartbeatSeed ?? DEFAULT_HEARTBEAT);
    writeFileSync(join(agentDir, 'SOUL.md'), soulOut, 'utf-8');
    writeFileSync(join(agentDir, 'MEMORY.md'), '# Memory\n\n_Curated knowledge and observations._\n', 'utf-8');
    writeFileSync(join(agentDir, 'HEARTBEAT.md'), hbOut, 'utf-8');

    // Update config.json
    agents[agentName] = agentConfig;
    (config as Record<string, unknown>).agents = agents;
    const configPath = join(cladeHome, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log(`  [ok] Created agent "${agentName}" (${isCustom ? 'custom' : 'template: ' + templateId})`);

    return {
      agent: {
        id: agentName,
        name: agentConfig.name,
        description: agentConfig.description ?? '',
        model: agentConfig.model ?? 'sonnet',
        toolPreset: agentConfig.toolPreset ?? 'full',
      },
    };
  });

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

/**
 * Shared test fixture: spawn a Clade server with temp CLADE_HOME,
 * pre-seeded agents and chat data. Dynamic port allocation, health
 * check polling, cleanup on teardown.
 */
import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface TestServer {
  port: number;
  baseUrl: string;
  cladeHome: string;
  process: ChildProcess;
}

/** Check if `claude` CLI is installed */
export function hasClaudeCli(): boolean {
  try {
    execSync('which claude', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Allocate a random port in the range 18000-19999 (unlikely to collide).
 */
function randomPort(): number {
  return 18000 + Math.floor(Math.random() * 2000);
}

/**
 * Create the test CLADE_HOME directory with pre-seeded data.
 */
function seedTestHome(cladeHome: string, port: number): void {
  // Directory structure
  const dirs = [
    join(cladeHome, 'agents', 'jarvis', 'memory'),
    join(cladeHome, 'agents', 'jarvis', 'soul-history'),
    join(cladeHome, 'agents', 'scout', 'memory'),
    join(cladeHome, 'agents', 'scout', 'soul-history'),
    join(cladeHome, 'data', 'chats'),
    join(cladeHome, 'data', 'uploads'),
    join(cladeHome, 'mcp', 'active'),
    join(cladeHome, 'mcp', 'pending'),
    join(cladeHome, 'skills', 'active'),
    join(cladeHome, 'skills', 'pending'),
    join(cladeHome, 'skills', 'disabled'),
    join(cladeHome, 'logs'),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });

  // Config
  const config = {
    version: 4,
    agents: {
      jarvis: {
        name: 'Jarvis',
        description: 'Primary coding assistant',
        model: 'sonnet',
        toolPreset: 'coding',
        customTools: [],
        mcp: [],
        skills: [],
        heartbeat: { enabled: false, interval: '30m', mode: 'check', suppressOk: true },
        reflection: { enabled: false, interval: 10 },
        maxTurns: 5,
        emoji: '\u{1F4BB}',
      },
      scout: {
        name: 'Scout',
        description: 'Research agent',
        model: 'sonnet',
        toolPreset: 'messaging',
        customTools: [],
        mcp: [],
        skills: [],
        heartbeat: { enabled: true, interval: '15m', mode: 'check', suppressOk: true },
        reflection: { enabled: true, interval: 10 },
        maxTurns: 10,
        emoji: '\u{1F50D}',
      },
    },
    channels: {
      webchat: { enabled: true },
      slack: { enabled: false },
      telegram: { enabled: false },
      discord: { enabled: false },
    },
    gateway: { port, host: '127.0.0.1' },
    routing: { defaultAgent: 'jarvis', rules: [] },
    skills: { autoApprove: [] },
  };
  writeFileSync(join(cladeHome, 'config.json'), JSON.stringify(config, null, 2));

  // Agent SOUL files
  writeFileSync(
    join(cladeHome, 'agents', 'jarvis', 'SOUL.md'),
    '# SOUL.md - Jarvis\n\nYou are Jarvis, a coding assistant. Be concise.\n\n## Core Principles\n- Be helpful\n',
  );
  writeFileSync(
    join(cladeHome, 'agents', 'scout', 'SOUL.md'),
    '# SOUL.md - Scout\n\nYou are Scout, a research agent. Be thorough.\n',
  );

  // Agent MEMORY files
  writeFileSync(
    join(cladeHome, 'agents', 'jarvis', 'MEMORY.md'),
    '# Memory\n\n## User Preferences\n- Prefers TypeScript\n- Uses Vim keybindings\n',
  );
  writeFileSync(
    join(cladeHome, 'agents', 'scout', 'MEMORY.md'),
    '# Memory\n\n_Curated knowledge and observations._\n',
  );

  // Agent HEARTBEAT files
  writeFileSync(
    join(cladeHome, 'agents', 'jarvis', 'HEARTBEAT.md'),
    '# Heartbeat\n\nCheck project status.\n',
  );
  writeFileSync(
    join(cladeHome, 'agents', 'scout', 'HEARTBEAT.md'),
    '# Heartbeat\n\nScan for updates.\n',
  );

  // Daily memory log for jarvis
  const today = new Date().toISOString().split('T')[0];
  writeFileSync(
    join(cladeHome, 'agents', 'jarvis', 'memory', `${today}.md`),
    `# ${today}\n\n- Fixed a TypeScript build issue\n- Discussed refactoring the API layer\n`,
  );

  // Pre-seed an active skill on disk (to test startup scanning)
  const preseededSkillDir = join(cladeHome, 'skills', 'active', 'code-review');
  mkdirSync(preseededSkillDir, { recursive: true });
  writeFileSync(
    join(preseededSkillDir, 'SKILL.md'),
    '# Code Review\n\nReview code for quality, security, and best practices.\n\n- Check for OWASP top 10\n- Verify error handling\n',
  );

  // Pre-seed a chat conversation for jarvis
  const convId = 'conv_test000001';
  const chatData = {
    conversations: {
      [convId]: {
        id: convId,
        agentId: 'jarvis',
        label: 'Test conversation',
        messages: [
          { id: 'msg_u1', agentId: 'jarvis', role: 'user', text: 'Hello Jarvis', timestamp: new Date(Date.now() - 60000).toISOString() },
          { id: 'msg_a1', agentId: 'jarvis', role: 'assistant', text: 'Hello! How can I help?', timestamp: new Date(Date.now() - 50000).toISOString() },
        ],
        createdAt: new Date(Date.now() - 120000).toISOString(),
        lastActiveAt: new Date(Date.now() - 50000).toISOString(),
      },
    },
    order: [convId],
  };
  writeFileSync(join(cladeHome, 'data', 'chats', 'jarvis.json'), JSON.stringify(chatData, null, 2));
}

/**
 * Start the test server, wait for health check, return handle.
 */
export async function startTestServer(): Promise<TestServer> {
  const port = randomPort();
  const cladeHome = join(tmpdir(), `clade-e2e-${randomUUID().slice(0, 8)}`);

  seedTestHome(cladeHome, port);

  const distClade = join(process.cwd(), 'dist', 'bin', 'clade.js');
  if (!existsSync(distClade)) {
    throw new Error(`Built CLI not found at ${distClade}. Run 'npm run build' first.`);
  }

  const child = spawn('node', [distClade, 'start', '--port', String(port), '--host', '127.0.0.1'], {
    env: { ...process.env, CLADE_HOME: cladeHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture output for debugging
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;

  // Poll health endpoint
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return { port, baseUrl, cladeHome, process: child };
      }
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 500));
  }

  child.kill('SIGTERM');
  throw new Error(`Server did not start. stdout: ${stdout.slice(-500)}\nstderr: ${stderr.slice(-500)}`);
}

/**
 * Stop the test server and clean up the temp directory.
 */
export function stopTestServer(server: TestServer): void {
  try { server.process.kill('SIGTERM'); } catch { /* already dead */ }
  try { rmSync(server.cladeHome, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Core backup engine — git operations for auto-backup to GitHub.
// All git commands use async spawn() to avoid blocking the event loop.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('backup');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupResult {
  changed: boolean;
  filesChanged: number;
  commitSha: string;
  pushed: boolean;
  pushError?: string;
}

export interface BackupStatus {
  enabled: boolean;
  repo: string;
  branch: string;
  lastBackupAt?: string;
  lastCommitSha?: string;
  lastError?: string;
  dirty: boolean;
  intervalMinutes: number;
}

export interface BackupHistoryEntry {
  sha: string;
  message: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Mutex to prevent concurrent backup runs
// ---------------------------------------------------------------------------

let backupInProgress = false;

export function isBackupInProgress(): boolean {
  return backupInProgress;
}

// ---------------------------------------------------------------------------
// Async git helper
// ---------------------------------------------------------------------------

/**
 * Run a git command asynchronously via spawn.
 * Returns stdout on success, throws on failure.
 */
function git(args: string[], cwd: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d));

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf-8').trim());
      } else {
        const stderr = Buffer.concat(errChunks).toString('utf-8').trim();
        reject(new Error(`git ${args[0]} exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// .gitignore content
// ---------------------------------------------------------------------------

export function generateGitignore(excludeChats = false): string {
  const lines = [
    '# Clade backup — auto-generated, do not edit',
    '',
    '# Large / machine-specific / regenerable',
    'browser-profile/',
    'logs/',
    'data/uploads/',
    '',
    '# SQLite files (unused in active paths but may exist)',
    '*.db',
    '*.db-wal',
    '*.db-shm',
    '',
    '# MCP server dependencies (reinstallable)',
    'mcp/*/node_modules/',
    '',
    '# OS / temp',
    '.DS_Store',
    'Thumbs.db',
    '*.tmp',
    '*.sock',
    '',
    '# Embedding model cache (large, re-downloadable)',
    'models/',
  ];

  if (excludeChats) {
    lines.push('', '# Chat data excluded by user preference', 'data/chats/');
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Check if git is available
// ---------------------------------------------------------------------------

export async function isGitAvailable(): Promise<boolean> {
  try {
    await git(['--version'], process.cwd(), 5_000);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Check if backup repo is initialized
// ---------------------------------------------------------------------------

export async function isGitInitialized(cladeHome: string): Promise<boolean> {
  if (!existsSync(join(cladeHome, '.git'))) return false;
  try {
    const remotes = await git(['remote', '-v'], cladeHome, 5_000);
    return remotes.includes('origin');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Initialize backup repository
// ---------------------------------------------------------------------------

export async function initBackupRepo(
  cladeHome: string,
  repo: string,
  branch: string,
  excludeChats = false,
): Promise<void> {
  // Check for existing .git that wasn't set up by us
  if (existsSync(join(cladeHome, '.git'))) {
    try {
      const remoteUrl = await git(['remote', 'get-url', 'origin'], cladeHome, 5_000);
      if (!remoteUrl.includes(repo)) {
        throw new Error(
          `~/.clade/.git already exists with a different remote (${remoteUrl}). ` +
          `Remove it manually or use a different repo.`,
        );
      }
      log.info('Backup repo already initialized with correct remote');
      return;
    } catch (err) {
      if ((err as Error).message.includes('already exists')) throw err;
      // No remote set — we'll add it
    }
  }

  // Write .gitignore
  writeFileSync(join(cladeHome, '.gitignore'), generateGitignore(excludeChats), 'utf-8');

  // Init repo if needed
  if (!existsSync(join(cladeHome, '.git'))) {
    await git(['init', '-b', branch], cladeHome);
  }

  // Set remote
  try {
    await git(['remote', 'add', 'origin', `https://github.com/${repo}.git`], cladeHome);
  } catch {
    // Remote may already exist
    await git(['remote', 'set-url', 'origin', `https://github.com/${repo}.git`], cladeHome);
  }

  // Initial commit
  await git(['add', '-A'], cladeHome);
  const status = await git(['status', '--porcelain'], cladeHome);
  if (status) {
    await git(['commit', '-m', 'Initial Clade backup'], cladeHome);
  }

  // Push (with longer timeout for initial push)
  await git(['push', '-u', 'origin', branch], cladeHome, 120_000);

  log.info('Backup repo initialized', { repo, branch });
}

// ---------------------------------------------------------------------------
// Perform a backup
// ---------------------------------------------------------------------------

export async function performBackup(
  cladeHome: string,
  config: { repo: string; branch: string; excludeChats?: boolean },
): Promise<BackupResult> {
  if (backupInProgress) {
    log.warn('Backup already in progress, skipping');
    return { changed: false, filesChanged: 0, commitSha: '', pushed: false };
  }

  backupInProgress = true;
  try {
    if (!existsSync(join(cladeHome, '.git'))) {
      throw new Error('Backup repo not initialized. Run "clade backup setup" first.');
    }

    // Update .gitignore in case settings changed
    writeFileSync(
      join(cladeHome, '.gitignore'),
      generateGitignore(config.excludeChats),
      'utf-8',
    );

    // Stage all changes
    await git(['add', '-A'], cladeHome);

    // Check for changes
    const status = await git(['status', '--porcelain'], cladeHome);
    if (!status) {
      return { changed: false, filesChanged: 0, commitSha: '', pushed: false };
    }

    const filesChanged = status.split('\n').filter(Boolean).length;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const message = `Backup ${timestamp} (${filesChanged} file${filesChanged === 1 ? '' : 's'})`;

    // Commit locally
    await git(['commit', '-m', message], cladeHome);
    const commitSha = await git(['rev-parse', '--short', 'HEAD'], cladeHome);

    // Push (may fail if offline — that's OK, local commit is preserved)
    let pushed = false;
    let pushError: string | undefined;
    try {
      await git(['push', 'origin', config.branch], cladeHome, 120_000);
      pushed = true;
    } catch (err) {
      pushError = (err as Error).message;
      log.warn('Push failed (local commit preserved)', { error: pushError });
    }

    log.info('Backup completed', { filesChanged, commitSha, pushed });
    return { changed: true, filesChanged, commitSha, pushed, pushError };
  } finally {
    backupInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Get backup status
// ---------------------------------------------------------------------------

export async function getBackupStatus(
  cladeHome: string,
  config: {
    enabled: boolean;
    repo: string;
    branch: string;
    intervalMinutes: number;
    lastBackupAt?: string;
    lastCommitSha?: string;
    lastError?: string;
  },
): Promise<BackupStatus> {
  let dirty = false;
  if (existsSync(join(cladeHome, '.git'))) {
    try {
      await git(['add', '-A', '--dry-run'], cladeHome, 5_000);
      const status = await git(['status', '--porcelain'], cladeHome, 5_000);
      dirty = status.length > 0;
    } catch {
      // ignore
    }
  }

  return {
    enabled: config.enabled,
    repo: config.repo,
    branch: config.branch,
    lastBackupAt: config.lastBackupAt,
    lastCommitSha: config.lastCommitSha,
    lastError: config.lastError,
    dirty,
    intervalMinutes: config.intervalMinutes,
  };
}

// ---------------------------------------------------------------------------
// Get backup history from git log
// ---------------------------------------------------------------------------

export async function getBackupHistory(
  cladeHome: string,
  limit = 20,
): Promise<BackupHistoryEntry[]> {
  if (!existsSync(join(cladeHome, '.git'))) return [];

  try {
    const raw = await git(
      ['log', `--max-count=${limit}`, '--format=%h|%s|%aI'],
      cladeHome,
      10_000,
    );
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      const [sha, message, date] = line.split('|');
      return { sha: sha || '', message: message || '', date: date || '' };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Restore from GitHub
// ---------------------------------------------------------------------------

export async function restoreFromGitHub(
  repo: string,
  branch: string,
  targetDir: string,
  dryRun = false,
): Promise<{ filesRestored: number; backupDir?: string }> {
  // Clone to temp dir
  const tempDir = join(tmpdir(), `clade-restore-${randomUUID().slice(0, 8)}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    await git(
      ['clone', '--branch', branch, '--depth', '1', `https://github.com/${repo}.git`, tempDir],
      tmpdir(),
      120_000,
    );

    // Validate structure
    if (!existsSync(join(tempDir, 'config.json'))) {
      throw new Error('Invalid backup: missing config.json');
    }
    if (!existsSync(join(tempDir, 'agents'))) {
      throw new Error('Invalid backup: missing agents/ directory');
    }

    if (dryRun) {
      const { readdirSync } = await import('node:fs');
      const count = readdirSync(tempDir).filter((f) => f !== '.git').length;
      return { filesRestored: count };
    }

    // Safety backup of current data
    const timestamp = Date.now();
    const backupDir = `${targetDir}-backup-${timestamp}`;
    if (existsSync(targetDir)) {
      renameSync(targetDir, backupDir);
      log.info('Existing data backed up', { backupDir });
    }

    // Copy restored files (exclude .git)
    mkdirSync(targetDir, { recursive: true });
    const { readdirSync } = await import('node:fs');
    const entries = readdirSync(tempDir);
    let count = 0;
    for (const entry of entries) {
      if (entry === '.git') continue;
      cpSync(join(tempDir, entry), join(targetDir, entry), { recursive: true });
      count++;
    }

    log.info('Restore completed', { filesRestored: count, backupDir });
    return { filesRestored: count, backupDir };
  } finally {
    // Clean up temp dir
    try {
      const { rmSync } = await import('node:fs');
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

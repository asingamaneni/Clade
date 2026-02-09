// ---------------------------------------------------------------------------
// Tests: Backup system (git-based auto-backup)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

import {
  generateGitignore,
  isGitAvailable,
  isGitInitialized,
  performBackup,
  getBackupHistory,
  getBackupStatus,
  isBackupInProgress,
} from '../../src/backup/backup.js';
import { migrateConfig, currentSchemaVersion } from '../../src/config/migrations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a bare git repo that can be used as a local remote, and
 * initialise a working repo that pushes to it.
 * Returns { workDir, remoteDir }.
 */
function initLocalGitPair(branch = 'main'): { workDir: string; remoteDir: string } {
  const remoteDir = makeTempDir('clade-test-remote');
  execSync(`git init --bare`, { cwd: remoteDir, stdio: 'pipe' });

  const workDir = makeTempDir('clade-test-work');
  execSync('git init', { cwd: workDir, stdio: 'pipe' });
  execSync('git config user.email "test@clade.dev"', { cwd: workDir, stdio: 'pipe' });
  execSync('git config user.name "Clade Test"', { cwd: workDir, stdio: 'pipe' });
  execSync(`git checkout -b ${branch}`, { cwd: workDir, stdio: 'pipe' });
  execSync(`git remote add origin file://${remoteDir}`, { cwd: workDir, stdio: 'pipe' });

  // Seed an initial commit + push so the branch exists on the remote
  writeFileSync(join(workDir, 'config.json'), '{}', 'utf-8');
  writeFileSync(join(workDir, '.gitignore'), generateGitignore(), 'utf-8');
  execSync('git add -A', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "seed"', { cwd: workDir, stdio: 'pipe' });
  execSync(`git push -u origin ${branch}`, { cwd: workDir, stdio: 'pipe' });

  return { workDir, remoteDir };
}

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------

const dirsToClean: string[] = [];

afterEach(() => {
  for (const d of dirsToClean) {
    if (existsSync(d)) {
      rmSync(d, { recursive: true, force: true });
    }
  }
  dirsToClean.length = 0;
});

// ---------------------------------------------------------------------------
// generateGitignore
// ---------------------------------------------------------------------------

describe('generateGitignore', () => {
  it('should include core exclusion patterns', () => {
    const content = generateGitignore();
    expect(content).toContain('browser-profile/');
    expect(content).toContain('logs/');
    expect(content).toContain('*.db');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.DS_Store');
    expect(content).toContain('models/');
  });

  it('should NOT include data/chats/ by default', () => {
    const content = generateGitignore();
    expect(content).not.toContain('data/chats/');
  });

  it('should include data/chats/ when excludeChats is true', () => {
    const content = generateGitignore(true);
    expect(content).toContain('data/chats/');
  });

  it('should end with a trailing newline', () => {
    const content = generateGitignore();
    expect(content.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isGitAvailable
// ---------------------------------------------------------------------------

describe('isGitAvailable', () => {
  it('should return true in the test environment', async () => {
    const available = await isGitAvailable();
    expect(available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isGitInitialized
// ---------------------------------------------------------------------------

describe('isGitInitialized', () => {
  it('should return false for a plain directory (no .git)', async () => {
    const dir = makeTempDir('clade-test-nongit');
    dirsToClean.push(dir);
    const result = await isGitInitialized(dir);
    expect(result).toBe(false);
  });

  it('should return false for a git repo without an origin remote', async () => {
    const dir = makeTempDir('clade-test-norepo');
    dirsToClean.push(dir);
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    const result = await isGitInitialized(dir);
    expect(result).toBe(false);
  });

  it('should return true for a git repo with an origin remote', async () => {
    const { workDir, remoteDir } = initLocalGitPair();
    dirsToClean.push(workDir, remoteDir);
    const result = await isGitInitialized(workDir);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// performBackup
// ---------------------------------------------------------------------------

describe('performBackup', () => {
  let workDir: string;
  let remoteDir: string;

  beforeEach(() => {
    const pair = initLocalGitPair();
    workDir = pair.workDir;
    remoteDir = pair.remoteDir;
    dirsToClean.push(workDir, remoteDir);
  });

  it('should commit and push new changes', async () => {
    // Write a new file to create a change
    mkdirSync(join(workDir, 'agents'), { recursive: true });
    writeFileSync(join(workDir, 'agents', 'test.txt'), 'hello', 'utf-8');

    const result = await performBackup(workDir, {
      repo: 'test/repo',
      branch: 'main',
    });

    expect(result.changed).toBe(true);
    expect(result.filesChanged).toBeGreaterThan(0);
    expect(result.commitSha).toBeTruthy();
    expect(result.pushed).toBe(true);
    expect(result.pushError).toBeUndefined();
  });

  it('should return changed: false when there are no new changes', async () => {
    const result = await performBackup(workDir, {
      repo: 'test/repo',
      branch: 'main',
    });

    expect(result.changed).toBe(false);
    expect(result.filesChanged).toBe(0);
    expect(result.commitSha).toBe('');
  });

  it('should handle push failures gracefully (dummy remote)', async () => {
    // Re-point origin to a non-existent remote to force push failure
    execSync('git remote set-url origin https://github.com/nonexistent/repo.git', {
      cwd: workDir,
      stdio: 'pipe',
    });

    writeFileSync(join(workDir, 'new-file.txt'), 'content', 'utf-8');

    const result = await performBackup(workDir, {
      repo: 'nonexistent/repo',
      branch: 'main',
    });

    expect(result.changed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeDefined();
    // Local commit should still be there
    expect(result.commitSha).toBeTruthy();
  });

  it('should throw if .git directory is missing', async () => {
    const plainDir = makeTempDir('clade-test-nogit');
    dirsToClean.push(plainDir);

    await expect(
      performBackup(plainDir, { repo: 'test/repo', branch: 'main' }),
    ).rejects.toThrow('not initialized');
  });

  it('should update .gitignore based on excludeChats option', async () => {
    writeFileSync(join(workDir, 'something.txt'), 'data', 'utf-8');

    await performBackup(workDir, {
      repo: 'test/repo',
      branch: 'main',
      excludeChats: true,
    });

    const gitignore = readFileSync(join(workDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('data/chats/');
  });
});

// ---------------------------------------------------------------------------
// isBackupInProgress
// ---------------------------------------------------------------------------

describe('isBackupInProgress', () => {
  it('should return false when no backup is running', () => {
    expect(isBackupInProgress()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getBackupHistory
// ---------------------------------------------------------------------------

describe('getBackupHistory', () => {
  it('should return empty array for a non-git directory', async () => {
    const dir = makeTempDir('clade-test-nongit');
    dirsToClean.push(dir);
    const history = await getBackupHistory(dir);
    expect(history).toEqual([]);
  });

  it('should return commit entries from a git repo', async () => {
    const { workDir, remoteDir } = initLocalGitPair();
    dirsToClean.push(workDir, remoteDir);

    // The seed commit is 1; add 2 more
    writeFileSync(join(workDir, 'file1.txt'), 'a', 'utf-8');
    execSync('git add -A && git commit -m "backup-1"', { cwd: workDir, stdio: 'pipe' });

    writeFileSync(join(workDir, 'file2.txt'), 'b', 'utf-8');
    execSync('git add -A && git commit -m "backup-2"', { cwd: workDir, stdio: 'pipe' });

    writeFileSync(join(workDir, 'file3.txt'), 'c', 'utf-8');
    execSync('git add -A && git commit -m "backup-3"', { cwd: workDir, stdio: 'pipe' });

    const history = await getBackupHistory(workDir);
    expect(history.length).toBe(4); // seed + 3
    // Most recent first
    expect(history[0]!.message).toBe('backup-3');
    expect(history[1]!.message).toBe('backup-2');
    expect(history[2]!.message).toBe('backup-1');

    // Each entry should have sha, message, date
    for (const entry of history) {
      expect(entry.sha).toBeTruthy();
      expect(entry.message).toBeTruthy();
      expect(entry.date).toBeTruthy();
    }
  });

  it('should respect the limit parameter', async () => {
    const { workDir, remoteDir } = initLocalGitPair();
    dirsToClean.push(workDir, remoteDir);

    for (let i = 0; i < 5; i++) {
      writeFileSync(join(workDir, `file-${i}.txt`), String(i), 'utf-8');
      execSync(`git add -A && git commit -m "commit-${i}"`, { cwd: workDir, stdio: 'pipe' });
    }

    const history = await getBackupHistory(workDir, 3);
    expect(history.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getBackupStatus
// ---------------------------------------------------------------------------

describe('getBackupStatus', () => {
  it('should return correct shape with dirty flag for a clean repo', async () => {
    const { workDir, remoteDir } = initLocalGitPair();
    dirsToClean.push(workDir, remoteDir);

    const status = await getBackupStatus(workDir, {
      enabled: true,
      repo: 'user/repo',
      branch: 'main',
      intervalMinutes: 30,
    });

    expect(status.enabled).toBe(true);
    expect(status.repo).toBe('user/repo');
    expect(status.branch).toBe('main');
    expect(status.intervalMinutes).toBe(30);
    expect(status.dirty).toBe(false);
  });

  it('should report dirty: true when there are uncommitted changes', async () => {
    const { workDir, remoteDir } = initLocalGitPair();
    dirsToClean.push(workDir, remoteDir);

    writeFileSync(join(workDir, 'dirty-file.txt'), 'uncommitted', 'utf-8');

    const status = await getBackupStatus(workDir, {
      enabled: true,
      repo: 'user/repo',
      branch: 'main',
      intervalMinutes: 15,
    });

    expect(status.dirty).toBe(true);
  });

  it('should pass through optional fields from config', async () => {
    const dir = makeTempDir('clade-test-status');
    dirsToClean.push(dir);

    const status = await getBackupStatus(dir, {
      enabled: false,
      repo: '',
      branch: 'main',
      intervalMinutes: 60,
      lastBackupAt: '2025-01-01T00:00:00Z',
      lastCommitSha: 'abc1234',
      lastError: 'push failed',
    });

    expect(status.enabled).toBe(false);
    expect(status.lastBackupAt).toBe('2025-01-01T00:00:00Z');
    expect(status.lastCommitSha).toBe('abc1234');
    expect(status.lastError).toBe('push failed');
  });
});

// ---------------------------------------------------------------------------
// Config Migration v4 → v5
// ---------------------------------------------------------------------------

describe('Config Migration v4 → v5 (backup)', () => {
  it('should report current schema version as 5', () => {
    expect(currentSchemaVersion()).toBe(5);
  });

  it('should add backup config with defaults when migrating from v4', () => {
    const v4Config: Record<string, unknown> = {
      version: 4,
      agents: {
        main: { name: 'Main', skills: ['git-workflow'], mcp: ['memory'] },
      },
      skills: { autoApprove: ['git-workflow'] },
      mcp: { autoApprove: [] },
    };

    const { config, applied } = migrateConfig(v4Config);
    expect(config.version).toBe(5);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('backup');

    const backup = config.backup as Record<string, unknown>;
    expect(backup).toBeDefined();
    expect(backup.enabled).toBe(false);
    expect(backup.repo).toBe('');
    expect(backup.branch).toBe('main');
    expect(backup.intervalMinutes).toBe(30);
    expect(backup.excludeChats).toBe(false);
  });

  it('should not overwrite existing backup config', () => {
    const configWithBackup: Record<string, unknown> = {
      version: 4,
      backup: {
        enabled: true,
        repo: 'my/repo',
        branch: 'backup',
        intervalMinutes: 15,
        excludeChats: true,
      },
    };

    const { config } = migrateConfig(configWithBackup);
    const backup = config.backup as Record<string, unknown>;
    expect(backup.enabled).toBe(true);
    expect(backup.repo).toBe('my/repo');
    expect(backup.branch).toBe('backup');
    expect(backup.intervalMinutes).toBe(15);
    expect(backup.excludeChats).toBe(true);
  });

  it('should not re-migrate an already v5 config', () => {
    const v5Config: Record<string, unknown> = {
      version: 5,
      backup: {
        enabled: true,
        repo: 'user/repo',
        branch: 'main',
        intervalMinutes: 30,
        excludeChats: false,
      },
    };

    const { config, applied } = migrateConfig(v5Config);
    expect(applied).toHaveLength(0);
    expect(config.version).toBe(5);
  });

  it('should migrate from v1 all the way through v5', () => {
    const v1Config: Record<string, unknown> = {
      agents: {
        old: { name: 'Old Agent' },
      },
    };

    const { config, applied } = migrateConfig(v1Config);
    expect(config.version).toBe(5);
    expect(applied.length).toBeGreaterThanOrEqual(4);

    // Should have backup at root level
    const backup = config.backup as Record<string, unknown>;
    expect(backup).toBeDefined();
    expect(backup.enabled).toBe(false);

    // Skills should also be present (from v3->v4)
    expect(config.skills).toEqual({ autoApprove: [] });
  });
});

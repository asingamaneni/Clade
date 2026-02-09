import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Command } from 'commander';
import {
  isGitAvailable,
  initBackupRepo,
  performBackup,
  getBackupStatus,
  getBackupHistory,
  restoreFromGitHub,
} from '../../backup/backup.js';

const CLADE_HOME = process.env['CLADE_HOME'] || join(homedir(), '.clade');
const CONFIG_PATH = join(CLADE_HOME, 'config.json');

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>): void {
  mkdirSync(CLADE_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Register CLI command
// ---------------------------------------------------------------------------

export function registerBackupCommand(program: Command): void {
  const backup = program
    .command('backup')
    .description('Back up and restore Clade data via GitHub');

  // ── clade backup setup ──────────────────────────────────────────────
  backup
    .command('setup')
    .description('Initialize backup to a GitHub repository')
    .requiredOption('--repo <owner/repo>', 'GitHub repository (e.g. user/clade-backup)')
    .option('--branch <branch>', 'Git branch to use', 'main')
    .option('--interval <minutes>', 'Auto-backup interval in minutes', '30')
    .action(
      async (opts: { repo: string; branch: string; interval: string }) => {
        try {
          const gitOk = await isGitAvailable();
          if (!gitOk) {
            console.error('Error: git is not installed or not in PATH.');
            process.exit(1);
          }

          const config = loadConfig();

          console.log(`Initializing backup repo: ${opts.repo} (branch: ${opts.branch})...`);
          await initBackupRepo(CLADE_HOME, opts.repo, opts.branch);

          const intervalMinutes = parseInt(opts.interval, 10) || 30;

          config['backup'] = {
            ...(typeof config['backup'] === 'object' && config['backup'] !== null
              ? config['backup']
              : {}),
            enabled: true,
            repo: opts.repo,
            branch: opts.branch,
            intervalMinutes,
          };
          saveConfig(config);

          console.log('\nBackup setup complete!');
          console.log(`  Repository: ${opts.repo}`);
          console.log(`  Branch:     ${opts.branch}`);
          console.log(`  Interval:   every ${intervalMinutes} minutes`);
          console.log('\nRun "clade backup now" to trigger a backup manually.');
        } catch (err: unknown) {
          console.error('Error:', err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  // ── clade backup now ────────────────────────────────────────────────
  backup
    .command('now')
    .description('Run an immediate backup')
    .action(async () => {
      try {
        const config = loadConfig();
        const bc = config['backup'] as Record<string, unknown> | undefined;

        if (!bc || !bc['enabled']) {
          console.error('Backup is not enabled. Run "clade backup setup" first.');
          process.exit(1);
        }

        console.log('Running backup...');
        const result = await performBackup(CLADE_HOME, {
          repo: bc['repo'] as string,
          branch: bc['branch'] as string,
          excludeChats: bc['excludeChats'] as boolean | undefined,
        });

        if (!result.changed) {
          console.log('No changes to back up.');
          return;
        }

        // Update config with result metadata
        bc['lastBackupAt'] = new Date().toISOString();
        bc['lastCommitSha'] = result.commitSha;
        delete bc['lastError'];
        saveConfig(config);

        console.log(`\nBackup complete!`);
        console.log(`  Files changed: ${result.filesChanged}`);
        console.log(`  Commit:        ${result.commitSha}`);
        console.log(`  Pushed:        ${result.pushed ? 'yes' : 'no (local only)'}`);
        if (result.pushError) {
          console.log(`  Push error:    ${result.pushError}`);
        }
      } catch (err: unknown) {
        // Record error in config
        try {
          const config = loadConfig();
          const bc = config['backup'] as Record<string, unknown> | undefined;
          if (bc) {
            bc['lastError'] = err instanceof Error ? err.message : String(err);
            saveConfig(config);
          }
        } catch { /* ignore config save errors */ }

        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── clade backup restore ────────────────────────────────────────────
  backup
    .command('restore')
    .description('Restore Clade data from a GitHub backup')
    .requiredOption('--repo <owner/repo>', 'GitHub repository to restore from')
    .option('--branch <branch>', 'Git branch to restore from', 'main')
    .option('--dry-run', 'Show what would be restored without making changes')
    .action(
      async (opts: { repo: string; branch: string; dryRun?: boolean }) => {
        try {
          console.log(
            opts.dryRun
              ? `Dry-run restore from ${opts.repo} (${opts.branch})...`
              : `Restoring from ${opts.repo} (${opts.branch})...`,
          );

          const result = await restoreFromGitHub(
            opts.repo,
            opts.branch,
            CLADE_HOME,
            opts.dryRun,
          );

          if (opts.dryRun) {
            console.log(`\nDry run: ${result.filesRestored} top-level entries would be restored.`);
            console.log('Run without --dry-run to apply.');
          } else {
            console.log(`\nRestore complete!`);
            console.log(`  Entries restored: ${result.filesRestored}`);
            if (result.backupDir) {
              console.log(`  Previous data:    ${result.backupDir}`);
            }
            console.log('\nRestart Clade with "clade start" to use the restored data.');
          }
        } catch (err: unknown) {
          console.error('Error:', err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  // ── clade backup status ─────────────────────────────────────────────
  backup
    .command('status')
    .description('Show current backup status')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const config = loadConfig();
        const bc = (config['backup'] || {}) as Record<string, unknown>;

        const status = await getBackupStatus(CLADE_HOME, {
          enabled: (bc['enabled'] as boolean) || false,
          repo: (bc['repo'] as string) || '',
          branch: (bc['branch'] as string) || 'main',
          intervalMinutes: (bc['intervalMinutes'] as number) || 30,
          lastBackupAt: bc['lastBackupAt'] as string | undefined,
          lastCommitSha: bc['lastCommitSha'] as string | undefined,
          lastError: bc['lastError'] as string | undefined,
        });

        if (opts.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        console.log('\n  Backup Status\n');
        console.log(`  Enabled:        ${status.enabled ? 'yes' : 'no'}`);
        console.log(`  Repository:     ${status.repo || '(not configured)'}`);
        console.log(`  Branch:         ${status.branch}`);
        console.log(`  Interval:       every ${status.intervalMinutes} minutes`);
        console.log(`  Pending changes:${status.dirty ? ' yes' : ' no'}`);
        if (status.lastBackupAt) {
          console.log(`  Last backup:    ${status.lastBackupAt}`);
        }
        if (status.lastCommitSha) {
          console.log(`  Last commit:    ${status.lastCommitSha}`);
        }
        if (status.lastError) {
          console.log(`  Last error:     ${status.lastError}`);
        }
        console.log('');
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── clade backup history ────────────────────────────────────────────
  backup
    .command('history')
    .description('Show backup commit history')
    .option('-n, --count <n>', 'Number of entries to show', '10')
    .action(async (opts: { count: string }) => {
      try {
        const limit = parseInt(opts.count, 10) || 10;
        const entries = await getBackupHistory(CLADE_HOME, limit);

        if (entries.length === 0) {
          console.log('No backup history found.');
          return;
        }

        console.log('\n  Backup History\n');
        console.log(`  ${'SHA'.padEnd(10)} ${'DATE'.padEnd(26)} MESSAGE`);
        console.log(`  ${'---'.padEnd(10)} ${'----'.padEnd(26)} -------`);
        for (const entry of entries) {
          const date = entry.date ? new Date(entry.date).toLocaleString() : '';
          console.log(`  ${entry.sha.padEnd(10)} ${date.padEnd(26)} ${entry.message}`);
        }
        console.log('');
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── clade backup disable ────────────────────────────────────────────
  backup
    .command('disable')
    .description('Disable automatic backups')
    .action(async () => {
      try {
        const config = loadConfig();
        const bc = config['backup'] as Record<string, unknown> | undefined;

        if (!bc || !bc['enabled']) {
          console.log('Backup is already disabled.');
          return;
        }

        bc['enabled'] = false;
        saveConfig(config);

        console.log('Automatic backups disabled.');
        console.log('Run "clade backup setup" to re-enable.');
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

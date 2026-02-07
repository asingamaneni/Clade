// ---------------------------------------------------------------------------
// Cron job scheduler
//
// Manages recurring scheduled tasks that send prompts to agents at
// configurable intervals using standard cron expressions. Jobs are persisted
// in SQLite and survive gateway restarts.
// ---------------------------------------------------------------------------

import { CronJob } from 'cron';
import type { Store, CronJobRow } from '../store/sqlite.js';
import type { SessionManager } from '../engine/manager.js';
import type { ChannelAdapter } from '../channels/base.js';
import { createLogger } from '../utils/logger.js';
import { logActivity } from '../utils/activity.js';

const logger = createLogger('cron');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJobConfig {
  id?: number;
  name: string;
  // Standard cron expression, e.g. "*/15 * * * *".
  schedule: string;
  /** Agent to send the prompt to. */
  agentId: string;
  /** The prompt text to send to the agent on each run. */
  prompt: string;
  /** Optional delivery target: "slack:#general" or "telegram:12345". */
  deliverTo?: string | null;
  /** Whether the job is enabled. */
  enabled: boolean;
  /** IANA timezone for schedule evaluation (default: "UTC"). */
  timezone?: string;
  /** ISO timestamp of last execution. */
  lastRunAt?: string | null;
}

// ---------------------------------------------------------------------------
// CronScheduler
// ---------------------------------------------------------------------------

export class CronScheduler {
  private jobs: Map<string, CronJob> = new Map();

  constructor(
    private store: Store,
    private sessionManager: SessionManager,
    private channels: Map<string, ChannelAdapter>,
  ) {}

  /**
   * Load all enabled cron jobs from the database and start them.
   * Call this once at gateway startup.
   */
  start(): void {
    const rows = this.store.listCronJobs({ enabled: true });
    for (const row of rows) {
      this.scheduleFromRow(row);
    }
    logger.info(`Started ${this.jobs.size} cron jobs`);
  }

  /**
   * Stop all running cron jobs. Call on shutdown.
   */
  stop(): void {
    for (const [name, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
    logger.info('All cron jobs stopped');
  }

  /**
   * Schedule a single job from a database row.
   * If a job with the same name is already running, it is stopped first.
   */
  private scheduleFromRow(row: CronJobRow): void {
    const name = row.name;

    // Stop existing job with this name if any
    const existing = this.jobs.get(name);
    if (existing) {
      existing.stop();
    }

    try {
      const job = new CronJob(
        row.schedule,
        async () => {
          await this.executeJob(row);
        },
        null,   // onComplete
        true,   // start immediately
        'UTC',  // timezone (the store schema doesn't persist timezone, default UTC)
      );

      this.jobs.set(name, job);
      logger.debug('Scheduled cron job', { name, schedule: row.schedule });
    } catch (err) {
      logger.error(`Failed to schedule cron job "${name}":`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Execute a single cron job: send the prompt to the agent and optionally
   * deliver the result to a channel.
   */
  private async executeJob(row: CronJobRow): Promise<void> {
    logger.info(`Executing cron job: ${row.name}`, { agent: row.agent_id });

    try {
      const result = await this.sessionManager.sendMessage(
        row.agent_id,
        row.prompt,
      );

      // Update last run timestamp
      this.store.updateCronJobLastRun(row.id);

      // Log to activity feed
      logActivity({
        type: 'cron',
        agentId: row.agent_id,
        title: `Cron: ${row.name}`,
        description: result.text.slice(0, 200),
      });

      // Deliver result if a delivery target is configured
      if (row.deliver_to) {
        await this.deliverResult(row.deliver_to, result.text);
      }
    } catch (err) {
      logger.error(`Cron job "${row.name}" failed:`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Parse a delivery target string ("channel:target") and send the text
   * to the appropriate channel adapter.
   */
  private async deliverResult(
    deliverTo: string,
    text: string,
  ): Promise<void> {
    const colonIndex = deliverTo.indexOf(':');
    if (colonIndex === -1) return;

    const channelName = deliverTo.slice(0, colonIndex);
    const target = deliverTo.slice(colonIndex + 1);

    if (!channelName || !target) return;

    const adapter = this.channels.get(channelName);
    if (adapter && adapter.isConnected()) {
      try {
        await adapter.sendMessage(target, text);
      } catch (err) {
        logger.error(`Failed to deliver cron result to ${deliverTo}:`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.warn(`Channel "${channelName}" not available for delivery`);
    }
  }

  // -------------------------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------------------------

  /**
   * Add a new cron job. Persists to the database and starts immediately
   * if enabled.
   */
  addJob(config: CronJobConfig): CronJobRow {
    const row = this.store.createCronJob({
      name: config.name,
      schedule: config.schedule,
      agentId: config.agentId,
      prompt: config.prompt,
      deliverTo: config.deliverTo ?? undefined,
    });

    if (config.enabled) {
      this.scheduleFromRow(row);
    }

    logger.info('Added cron job', { name: config.name });
    return row;
  }

  /**
   * Remove a cron job by name. Stops the job and deletes from the database.
   */
  removeJob(name: string): boolean {
    const existing = this.jobs.get(name);
    if (existing) {
      existing.stop();
      this.jobs.delete(name);
    }

    const deleted = this.store.deleteCronJobByName(name);
    if (deleted) {
      logger.info('Removed cron job', { name });
    }
    return deleted;
  }

  /**
   * Enable a cron job. Starts it if not already running.
   */
  enableJob(name: string): void {
    const row = this.store.getCronJobByName(name);
    if (row) {
      this.store.enableCronJob(row.id);
      this.scheduleFromRow({ ...row, enabled: 1 });
      logger.info('Enabled cron job', { name });
    }
  }

  /**
   * Disable a cron job. Stops it if running.
   */
  disableJob(name: string): void {
    const row = this.store.getCronJobByName(name);
    if (row) {
      this.store.disableCronJob(row.id);
      const existing = this.jobs.get(name);
      if (existing) {
        existing.stop();
        this.jobs.delete(name);
      }
      logger.info('Disabled cron job', { name });
    }
  }

  /**
   * List all cron jobs with their next scheduled run time.
   */
  listJobs(): Array<
    CronJobConfig & { nextRun?: Date; lastRunAt?: string | null }
  > {
    const rows = this.store.listCronJobs();
    return rows.map((row) => {
      const activeJob = this.jobs.get(row.name);
      let nextRun: Date | undefined;
      if (activeJob) {
        try {
          nextRun = activeJob.nextDate().toJSDate();
        } catch {
          // Job may not have a valid next date
        }
      }
      return {
        id: row.id,
        name: row.name,
        schedule: row.schedule,
        agentId: row.agent_id,
        prompt: row.prompt,
        deliverTo: row.deliver_to,
        enabled: row.enabled === 1,
        timezone: 'UTC',
        lastRunAt: row.last_run_at,
        nextRun,
      };
    });
  }

  /**
   * Get the count of currently active (running) jobs.
   */
  getActiveJobCount(): number {
    return this.jobs.size;
  }

  /**
   * Check if a specific job is currently scheduled and running.
   */
  isJobActive(name: string): boolean {
    return this.jobs.has(name);
  }
}

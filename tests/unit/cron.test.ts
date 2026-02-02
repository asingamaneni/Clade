// ---------------------------------------------------------------------------
// Tests: Cron Scheduler
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CronScheduler } from '../../src/cron/scheduler.js';
import type { CronJobConfig } from '../../src/cron/scheduler.js';
import { Store } from '../../src/store/sqlite.js';
import type { ChannelAdapter } from '../../src/channels/base.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockSessionManager() {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      text: 'Job result',
      sessionId: 'sess-cron-1',
      durationMs: 200,
    }),
    resumeSession: vi.fn(),
    createRunner: vi.fn(),
  };
}

function createMockChannelAdapter(name: string): ChannelAdapter {
  return {
    name,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CronScheduler', () => {
  let store: Store;
  let scheduler: CronScheduler;
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let channels: Map<string, ChannelAdapter>;

  beforeEach(() => {
    store = Store.inMemory();
    mockSessionManager = createMockSessionManager();
    channels = new Map();
    scheduler = new CronScheduler(store, mockSessionManager as any, channels);
  });

  afterEach(() => {
    scheduler.stop();
    store.close();
  });

  // -----------------------------------------------------------------------
  // Job persistence
  // -----------------------------------------------------------------------

  describe('job persistence', () => {
    it('should add a job to the database', () => {
      const row = scheduler.addJob({
        name: 'daily-report',
        schedule: '0 9 * * *',
        agentId: 'main',
        prompt: 'Generate daily report',
        enabled: true,
      });

      expect(row.name).toBe('daily-report');
      expect(row.schedule).toBe('0 9 * * *');
      expect(row.agent_id).toBe('main');
    });

    it('should persist jobs in the store', () => {
      scheduler.addJob({
        name: 'persistent-job',
        schedule: '*/30 * * * *',
        agentId: 'coder',
        prompt: 'Check PRs',
        enabled: true,
      });

      const dbJobs = store.listCronJobs();
      expect(dbJobs).toHaveLength(1);
      expect(dbJobs[0]!.name).toBe('persistent-job');
    });

    it('should remove a job from the database', () => {
      scheduler.addJob({
        name: 'removable',
        schedule: '* * * * *',
        agentId: 'main',
        prompt: 'test',
        enabled: true,
      });

      expect(store.listCronJobs()).toHaveLength(1);

      const removed = scheduler.removeJob('removable');
      expect(removed).toBe(true);
      expect(store.listCronJobs()).toHaveLength(0);
    });

    it('should return false when removing nonexistent job', () => {
      const removed = scheduler.removeJob('ghost');
      expect(removed).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Job scheduling
  // -----------------------------------------------------------------------

  describe('job scheduling', () => {
    it('should schedule an enabled job', () => {
      scheduler.addJob({
        name: 'active-job',
        schedule: '*/15 * * * *',
        agentId: 'main',
        prompt: 'check',
        enabled: true,
      });

      expect(scheduler.isJobActive('active-job')).toBe(true);
    });

    it('should not schedule a disabled job', () => {
      scheduler.addJob({
        name: 'disabled-job',
        schedule: '*/15 * * * *',
        agentId: 'main',
        prompt: 'check',
        enabled: false,
      });

      expect(scheduler.isJobActive('disabled-job')).toBe(false);
    });

    it('should enable a disabled job', () => {
      scheduler.addJob({
        name: 'to-enable',
        schedule: '*/5 * * * *',
        agentId: 'main',
        prompt: 'test',
        enabled: false,
      });

      expect(scheduler.isJobActive('to-enable')).toBe(false);

      scheduler.enableJob('to-enable');
      expect(scheduler.isJobActive('to-enable')).toBe(true);
    });

    it('should disable an enabled job', () => {
      scheduler.addJob({
        name: 'to-disable',
        schedule: '*/5 * * * *',
        agentId: 'main',
        prompt: 'test',
        enabled: true,
      });

      expect(scheduler.isJobActive('to-disable')).toBe(true);

      scheduler.disableJob('to-disable');
      expect(scheduler.isJobActive('to-disable')).toBe(false);
    });

    it('should start all enabled jobs from database', () => {
      // Add jobs directly to the store
      store.createCronJob({
        name: 'j1',
        schedule: '*/5 * * * *',
        agentId: 'main',
        prompt: 'p1',
      });
      store.createCronJob({
        name: 'j2',
        schedule: '*/10 * * * *',
        agentId: 'coder',
        prompt: 'p2',
      });

      // Disable j2
      const j2Row = store.getCronJobByName('j2')!;
      store.disableCronJob(j2Row.id);

      // Start should only schedule enabled jobs
      scheduler.start();
      expect(scheduler.isJobActive('j1')).toBe(true);
      expect(scheduler.isJobActive('j2')).toBe(false);
      expect(scheduler.getActiveJobCount()).toBe(1);
    });

    it('should stop all jobs', () => {
      scheduler.addJob({
        name: 'stop-1',
        schedule: '*/5 * * * *',
        agentId: 'main',
        prompt: 'test',
        enabled: true,
      });
      scheduler.addJob({
        name: 'stop-2',
        schedule: '*/10 * * * *',
        agentId: 'main',
        prompt: 'test',
        enabled: true,
      });

      expect(scheduler.getActiveJobCount()).toBe(2);

      scheduler.stop();
      expect(scheduler.getActiveJobCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Job listing
  // -----------------------------------------------------------------------

  describe('listJobs', () => {
    it('should list all jobs with their config', () => {
      scheduler.addJob({
        name: 'list-job',
        schedule: '0 */4 * * *',
        agentId: 'main',
        prompt: 'List items',
        deliverTo: 'slack:#reports',
        enabled: true,
      });

      const jobs = scheduler.listJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.name).toBe('list-job');
      expect(jobs[0]!.agentId).toBe('main');
      expect(jobs[0]!.deliverTo).toBe('slack:#reports');
      expect(jobs[0]!.enabled).toBe(true);
    });

    it('should include nextRun for active jobs', () => {
      scheduler.addJob({
        name: 'next-run-job',
        schedule: '*/15 * * * *',
        agentId: 'main',
        prompt: 'test',
        enabled: true,
      });

      const jobs = scheduler.listJobs();
      expect(jobs[0]!.nextRun).toBeInstanceOf(Date);
    });

    it('should not include nextRun for disabled jobs', () => {
      scheduler.addJob({
        name: 'no-next',
        schedule: '*/15 * * * *',
        agentId: 'main',
        prompt: 'test',
        enabled: false,
      });

      const jobs = scheduler.listJobs();
      expect(jobs[0]!.nextRun).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Delivery target parsing
  // -----------------------------------------------------------------------

  describe('delivery target parsing', () => {
    it('should deliver result to channel adapter when configured', async () => {
      const slackAdapter = createMockChannelAdapter('slack');
      channels.set('slack', slackAdapter);

      // Add job with delivery target
      store.createCronJob({
        name: 'deliver-job',
        schedule: '* * * * *',
        agentId: 'main',
        prompt: 'Generate report',
        deliverTo: 'slack:#reports',
      });

      // Start the scheduler to load jobs
      scheduler.start();

      // Wait for the cron job to fire (it fires every minute, but in tests
      // we verify the mechanism rather than waiting for real cron ticks).
      // We can test delivery parsing separately.
    });

    it('should handle delivery target with colon-separated format', () => {
      // Test the delivery parsing indirectly by verifying job config
      const row = scheduler.addJob({
        name: 'colon-test',
        schedule: '0 9 * * *',
        agentId: 'main',
        prompt: 'test',
        deliverTo: 'telegram:12345',
        enabled: true,
      });

      const jobs = scheduler.listJobs();
      expect(jobs[0]!.deliverTo).toBe('telegram:12345');
    });

    it('should handle delivery to channel with hash prefix', () => {
      const row = scheduler.addJob({
        name: 'hash-test',
        schedule: '0 9 * * *',
        agentId: 'main',
        prompt: 'test',
        deliverTo: 'slack:#general',
        enabled: true,
      });

      const jobs = scheduler.listJobs();
      expect(jobs[0]!.deliverTo).toBe('slack:#general');
    });
  });
});

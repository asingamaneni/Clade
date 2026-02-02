// ---------------------------------------------------------------------------
// Tests: Agent Notification System
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseChannelTarget,
  shouldNotify,
  formatNotification,
  createNotifier,
  isQuietHours,
} from '../../src/agents/notifications.js';
import type {
  Notification,
  NotificationConfig,
  NotificationSeverity,
} from '../../src/agents/notifications.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    agentId: 'test-agent',
    severity: 'info',
    title: 'Test Notification',
    body: 'Something happened.',
    timestamp: new Date('2025-06-15T12:00:00Z'),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    preferredChannel: 'slack:#general',
    minSeverity: 'info',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseChannelTarget
// ---------------------------------------------------------------------------

describe('parseChannelTarget', () => {
  it('parses "slack:#general" into channel and target', () => {
    const result = parseChannelTarget('slack:#general');
    expect(result).toEqual({ channel: 'slack', target: '#general' });
  });

  it('parses "telegram:12345" into channel and target', () => {
    const result = parseChannelTarget('telegram:12345');
    expect(result).toEqual({ channel: 'telegram', target: '12345' });
  });

  it('parses "discord:channelId" into channel and target', () => {
    const result = parseChannelTarget('discord:channelId');
    expect(result).toEqual({ channel: 'discord', target: 'channelId' });
  });

  it('parses "webchat:client-abc" into channel and target', () => {
    const result = parseChannelTarget('webchat:client-abc');
    expect(result).toEqual({ channel: 'webchat', target: 'client-abc' });
  });

  it('handles target with colons (e.g. "slack:#team:engineering")', () => {
    const result = parseChannelTarget('slack:#team:engineering');
    expect(result).toEqual({ channel: 'slack', target: '#team:engineering' });
  });

  it('returns empty target when no colon present', () => {
    const result = parseChannelTarget('slack');
    expect(result).toEqual({ channel: 'slack', target: '' });
  });

  it('handles empty string input', () => {
    const result = parseChannelTarget('');
    expect(result).toEqual({ channel: '', target: '' });
  });

  it('handles colon at end of string', () => {
    const result = parseChannelTarget('slack:');
    expect(result).toEqual({ channel: 'slack', target: '' });
  });
});

// ---------------------------------------------------------------------------
// shouldNotify — severity filtering
// ---------------------------------------------------------------------------

describe('shouldNotify', () => {
  describe('severity filtering', () => {
    it('allows info notification when minSeverity is info', () => {
      const notification = makeNotification({ severity: 'info' });
      const config = makeConfig({ minSeverity: 'info' });
      expect(shouldNotify(notification, config)).toBe(true);
    });

    it('allows warn notification when minSeverity is info', () => {
      const notification = makeNotification({ severity: 'warn' });
      const config = makeConfig({ minSeverity: 'info' });
      expect(shouldNotify(notification, config)).toBe(true);
    });

    it('allows error notification when minSeverity is warn', () => {
      const notification = makeNotification({ severity: 'error' });
      const config = makeConfig({ minSeverity: 'warn' });
      expect(shouldNotify(notification, config)).toBe(true);
    });

    it('allows critical notification when minSeverity is error', () => {
      const notification = makeNotification({ severity: 'critical' });
      const config = makeConfig({ minSeverity: 'error' });
      expect(shouldNotify(notification, config)).toBe(true);
    });

    it('blocks info notification when minSeverity is warn', () => {
      const notification = makeNotification({ severity: 'info' });
      const config = makeConfig({ minSeverity: 'warn' });
      expect(shouldNotify(notification, config)).toBe(false);
    });

    it('blocks info notification when minSeverity is error', () => {
      const notification = makeNotification({ severity: 'info' });
      const config = makeConfig({ minSeverity: 'error' });
      expect(shouldNotify(notification, config)).toBe(false);
    });

    it('blocks warn notification when minSeverity is critical', () => {
      const notification = makeNotification({ severity: 'warn' });
      const config = makeConfig({ minSeverity: 'critical' });
      expect(shouldNotify(notification, config)).toBe(false);
    });

    it('allows notification at exact minSeverity threshold', () => {
      const notification = makeNotification({ severity: 'error' });
      const config = makeConfig({ minSeverity: 'error' });
      expect(shouldNotify(notification, config)).toBe(true);
    });

    it('defaults minSeverity to info when not specified', () => {
      const notification = makeNotification({ severity: 'info' });
      const config = makeConfig({ minSeverity: undefined });
      expect(shouldNotify(notification, config)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // shouldNotify — quiet hours interaction
  // -------------------------------------------------------------------------

  describe('quiet hours interaction', () => {
    it('blocks info notification during quiet hours', () => {
      const notification = makeNotification({ severity: 'info' });
      const config = makeConfig({
        quietHours: { start: '22:00', end: '08:00', timezone: 'UTC' },
      });
      // 23:00 UTC is within quiet hours
      const now = new Date('2025-06-15T23:00:00Z');
      expect(shouldNotify(notification, config, now)).toBe(false);
    });

    it('blocks warn notification during quiet hours', () => {
      const notification = makeNotification({ severity: 'warn' });
      const config = makeConfig({
        quietHours: { start: '22:00', end: '08:00', timezone: 'UTC' },
      });
      const now = new Date('2025-06-15T23:30:00Z');
      expect(shouldNotify(notification, config, now)).toBe(false);
    });

    it('allows critical notification during quiet hours', () => {
      const notification = makeNotification({ severity: 'critical' });
      const config = makeConfig({
        quietHours: { start: '22:00', end: '08:00', timezone: 'UTC' },
      });
      const now = new Date('2025-06-15T23:00:00Z');
      expect(shouldNotify(notification, config, now)).toBe(true);
    });

    it('allows info notification outside quiet hours', () => {
      const notification = makeNotification({ severity: 'info' });
      const config = makeConfig({
        quietHours: { start: '22:00', end: '08:00', timezone: 'UTC' },
      });
      // 12:00 UTC is outside quiet hours
      const now = new Date('2025-06-15T12:00:00Z');
      expect(shouldNotify(notification, config, now)).toBe(true);
    });

    it('allows notification when no quiet hours configured', () => {
      const notification = makeNotification({ severity: 'info' });
      const config = makeConfig({ quietHours: undefined });
      expect(shouldNotify(notification, config)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// isQuietHours
// ---------------------------------------------------------------------------

describe('isQuietHours', () => {
  it('returns true when current time is within a midnight-spanning window', () => {
    const quietHours = { start: '22:00', end: '08:00', timezone: 'UTC' };
    // 23:00 UTC
    const now = new Date('2025-06-15T23:00:00Z');
    expect(isQuietHours(quietHours, now)).toBe(true);
  });

  it('returns true for early morning in a midnight-spanning window', () => {
    const quietHours = { start: '22:00', end: '08:00', timezone: 'UTC' };
    // 03:00 UTC
    const now = new Date('2025-06-15T03:00:00Z');
    expect(isQuietHours(quietHours, now)).toBe(true);
  });

  it('returns false when current time is outside a midnight-spanning window', () => {
    const quietHours = { start: '22:00', end: '08:00', timezone: 'UTC' };
    // 12:00 UTC
    const now = new Date('2025-06-15T12:00:00Z');
    expect(isQuietHours(quietHours, now)).toBe(false);
  });

  it('returns false at the exact end boundary (exclusive)', () => {
    const quietHours = { start: '22:00', end: '08:00', timezone: 'UTC' };
    // 08:00 UTC -- end is exclusive
    const now = new Date('2025-06-15T08:00:00Z');
    expect(isQuietHours(quietHours, now)).toBe(false);
  });

  it('returns true at the exact start boundary (inclusive)', () => {
    const quietHours = { start: '22:00', end: '08:00', timezone: 'UTC' };
    // 22:00 UTC -- start is inclusive
    const now = new Date('2025-06-15T22:00:00Z');
    expect(isQuietHours(quietHours, now)).toBe(true);
  });

  it('handles non-midnight-spanning window (e.g. 01:00-05:00)', () => {
    const quietHours = { start: '01:00', end: '05:00', timezone: 'UTC' };
    const nowInside = new Date('2025-06-15T03:00:00Z');
    const nowOutside = new Date('2025-06-15T12:00:00Z');
    expect(isQuietHours(quietHours, nowInside)).toBe(true);
    expect(isQuietHours(quietHours, nowOutside)).toBe(false);
  });

  it('returns false for invalid time format', () => {
    const quietHours = { start: 'not-a-time', end: '08:00', timezone: 'UTC' };
    const now = new Date('2025-06-15T23:00:00Z');
    expect(isQuietHours(quietHours, now)).toBe(false);
  });

  it('returns false when end time is invalid', () => {
    const quietHours = { start: '22:00', end: 'invalid', timezone: 'UTC' };
    const now = new Date('2025-06-15T23:00:00Z');
    expect(isQuietHours(quietHours, now)).toBe(false);
  });

  it('falls back to UTC for unrecognized timezone', () => {
    const quietHours = { start: '22:00', end: '08:00', timezone: 'Invalid/Zone' };
    // 23:00 UTC -- should fall back to UTC
    const now = new Date('2025-06-15T23:00:00Z');
    expect(isQuietHours(quietHours, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatNotification
// ---------------------------------------------------------------------------

describe('formatNotification', () => {
  it('formats an info notification', () => {
    const notification = makeNotification({
      severity: 'info',
      title: 'Build Finished',
      body: 'Build completed successfully in 45s.',
    });

    const output = formatNotification(notification);

    expect(output).toContain('[info]');
    expect(output).toContain('Agent "test-agent"');
    expect(output).toContain('Build Finished');
    expect(output).toContain('Build completed successfully in 45s.');
    expect(output).toContain('2025-06-15T12:00:00.000Z');
  });

  it('formats a warn notification', () => {
    const notification = makeNotification({ severity: 'warn', title: 'Disk Space Low' });
    const output = formatNotification(notification);
    expect(output).toContain('[warn]');
    expect(output).toContain('Disk Space Low');
  });

  it('formats an error notification', () => {
    const notification = makeNotification({ severity: 'error', title: 'Test Failure' });
    const output = formatNotification(notification);
    expect(output).toContain('[error]');
    expect(output).toContain('Test Failure');
  });

  it('formats a critical notification', () => {
    const notification = makeNotification({ severity: 'critical', title: 'Service Down' });
    const output = formatNotification(notification);
    expect(output).toContain('[CRITICAL]');
    expect(output).toContain('Service Down');
  });

  it('includes the agent ID in the output', () => {
    const notification = makeNotification({ agentId: 'my-special-agent' });
    const output = formatNotification(notification);
    expect(output).toContain('Agent "my-special-agent"');
  });

  it('includes the timestamp as ISO string', () => {
    const ts = new Date('2025-01-01T00:00:00Z');
    const notification = makeNotification({ timestamp: ts });
    const output = formatNotification(notification);
    expect(output).toContain('2025-01-01T00:00:00.000Z');
  });

  it('includes the body text', () => {
    const notification = makeNotification({ body: 'Detailed description here.' });
    const output = formatNotification(notification);
    expect(output).toContain('Detailed description here.');
  });
});

// ---------------------------------------------------------------------------
// createNotifier — basic behavior
// ---------------------------------------------------------------------------

describe('createNotifier', () => {
  describe('basic behavior', () => {
    it('queues a notification via notify()', () => {
      const notifier = createNotifier('agent-1', makeConfig());
      notifier.notify('info', 'Hello', 'World');

      const pending = notifier.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.title).toBe('Hello');
      expect(pending[0]!.body).toBe('World');
      expect(pending[0]!.agentId).toBe('agent-1');
      expect(pending[0]!.severity).toBe('info');
    });

    it('queues multiple notifications', () => {
      const notifier = createNotifier('agent-1', makeConfig());
      notifier.notify('info', 'First', 'body1');
      notifier.notify('warn', 'Second', 'body2');
      notifier.notify('error', 'Third', 'body3');

      expect(notifier.getPending()).toHaveLength(3);
    });

    it('assigns a timestamp to each notification', () => {
      const notifier = createNotifier('agent-1', makeConfig());
      notifier.notify('info', 'Timed', 'body');

      const pending = notifier.getPending();
      expect(pending[0]!.timestamp).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // createNotifier — flush behavior
  // -------------------------------------------------------------------------

  describe('flush behavior', () => {
    it('flush() returns all pending notifications', () => {
      const notifier = createNotifier('agent-1', makeConfig());
      notifier.notify('info', 'A', 'body');
      notifier.notify('warn', 'B', 'body');

      const flushed = notifier.flush();
      expect(flushed).toHaveLength(2);
      expect(flushed[0]!.title).toBe('A');
      expect(flushed[1]!.title).toBe('B');
    });

    it('flush() clears the pending queue', () => {
      const notifier = createNotifier('agent-1', makeConfig());
      notifier.notify('info', 'A', 'body');

      notifier.flush();

      expect(notifier.getPending()).toHaveLength(0);
      expect(notifier.flush()).toHaveLength(0);
    });

    it('flush() returns empty array when nothing is pending', () => {
      const notifier = createNotifier('agent-1', makeConfig());
      expect(notifier.flush()).toEqual([]);
    });

    it('getPending() does not clear the queue', () => {
      const notifier = createNotifier('agent-1', makeConfig());
      notifier.notify('info', 'Sticky', 'body');

      notifier.getPending();
      expect(notifier.getPending()).toHaveLength(1);
    });

    it('getPending() returns a copy, not a reference', () => {
      const notifier = createNotifier('agent-1', makeConfig());
      notifier.notify('info', 'Copy', 'body');

      const pending1 = notifier.getPending();
      notifier.notify('warn', 'Another', 'body');
      const pending2 = notifier.getPending();

      // First snapshot should not have been mutated
      expect(pending1).toHaveLength(1);
      expect(pending2).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // createNotifier — severity filtering via config
  // -------------------------------------------------------------------------

  describe('severity filtering via config', () => {
    it('drops notifications below minSeverity', () => {
      const config = makeConfig({ minSeverity: 'error' });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('info', 'Dropped', 'body');
      notifier.notify('warn', 'Also Dropped', 'body');

      expect(notifier.getPending()).toHaveLength(0);
    });

    it('keeps notifications at or above minSeverity', () => {
      const config = makeConfig({ minSeverity: 'error' });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('error', 'Kept', 'body');
      notifier.notify('critical', 'Also Kept', 'body');

      expect(notifier.getPending()).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // createNotifier — critical always queued
  // -------------------------------------------------------------------------

  describe('critical notifications', () => {
    it('critical notifications are always queued regardless of minSeverity', () => {
      const config = makeConfig({ minSeverity: 'critical' });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('critical', 'Emergency', 'Server is on fire');

      expect(notifier.getPending()).toHaveLength(1);
      expect(notifier.getPending()[0]!.severity).toBe('critical');
    });

    it('critical notifications are queued even during quiet hours', () => {
      const config = makeConfig({
        quietHours: { start: '00:00', end: '23:59', timezone: 'UTC' },
      });
      const notifier = createNotifier('agent-1', config);

      // Critical always gets through
      notifier.notify('critical', 'Emergency', 'Server down');

      expect(notifier.getPending()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // createNotifier — batching behavior
  // -------------------------------------------------------------------------

  describe('batching behavior', () => {
    it('queues info notifications when batchDigest is true', () => {
      const config = makeConfig({ batchDigest: true });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('info', 'Batched Info', 'body');
      notifier.notify('info', 'Another Info', 'body');

      expect(notifier.getPending()).toHaveLength(2);
    });

    it('queues warn notifications when batchDigest is true', () => {
      const config = makeConfig({ batchDigest: true });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('warn', 'Batched Warn', 'body');

      expect(notifier.getPending()).toHaveLength(1);
    });

    it('queues error notifications even when batchDigest is true', () => {
      const config = makeConfig({ batchDigest: true });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('error', 'Immediate Error', 'body');

      expect(notifier.getPending()).toHaveLength(1);
    });

    it('flush returns batched and immediate together', () => {
      const config = makeConfig({ batchDigest: true });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('info', 'Batched', 'body');
      notifier.notify('error', 'Immediate', 'body');
      notifier.notify('warn', 'Also Batched', 'body');

      const flushed = notifier.flush();
      expect(flushed).toHaveLength(3);

      const severities = flushed.map((n) => n.severity);
      expect(severities).toContain('info');
      expect(severities).toContain('error');
      expect(severities).toContain('warn');
    });
  });

  // -------------------------------------------------------------------------
  // createNotifier — integration with quiet hours
  // -------------------------------------------------------------------------

  describe('quiet hours integration', () => {
    it('drops non-critical notifications during quiet hours', () => {
      // Quiet window covers all day (for testing determinism)
      const config = makeConfig({
        quietHours: { start: '00:00', end: '23:59', timezone: 'UTC' },
      });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('info', 'Quiet Info', 'body');
      notifier.notify('warn', 'Quiet Warn', 'body');
      notifier.notify('error', 'Quiet Error', 'body');

      // All non-critical dropped during quiet hours
      expect(notifier.getPending()).toHaveLength(0);
    });

    it('allows critical notifications during quiet hours', () => {
      const config = makeConfig({
        quietHours: { start: '00:00', end: '23:59', timezone: 'UTC' },
      });
      const notifier = createNotifier('agent-1', config);

      notifier.notify('critical', 'Critical During Quiet', 'body');

      expect(notifier.getPending()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // createNotifier — multiple agents
  // -------------------------------------------------------------------------

  describe('isolation', () => {
    it('notifiers for different agents are independent', () => {
      const config = makeConfig();
      const notifier1 = createNotifier('agent-1', config);
      const notifier2 = createNotifier('agent-2', config);

      notifier1.notify('info', 'Agent 1 Only', 'body');

      expect(notifier1.getPending()).toHaveLength(1);
      expect(notifier2.getPending()).toHaveLength(0);
    });

    it('flushing one notifier does not affect another', () => {
      const config = makeConfig();
      const notifier1 = createNotifier('agent-1', config);
      const notifier2 = createNotifier('agent-2', config);

      notifier1.notify('info', 'A', 'body');
      notifier2.notify('info', 'B', 'body');

      notifier1.flush();

      expect(notifier1.getPending()).toHaveLength(0);
      expect(notifier2.getPending()).toHaveLength(1);
    });
  });
});

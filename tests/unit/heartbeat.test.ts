// ---------------------------------------------------------------------------
// Tests: Heartbeat System
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HeartbeatManager,
  parseInterval,
  isWithinActiveHours,
} from '../../src/cron/heartbeat.js';
import { ConfigSchema, AgentConfigSchema } from '../../src/config/schema.js';
import type { AgentConfig, Config } from '../../src/config/schema.js';
import type { ChannelAdapter } from '../../src/channels/base.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockSessionManager() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ text: 'HEARTBEAT_OK', sessionId: 'sess-1', durationMs: 100 }),
    resumeSession: vi.fn(),
    createRunner: vi.fn(),
  };
}

function createMockAgentRegistry() {
  return {
    get: vi.fn().mockReturnValue({
      id: 'main',
      config: { name: 'Main' },
      soulPath: '/tmp/soul.md',
      memoryDir: '/tmp/memory',
      heartbeatPath: '/tmp/HEARTBEAT.md',
      baseDir: '/tmp/main',
    }),
    readSoul: vi.fn().mockReturnValue('# SOUL.md'),
    readHeartbeat: vi.fn().mockReturnValue('# Heartbeat'),
    has: vi.fn().mockReturnValue(true),
    list: vi.fn().mockReturnValue([]),
    tryGet: vi.fn(),
    ids: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
    size: 0,
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

describe('parseInterval', () => {
  it('should parse 15m to 15 minutes in ms', () => {
    expect(parseInterval('15m')).toBe(15 * 60 * 1000);
  });

  it('should parse 30m to 30 minutes in ms', () => {
    expect(parseInterval('30m')).toBe(30 * 60 * 1000);
  });

  it('should parse 1h to 1 hour in ms', () => {
    expect(parseInterval('1h')).toBe(60 * 60 * 1000);
  });

  it('should parse 4h to 4 hours in ms', () => {
    expect(parseInterval('4h')).toBe(4 * 60 * 60 * 1000);
  });

  it('should parse daily to 24 hours in ms', () => {
    expect(parseInterval('daily')).toBe(24 * 60 * 60 * 1000);
  });

  it('should default to 30m for unknown interval', () => {
    expect(parseInterval('unknown')).toBe(30 * 60 * 1000);
  });
});

describe('isWithinActiveHours', () => {
  it('should return true when no activeHours configured', () => {
    const config = AgentConfigSchema.parse({
      name: 'Test',
      heartbeat: { enabled: true },
    });

    expect(isWithinActiveHours(config)).toBe(true);
  });

  it('should return true during active hours', () => {
    // Configure active hours from 00:00 to 23:59 (always active)
    const config = AgentConfigSchema.parse({
      name: 'Test',
      heartbeat: {
        enabled: true,
        activeHours: {
          start: '00:00',
          end: '23:59',
          timezone: 'UTC',
        },
      },
    });

    expect(isWithinActiveHours(config)).toBe(true);
  });

  it('should handle timezone-aware active hours', () => {
    // This test uses a very wide window to ensure it passes regardless of actual time
    const config = AgentConfigSchema.parse({
      name: 'Test',
      heartbeat: {
        enabled: true,
        activeHours: {
          start: '00:00',
          end: '23:59',
          timezone: 'America/New_York',
        },
      },
    });

    expect(isWithinActiveHours(config)).toBe(true);
  });
});

describe('HeartbeatManager', () => {
  let manager: HeartbeatManager;
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockRegistry: ReturnType<typeof createMockAgentRegistry>;
  let channels: Map<string, ChannelAdapter>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSessionManager = createMockSessionManager();
    mockRegistry = createMockAgentRegistry();
    channels = new Map();
  });

  afterEach(() => {
    if (manager) {
      manager.stop();
    }
    vi.useRealTimers();
  });

  it('should start heartbeats for enabled agents', () => {
    const config = ConfigSchema.parse({
      agents: {
        main: {
          name: 'Main',
          heartbeat: { enabled: true, interval: '30m' },
        },
        secondary: {
          name: 'Secondary',
          heartbeat: { enabled: false },
        },
      },
    });

    manager = new HeartbeatManager(
      config,
      mockSessionManager as any,
      mockRegistry as any,
      channels,
    );

    manager.start();
    const states = manager.listStates();

    // Only the enabled agent should have a heartbeat
    expect(states).toHaveLength(1);
    expect(states[0]!.agentId).toBe('main');
    expect(states[0]!.intervalMs).toBe(30 * 60 * 1000);
  });

  it('should stop all heartbeats', () => {
    const config = ConfigSchema.parse({
      agents: {
        main: {
          name: 'Main',
          heartbeat: { enabled: true, interval: '15m' },
        },
      },
    });

    manager = new HeartbeatManager(
      config,
      mockSessionManager as any,
      mockRegistry as any,
      channels,
    );

    manager.start();
    expect(manager.listStates()).toHaveLength(1);

    manager.stop();
    expect(manager.listStates()).toHaveLength(0);
  });

  it('should suppress HEARTBEAT_OK when configured', async () => {
    const slackAdapter = createMockChannelAdapter('slack');
    channels.set('slack', slackAdapter);

    const config = ConfigSchema.parse({
      agents: {
        main: {
          name: 'Main',
          heartbeat: {
            enabled: true,
            interval: '15m',
            suppressOk: true,
            deliverTo: 'slack:#alerts',
          },
        },
      },
    });

    mockSessionManager.sendMessage.mockResolvedValue({
      text: 'HEARTBEAT_OK',
      sessionId: 'sess-1',
      durationMs: 100,
    });

    manager = new HeartbeatManager(
      config,
      mockSessionManager as any,
      mockRegistry as any,
      channels,
    );

    manager.start();

    // Advance past the first interval
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    // sendMessage should have been called (heartbeat fired)
    expect(mockSessionManager.sendMessage).toHaveBeenCalled();

    // But the channel adapter should NOT have been called (OK suppressed)
    expect(slackAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('should deliver alerts when response is not OK', async () => {
    const slackAdapter = createMockChannelAdapter('slack');
    channels.set('slack', slackAdapter);

    const config = ConfigSchema.parse({
      agents: {
        main: {
          name: 'Main',
          heartbeat: {
            enabled: true,
            interval: '15m',
            suppressOk: true,
            deliverTo: 'slack:#alerts',
          },
        },
      },
    });

    mockSessionManager.sendMessage.mockResolvedValue({
      text: 'ALERT: 3 pending messages need follow-up',
      sessionId: 'sess-1',
      durationMs: 500,
    });

    manager = new HeartbeatManager(
      config,
      mockSessionManager as any,
      mockRegistry as any,
      channels,
    );

    manager.start();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    // Channel adapter SHOULD have been called with the alert
    expect(slackAdapter.sendMessage).toHaveBeenCalledWith(
      '#alerts',
      expect.stringContaining('ALERT: 3 pending messages'),
    );
  });

  it('should deliver HEARTBEAT_OK when suppressOk is false', async () => {
    const slackAdapter = createMockChannelAdapter('slack');
    channels.set('slack', slackAdapter);

    const config = ConfigSchema.parse({
      agents: {
        main: {
          name: 'Main',
          heartbeat: {
            enabled: true,
            interval: '15m',
            suppressOk: false,
            deliverTo: 'slack:#status',
          },
        },
      },
    });

    mockSessionManager.sendMessage.mockResolvedValue({
      text: 'HEARTBEAT_OK',
      sessionId: 'sess-1',
      durationMs: 100,
    });

    manager = new HeartbeatManager(
      config,
      mockSessionManager as any,
      mockRegistry as any,
      channels,
    );

    manager.start();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    // Should deliver even OK responses
    expect(slackAdapter.sendMessage).toHaveBeenCalledWith(
      '#status',
      expect.stringContaining('HEARTBEAT_OK'),
    );
  });

  it('should handle sessionManager errors gracefully', async () => {
    const config = ConfigSchema.parse({
      agents: {
        main: {
          name: 'Main',
          heartbeat: { enabled: true, interval: '15m' },
        },
      },
    });

    mockSessionManager.sendMessage.mockRejectedValue(new Error('Connection lost'));

    manager = new HeartbeatManager(
      config,
      mockSessionManager as any,
      mockRegistry as any,
      channels,
    );

    manager.start();

    // Should not throw
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(mockSessionManager.sendMessage).toHaveBeenCalled();
  });

  it('should track lastBeat time', async () => {
    const config = ConfigSchema.parse({
      agents: {
        main: {
          name: 'Main',
          heartbeat: { enabled: true, interval: '15m' },
        },
      },
    });

    manager = new HeartbeatManager(
      config,
      mockSessionManager as any,
      mockRegistry as any,
      channels,
    );

    manager.start();

    const before = manager.getState('main');
    expect(before!.lastBeat).toBeNull();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    const after = manager.getState('main');
    expect(after!.lastBeat).toBeInstanceOf(Date);
  });
});

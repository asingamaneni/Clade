// ---------------------------------------------------------------------------
// Tests: IPC Message Dispatcher
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { dispatchIpcMessage } from '../../src/gateway/ipc.js';
import type { IpcDeps, IpcRequest } from '../../src/gateway/ipc.js';

// ---------------------------------------------------------------------------
// Mock dependencies factory
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<IpcDeps>): IpcDeps {
  return {
    sessionManager: {
      sendMessage: vi.fn().mockResolvedValue({ sessionId: 'sess-123', text: 'Done.' }),
      resumeSession: vi.fn().mockResolvedValue({ sessionId: 'sess-123', text: 'Resumed.' }),
      createRunner: vi.fn(),
    } as unknown as IpcDeps['sessionManager'],

    agentRegistry: {
      list: vi.fn().mockReturnValue([
        {
          id: 'jarvis',
          config: {
            name: 'Jarvis',
            description: 'Orchestrator agent',
            toolPreset: 'full',
            mcp: ['memory'],
          },
        },
        {
          id: 'coder',
          config: {
            name: 'Coder',
            description: 'Coding agent',
            toolPreset: 'coding',
            mcp: [],
          },
        },
      ]),
      has: vi.fn((id: string) => ['jarvis', 'coder'].includes(id)),
      tryGet: vi.fn((id: string) =>
        id === 'jarvis'
          ? { id: 'jarvis', config: { name: 'Jarvis' } }
          : id === 'coder'
            ? { id: 'coder', config: { name: 'Coder' } }
            : undefined,
      ),
      get: vi.fn(),
      ids: vi.fn().mockReturnValue(['jarvis', 'coder']),
    } as unknown as IpcDeps['agentRegistry'],

    store: {
      listSessions: vi.fn().mockReturnValue([
        {
          id: 'sess-1',
          agent_id: 'jarvis',
          channel: 'webchat',
          status: 'active',
          last_active_at: '2025-01-01T00:00:00Z',
        },
      ]),
      getSession: vi.fn((id: string) =>
        id === 'sess-1'
          ? {
              id: 'sess-1',
              agent_id: 'jarvis',
              channel: 'webchat',
              status: 'active',
              created_at: '2025-01-01T00:00:00Z',
              last_active_at: '2025-01-01T00:00:00Z',
            }
          : undefined,
      ),
    } as unknown as IpcDeps['store'],

    channels: new Map([
      [
        'telegram',
        {
          name: 'telegram',
          isConnected: vi.fn().mockReturnValue(true),
          sendMessage: vi.fn().mockResolvedValue(undefined),
          sendTyping: vi.fn().mockResolvedValue(undefined),
        } as unknown as import('../../src/channels/base.js').ChannelAdapter,
      ],
    ]),

    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IPC dispatchIpcMessage', () => {
  // ── agents.list ──────────────────────────────────────────────
  describe('agents.list', () => {
    it('should return the list of configured agents', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage({ type: 'agents.list' }, deps);

      expect(res.ok).toBe(true);
      const agents = res.agents as Array<{ id: string; name: string }>;
      expect(agents).toHaveLength(2);
      expect(agents[0]!.id).toBe('jarvis');
      expect(agents[1]!.id).toBe('coder');
    });
  });

  // ── sessions.list ────────────────────────────────────────────
  describe('sessions.list', () => {
    it('should return active sessions', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage({ type: 'sessions.list' }, deps);

      expect(res.ok).toBe(true);
      const sessions = res.sessions as Array<{ sessionId: string }>;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.sessionId).toBe('sess-1');
    });
  });

  // ── sessions.spawn ───────────────────────────────────────────
  describe('sessions.spawn', () => {
    it('should spawn a session for a valid agent', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.spawn', agentId: 'coder', prompt: 'Write tests' },
        deps,
      );

      expect(res.ok).toBe(true);
      expect(res.sessionId).toBe('sess-123');
      expect(res.response).toBe('Done.');
      expect(deps.sessionManager.sendMessage).toHaveBeenCalledWith(
        'coder',
        'Write tests',
        'ipc',
      );
    });

    it('should return error when agentId is missing', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.spawn', prompt: 'Hello' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('agentId');
    });

    it('should return error when prompt is missing', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.spawn', agentId: 'jarvis' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('prompt');
    });

    it('should return error for unknown agent', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.spawn', agentId: 'nonexistent', prompt: 'Hello' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('not found');
    });
  });

  // ── sessions.send ────────────────────────────────────────────
  describe('sessions.send', () => {
    it('should send message to existing session', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.send', sessionId: 'sess-1', message: 'Continue' },
        deps,
      );

      expect(res.ok).toBe(true);
      expect(res.response).toBe('Resumed.');
      expect(deps.sessionManager.resumeSession).toHaveBeenCalledWith(
        'sess-1',
        'Continue',
      );
    });

    it('should return error when sessionId is missing', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.send', message: 'Hello' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('sessionId');
    });

    it('should return error when message is missing', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.send', sessionId: 'sess-1' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('message');
    });

    it('should return error for unknown session', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.send', sessionId: 'sess-999', message: 'Hello' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('not found');
    });
  });

  // ── sessions.status ──────────────────────────────────────────
  describe('sessions.status', () => {
    it('should return status for known session', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.status', sessionId: 'sess-1' },
        deps,
      );

      expect(res.ok).toBe(true);
      expect(res.sessionId).toBe('sess-1');
      expect(res.agentId).toBe('jarvis');
      expect(res.status).toBe('active');
    });

    it('should return error for unknown session', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.status', sessionId: 'sess-999' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('not found');
    });

    it('should return error when sessionId is missing', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'sessions.status' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('sessionId');
    });
  });

  // ── messaging.send ───────────────────────────────────────────
  describe('messaging.send', () => {
    it('should send message via channel adapter', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'messaging.send', channel: 'telegram', to: 'chat-1', text: 'Hello!' },
        deps,
      );

      expect(res.ok).toBe(true);
      const adapter = deps.channels.get('telegram')!;
      expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Hello!', undefined);
    });

    it('should return error when channel is missing', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'messaging.send', to: 'chat-1', text: 'Hello!' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('channel');
    });

    it('should return error when to is missing', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'messaging.send', channel: 'telegram', text: 'Hello!' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('to');
    });

    it('should return error when text is missing', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'messaging.send', channel: 'telegram', to: 'chat-1' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('text');
    });

    it('should return error for unknown channel', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'messaging.send', channel: 'unknown', to: 'chat-1', text: 'Hello!' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('not found');
    });
  });

  // ── messaging.typing ─────────────────────────────────────────
  describe('messaging.typing', () => {
    it('should send typing indicator', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'messaging.typing', channel: 'telegram', to: 'chat-1' },
        deps,
      );

      expect(res.ok).toBe(true);
      const adapter = deps.channels.get('telegram')!;
      expect(adapter.sendTyping).toHaveBeenCalledWith('chat-1');
    });
  });

  // ── messaging.channel_info ───────────────────────────────────
  describe('messaging.channel_info', () => {
    it('should return channel connection status', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'messaging.channel_info', channel: 'telegram' },
        deps,
      );

      expect(res.ok).toBe(true);
      expect(res.connected).toBe(true);
      expect(res.type).toBe('telegram');
    });

    it('should return error for unknown channel', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'messaging.channel_info', channel: 'nonexistent' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('not found');
    });
  });

  // ── unknown type ─────────────────────────────────────────────
  describe('unknown message type', () => {
    it('should return error for unrecognized type', async () => {
      const deps = createMockDeps();
      const res = await dispatchIpcMessage(
        { type: 'totally.unknown' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('Unknown IPC message type');
    });
  });

  // ── error handling ───────────────────────────────────────────
  describe('error handling', () => {
    it('should catch handler errors and return them as IPC errors', async () => {
      const deps = createMockDeps({
        sessionManager: {
          sendMessage: vi.fn().mockRejectedValue(new Error('CLI crashed')),
          resumeSession: vi.fn(),
          createRunner: vi.fn(),
        } as unknown as IpcDeps['sessionManager'],
      });

      const res = await dispatchIpcMessage(
        { type: 'sessions.spawn', agentId: 'jarvis', prompt: 'Do something' },
        deps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('CLI crashed');
    });
  });
});

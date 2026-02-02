// ---------------------------------------------------------------------------
// Tests: WebChat Adapter
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebChatAdapter } from '../../src/channels/webchat.js';
import type { InboundMessage } from '../../src/agents/types.js';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

function createMockWebSocket(): any {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  ws.readyState = 1; // OPEN
  ws.send = vi.fn();
  ws.close = vi.fn();
  return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebChatAdapter', () => {
  let adapter: WebChatAdapter;

  beforeEach(() => {
    adapter = new WebChatAdapter();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('lifecycle', () => {
    it('should not be connected initially', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('should be connected after connect()', async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it('should not be connected after disconnect()', async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('client management', () => {
    it('should add a client', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();

      adapter.addClient('client-1', ws);
      expect(adapter.clientCount).toBe(1);
      expect(adapter.getClientIds()).toContain('client-1');
    });

    it('should remove a client', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();

      adapter.addClient('client-1', ws);
      adapter.removeClient('client-1');

      expect(adapter.clientCount).toBe(0);
    });

    it('should send connected frame on addClient', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();

      adapter.addClient('client-1', ws);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const frame = JSON.parse(ws.send.mock.calls[0]![0] as string);
      expect(frame.type).toBe('connected');
      expect(frame.clientId).toBe('client-1');
    });

    it('should close old socket when replacing client ID', async () => {
      await adapter.connect();
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      adapter.addClient('same-id', ws1);
      adapter.addClient('same-id', ws2);

      expect(ws1.close).toHaveBeenCalled();
      expect(adapter.clientCount).toBe(1);
    });

    it('should handle multiple clients', async () => {
      await adapter.connect();

      adapter.addClient('c1', createMockWebSocket());
      adapter.addClient('c2', createMockWebSocket());
      adapter.addClient('c3', createMockWebSocket());

      expect(adapter.clientCount).toBe(3);
      expect(adapter.getClientIds().sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('should cleanup on socket close event', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();

      adapter.addClient('cleanup-client', ws);
      expect(adapter.clientCount).toBe(1);

      ws.emit('close');
      expect(adapter.clientCount).toBe(0);
    });

    it('should cleanup on socket error event', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();

      adapter.addClient('error-client', ws);
      ws.emit('error', new Error('connection lost'));

      expect(adapter.clientCount).toBe(0);
    });
  });

  describe('send message', () => {
    it('should send message frame to client', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();
      adapter.addClient('recv', ws);

      // Reset mock calls (addClient sends a connected frame)
      ws.send.mockClear();

      await adapter.sendMessage('recv', 'Hello from agent');

      expect(ws.send).toHaveBeenCalledTimes(1);
      const frame = JSON.parse(ws.send.mock.calls[0]![0] as string);
      expect(frame.type).toBe('message');
      expect(frame.text).toBe('Hello from agent');
    });

    it('should not throw when sending to nonexistent client', async () => {
      await adapter.connect();
      // Should not throw
      await adapter.sendMessage('ghost', 'Hello');
    });

    it('should not send to closed socket', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();
      ws.readyState = 3; // CLOSED

      adapter.addClient('closed', ws);
      ws.send.mockClear();

      await adapter.sendMessage('closed', 'Hello');
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('send typing', () => {
    it('should send typing frame to client', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();
      adapter.addClient('typing-test', ws);
      ws.send.mockClear();

      await adapter.sendTyping('typing-test');

      expect(ws.send).toHaveBeenCalledTimes(1);
      const frame = JSON.parse(ws.send.mock.calls[0]![0] as string);
      expect(frame.type).toBe('typing');
    });
  });

  describe('receive message', () => {
    it('should dispatch inbound messages to handler', async () => {
      await adapter.connect();

      const received: InboundMessage[] = [];
      adapter.onMessage(async (msg) => {
        received.push(msg);
      });

      const ws = createMockWebSocket();
      adapter.addClient('sender', ws);

      // Simulate client sending a message
      const frame = JSON.stringify({ type: 'message', text: 'Hello agent' });
      ws.emit('message', Buffer.from(frame));

      // Give async handler time to run
      await new Promise((r) => setTimeout(r, 10));

      expect(received).toHaveLength(1);
      expect(received[0]!.channel).toBe('webchat');
      expect(received[0]!.userId).toBe('sender');
      expect(received[0]!.text).toBe('Hello agent');
    });

    it('should send error frame for invalid JSON', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();
      adapter.addClient('bad-json', ws);
      ws.send.mockClear();

      ws.emit('message', Buffer.from('not valid json'));

      // Should have sent an error frame
      await new Promise((r) => setTimeout(r, 10));
      const errorCall = ws.send.mock.calls.find((call: any[]) => {
        const frame = JSON.parse(call[0] as string);
        return frame.type === 'error';
      });
      expect(errorCall).toBeDefined();
    });

    it('should send error frame when text field is missing', async () => {
      await adapter.connect();
      const ws = createMockWebSocket();
      adapter.addClient('no-text', ws);
      ws.send.mockClear();

      const frame = JSON.stringify({ type: 'message' }); // No text field
      ws.emit('message', Buffer.from(frame));

      await new Promise((r) => setTimeout(r, 10));
      const errorCall = ws.send.mock.calls.find((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'error';
      });
      expect(errorCall).toBeDefined();
    });
  });

  describe('broadcast', () => {
    it('should send broadcast to all connected clients', async () => {
      await adapter.connect();
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      adapter.addClient('b1', ws1);
      adapter.addClient('b2', ws2);

      ws1.send.mockClear();
      ws2.send.mockClear();

      adapter.broadcast('System announcement');

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);

      const frame1 = JSON.parse(ws1.send.mock.calls[0]![0] as string);
      expect(frame1.type).toBe('broadcast');
      expect(frame1.text).toBe('System announcement');
    });
  });

  describe('disconnect', () => {
    it('should close all client sockets on disconnect', async () => {
      await adapter.connect();
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      adapter.addClient('d1', ws1);
      adapter.addClient('d2', ws2);

      await adapter.disconnect();

      expect(ws1.close).toHaveBeenCalled();
      expect(ws2.close).toHaveBeenCalled();
      expect(adapter.clientCount).toBe(0);
    });
  });
});

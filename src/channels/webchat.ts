import type { WebSocket } from 'ws';
import { BaseChannelAdapter } from './base.js';

// ---------------------------------------------------------------------------
// WebChat channel adapter
//
// Bridges the gateway's WebSocket endpoint (/ws) to the generic channel
// pipeline.  The gateway calls `addClient()` when a new WS connection
// arrives; this adapter manages the client lifecycle and relays messages.
// ---------------------------------------------------------------------------

/** JSON frame sent by the browser client. */
interface ClientFrame {
  type: string;
  text?: string;
}

/** JSON frame sent to the browser client. */
interface ServerFrame {
  type: 'connected' | 'message' | 'typing' | 'broadcast' | 'error';
  text?: string;
  clientId?: string;
  timestamp?: string;
}

export class WebChatAdapter extends BaseChannelAdapter {
  readonly name = 'webchat';

  /**
   * Active WebSocket connections keyed by client ID (UUID assigned at
   * connect time or supplied via the `?clientId=` query parameter).
   */
  private clients = new Map<string, WebSocket>();

  // ── Client management (called by the gateway WS handler) ──────────

  /**
   * Register a new WebSocket client.
   * If `id` is already in use the old socket is closed first.
   */
  addClient(id: string, socket: WebSocket): void {
    const existing = this.clients.get(id);
    if (existing && existing.readyState === 1 /* OPEN */) {
      existing.close(4000, 'Replaced by new connection');
    }
    this.clients.set(id, socket);

    // ── Inbound messages ─────────────────────────────────────────
    socket.on('message', async (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const raw = Buffer.isBuffer(data)
          ? data.toString('utf-8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf-8')
            : Buffer.from(data).toString('utf-8');

        const frame = JSON.parse(raw) as ClientFrame;
        if (!frame.text || typeof frame.text !== 'string') {
          this.sendFrame(socket, { type: 'error', text: 'Missing "text" field' });
          return;
        }

        await this.handleInbound({
          channel: 'webchat',
          userId: id,
          text: frame.text,
          timestamp: new Date(),
        });
      } catch {
        this.sendFrame(socket, { type: 'error', text: 'Invalid JSON' });
      }
    });

    // ── Cleanup ──────────────────────────────────────────────────
    socket.on('close', () => {
      this.clients.delete(id);
    });

    socket.on('error', () => {
      this.clients.delete(id);
    });

    // ── Handshake ────────────────────────────────────────────────
    this.sendFrame(socket, {
      type: 'connected',
      clientId: id,
      timestamp: new Date().toISOString(),
    });
  }

  /** Forcefully disconnect and remove a client. */
  removeClient(id: string): void {
    const ws = this.clients.get(id);
    if (ws && ws.readyState === 1 /* OPEN */) {
      ws.close(1000, 'Removed by server');
    }
    this.clients.delete(id);
  }

  /** Snapshot of all connected client IDs. */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /** Number of connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  // ── ChannelAdapter lifecycle ───────────────────────────────────────

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    for (const [, ws] of this.clients) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.close(1001, 'Server shutting down');
      }
    }
    this.clients.clear();
    this.connected = false;
  }

  // ── Outbound messaging ────────────────────────────────────────────

  async sendMessage(to: string, text: string, _options?: { threadId?: string }): Promise<void> {
    const ws = this.clients.get(to);
    if (ws && ws.readyState === 1 /* OPEN */) {
      this.sendFrame(ws, {
        type: 'message',
        text,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async sendTyping(to: string): Promise<void> {
    const ws = this.clients.get(to);
    if (ws && ws.readyState === 1 /* OPEN */) {
      this.sendFrame(ws, { type: 'typing' });
    }
  }

  /** Broadcast a message to every connected WebChat client. */
  broadcast(text: string): void {
    const frame: ServerFrame = {
      type: 'broadcast',
      text,
      timestamp: new Date().toISOString(),
    };
    const payload = JSON.stringify(frame);
    for (const [, ws] of this.clients) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(payload);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private sendFrame(ws: WebSocket, frame: ServerFrame): void {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(frame));
    }
  }
}

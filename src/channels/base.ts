import type { InboundMessage } from '../agents/types.js';

// ---------------------------------------------------------------------------
// Message handler callback type
// ---------------------------------------------------------------------------

export type MessageHandler = (message: InboundMessage) => Promise<void>;

// ---------------------------------------------------------------------------
// Channel adapter interface
// ---------------------------------------------------------------------------

/**
 * Every channel adapter (webchat, telegram, slack, discord, etc.) must
 * implement this interface.  The gateway instantiates adapters at boot,
 * calls `connect()`, and wires `onMessage()` to the message router.
 */
export interface ChannelAdapter {
  /** Unique channel name used in routing rules and session keys. */
  readonly name: string;

  /** Establish the underlying connection (e.g. start a bot, open a socket). */
  connect(): Promise<void>;

  /** Tear down the connection gracefully. */
  disconnect(): Promise<void>;

  /**
   * Send a text message to a channel-specific recipient.
   * @param to   - Channel-specific destination (userId, chatId, channelId, etc.)
   * @param text - Plaintext or lightly-formatted message body.
   * @param options.threadId - Optional thread/reply context.
   */
  sendMessage(to: string, text: string, options?: { threadId?: string }): Promise<void>;

  /**
   * Show a typing / "composing" indicator to the recipient.
   * Not all channels support this -- implementations may no-op.
   */
  sendTyping(to: string): Promise<void>;

  /** Register the handler that the router calls for every inbound message. */
  onMessage(handler: MessageHandler): void;

  /** Whether the adapter is currently connected and able to send/receive. */
  isConnected(): boolean;
}

// ---------------------------------------------------------------------------
// Abstract base with shared boilerplate
// ---------------------------------------------------------------------------

export abstract class BaseChannelAdapter implements ChannelAdapter {
  abstract readonly name: string;

  protected handler?: MessageHandler;
  protected connected = false;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendMessage(to: string, text: string, options?: { threadId?: string }): Promise<void>;
  abstract sendTyping(to: string): Promise<void>;

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Subclasses call this to forward a platform-specific event into the
   * generic Clade message pipeline.
   */
  protected async handleInbound(message: InboundMessage): Promise<void> {
    if (!this.handler) return;

    try {
      await this.handler(message);
    } catch (err) {
      // Surface handler errors but never crash the adapter event loop.
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[${this.name}] inbound handler error: ${detail}`);
    }
  }
}

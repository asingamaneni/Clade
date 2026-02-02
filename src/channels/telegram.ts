import { Bot } from 'grammy';
import { BaseChannelAdapter } from './base.js';

// ---------------------------------------------------------------------------
// Telegram channel adapter (grammy)
//
// Uses long-polling by default.  The Bot is constructed in the constructor
// but not started until `connect()` is called.
// ---------------------------------------------------------------------------

export class TelegramAdapter extends BaseChannelAdapter {
  readonly name = 'telegram';

  private bot: Bot;
  private started = false;

  constructor(token: string) {
    super();
    this.bot = new Bot(token);

    // ── Text messages ────────────────────────────────────────────
    this.bot.on('message:text', async (ctx) => {
      await this.handleInbound({
        channel: 'telegram',
        userId: String(ctx.from.id),
        chatId: String(ctx.chat.id),
        text: ctx.message.text,
        threadId: ctx.message.message_thread_id
          ? String(ctx.message.message_thread_id)
          : undefined,
        timestamp: new Date(ctx.message.date * 1000),
        raw: ctx,
      });
    });

    // ── Global error handler ─────────────────────────────────────
    this.bot.catch((err) => {
      console.error(`[telegram] Bot error: ${err.message}`);
    });
  }

  // ── ChannelAdapter lifecycle ───────────────────────────────────────

  async connect(): Promise<void> {
    if (this.started) return;

    // bot.start() begins polling in the background.  It does not return
    // a promise that resolves on "connected" -- it resolves immediately.
    // We mark connected optimistically here; errors surface via the
    // bot.catch handler above.
    this.bot.start({
      onStart: () => {
        this.connected = true;
        this.started = true;
      },
    });

    // Give the polling loop a moment to spin up.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    this.connected = true;
    this.started = true;
  }

  async disconnect(): Promise<void> {
    if (!this.started) return;
    await this.bot.stop();
    this.connected = false;
    this.started = false;
  }

  // ── Outbound messaging ────────────────────────────────────────────

  async sendMessage(
    to: string,
    text: string,
    options?: { threadId?: string },
  ): Promise<void> {
    await this.bot.api.sendMessage(to, text, {
      message_thread_id: options?.threadId
        ? Number(options.threadId)
        : undefined,
      parse_mode: 'Markdown',
    });
  }

  async sendTyping(to: string): Promise<void> {
    await this.bot.api.sendChatAction(to, 'typing');
  }
}

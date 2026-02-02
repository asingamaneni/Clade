import { App } from '@slack/bolt';
import { BaseChannelAdapter } from './base.js';

// ---------------------------------------------------------------------------
// Slack channel adapter (@slack/bolt + Socket Mode)
//
// Uses Socket Mode so there is no need for a public HTTP endpoint.
// Requires both a Bot Token (xoxb-...) and an App-Level Token (xapp-...).
// ---------------------------------------------------------------------------

export class SlackAdapter extends BaseChannelAdapter {
  readonly name = 'slack';

  private app: InstanceType<typeof App>;

  constructor(botToken: string, appToken: string) {
    super();

    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    // ── Message events ───────────────────────────────────────────
    this.app.message(async ({ message }: { message: any }) => {
      // Skip bot messages, edits, deletes, and other subtypes.
      if ('subtype' in message && message.subtype) return;
      if (!('text' in message) || !message.text) return;

      const userId =
        'user' in message && typeof message.user === 'string'
          ? message.user
          : 'unknown';
      const chatId =
        'channel' in message && typeof message.channel === 'string'
          ? message.channel
          : 'unknown';
      const threadTs =
        'thread_ts' in message && typeof message.thread_ts === 'string'
          ? message.thread_ts
          : 'ts' in message && typeof message.ts === 'string'
            ? message.ts
            : undefined;
      const ts =
        'ts' in message && typeof message.ts === 'string'
          ? message.ts
          : '0';

      await this.handleInbound({
        channel: 'slack',
        userId,
        chatId,
        text: message.text,
        threadId: threadTs,
        timestamp: new Date(Number(ts) * 1000),
        raw: message,
      });
    });

    // ── Global error handler ─────────────────────────────────────
    this.app.error(async (error: any) => {
      console.error(`[slack] App error:`, error);
    });
  }

  // ── ChannelAdapter lifecycle ───────────────────────────────────────

  async connect(): Promise<void> {
    await this.app.start();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.app.stop();
    this.connected = false;
  }

  // ── Outbound messaging ────────────────────────────────────────────

  async sendMessage(
    to: string,
    text: string,
    options?: { threadId?: string },
  ): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: to,
      text,
      thread_ts: options?.threadId,
    });
  }

  async sendTyping(_to: string): Promise<void> {
    // Slack does not expose a typing indicator API for bot users.
    // This is intentionally a no-op.
  }
}

import { Client, GatewayIntentBits, Events } from 'discord.js';
import type { TextChannel, DMChannel, NewsChannel } from 'discord.js';
import { BaseChannelAdapter } from './base.js';

// ---------------------------------------------------------------------------
// Discord channel adapter (discord.js v14)
//
// Connects via the Gateway (WebSocket).  Requires the MESSAGE_CONTENT
// privileged intent to be enabled in the Discord Developer Portal.
// ---------------------------------------------------------------------------

/** Channels that support `.send()` and `.sendTyping()`. */
type SendableChannel = TextChannel | DMChannel | NewsChannel;

function isSendable(channel: unknown): channel is SendableChannel {
  return (
    channel !== null &&
    typeof channel === 'object' &&
    'send' in channel &&
    typeof (channel as Record<string, unknown>).send === 'function'
  );
}

export class DiscordAdapter extends BaseChannelAdapter {
  readonly name = 'discord';

  private client: Client;
  private token: string;

  constructor(token: string) {
    super();
    this.token = token;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    // ── Message events ───────────────────────────────────────────
    this.client.on(Events.MessageCreate, async (message) => {
      // Ignore messages from bots (including ourselves).
      if (message.author.bot) return;

      await this.handleInbound({
        channel: 'discord',
        userId: message.author.id,
        chatId: message.channel.id,
        text: message.content,
        threadId: message.reference?.messageId ?? undefined,
        timestamp: message.createdAt,
        raw: message,
      });
    });

    // ── Error handler ────────────────────────────────────────────
    this.client.on(Events.Error, (error) => {
      console.error(`[discord] Client error: ${error.message}`);
    });
  }

  // ── ChannelAdapter lifecycle ───────────────────────────────────────

  async connect(): Promise<void> {
    await this.client.login(this.token);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
    this.connected = false;
  }

  // ── Outbound messaging ────────────────────────────────────────────

  async sendMessage(
    to: string,
    text: string,
    options?: { threadId?: string },
  ): Promise<void> {
    const channel = await this.client.channels.fetch(to);
    if (!channel || !isSendable(channel)) return;

    // If a threadId (message reference) is provided, attempt to reply
    // within that thread.
    if (options?.threadId) {
      try {
        const parentMessage = await channel.messages.fetch(options.threadId);
        if (parentMessage.thread) {
          await parentMessage.thread.send(text);
          return;
        }
        // Start a new thread from the referenced message.
        const thread = await parentMessage.startThread({
          name: 'Reply',
          autoArchiveDuration: 60,
        });
        await thread.send(text);
        return;
      } catch {
        // Fall through to a plain send if thread creation fails.
      }
    }

    await channel.send(text);
  }

  async sendTyping(to: string): Promise<void> {
    const channel = await this.client.channels.fetch(to);
    if (channel && isSendable(channel)) {
      await channel.sendTyping();
    }
  }
}

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Agent tool presets
// ---------------------------------------------------------------------------

export const ToolPresetSchema = z.enum([
  'potato',    // No tools — pure chat
  'coding',    // Read, Edit, Write, Bash, Glob, Grep + memory/sessions MCP
  'messaging', // Memory/sessions/messaging MCP only
  'full',      // All Claude Code tools + all MCP tools
  'custom',    // Explicitly listed in customTools
]);

export type ToolPreset = z.infer<typeof ToolPresetSchema>;

// ---------------------------------------------------------------------------
// Heartbeat configuration per agent
// ---------------------------------------------------------------------------

export const HeartbeatConfigSchema = z.object({
  /** Whether heartbeat monitoring is enabled for this agent. */
  enabled: z.boolean().default(false),

  /** How often the heartbeat fires. */
  interval: z.enum(['15m', '30m', '1h', '4h', 'daily']).default('30m'),

  /** Optional active-hours window. Heartbeats outside this window are skipped. */
  activeHours: z
    .object({
      start: z.string().default('09:00'),
      end: z.string().default('22:00'),
      timezone: z.string().default('UTC'),
    })
    .optional(),

  /**
   * Where to deliver heartbeat results.
   * Format: "channel:target" — e.g. "slack:#alerts" or "telegram:12345".
   */
  deliverTo: z.string().optional(),

  /**
   * Heartbeat mode.
   *  - "check": read HEARTBEAT.md, review each item, report issues.
   *  - "work":  read HEARTBEAT.md, perform tasks, report outcomes.
   */
  mode: z.enum(['check', 'work']).default('check'),

  /** If true, suppress "HEARTBEAT_OK" results (only deliver when action needed). */
  suppressOk: z.boolean().default(true),
});

export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

export const AgentConfigSchema = z.object({
  /** Display name of the agent. */
  name: z.string(),

  /** Short description of the agent's purpose. */
  description: z.string().default(''),

  /** Model to use. Passed to `claude --model <model>`. */
  model: z.string().default('sonnet'),

  /** Tool access preset. Controls --allowedTools. */
  toolPreset: ToolPresetSchema.default('full'),

  /** Explicit tool list when toolPreset is "custom". */
  customTools: z.array(z.string()).default([]),

  /** MCP skill server names to attach (e.g. ["memory", "sessions"]). */
  skills: z.array(z.string()).default([]),

  /** Heartbeat / proactive monitoring configuration. */
  heartbeat: HeartbeatConfigSchema.default({ enabled: true }),

  /** Reflection cycle configuration — how the agent self-improves. */
  reflection: z.object({
    /** Whether reflection is enabled. */
    enabled: z.boolean().default(true),
    /** Number of sessions between reflections. */
    interval: z.number().int().positive().default(10),
  }).default({}),

  /** Maximum autonomous turns per invocation. */
  maxTurns: z.number().int().positive().default(25),

  /** User notification preferences for this agent. */
  notifications: z.object({
    /** Where to send updates: "slack:#channel", "telegram:chatId", etc. */
    preferredChannel: z.string().optional(),
    /** Minimum severity to notify. */
    minSeverity: z.enum(['info', 'warn', 'error', 'critical']).default('info'),
    /** Quiet hours -- suppress non-critical notifications. */
    quietHours: z.object({
      start: z.string().default('22:00'),
      end: z.string().default('08:00'),
      timezone: z.string().default('UTC'),
    }).optional(),
    /** Whether to batch low-severity notifications into digests. */
    batchDigest: z.boolean().default(false),
    /** Digest interval in minutes. */
    digestIntervalMinutes: z.number().int().positive().default(30),
  }).default({}),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ---------------------------------------------------------------------------
// Channel configurations
// ---------------------------------------------------------------------------

export const TelegramChannelSchema = z.object({
  enabled: z.boolean().default(false),
  /** Telegram Bot API token. Typically sourced via ${TELEGRAM_BOT_TOKEN}. */
  token: z.string().optional(),
});

export type TelegramChannelConfig = z.infer<typeof TelegramChannelSchema>;

export const SlackChannelSchema = z.object({
  enabled: z.boolean().default(false),
  /** Slack Bot OAuth token (xoxb-...). */
  botToken: z.string().optional(),
  /** Slack App-level token for Socket Mode (xapp-...). */
  appToken: z.string().optional(),
});

export type SlackChannelConfig = z.infer<typeof SlackChannelSchema>;

export const DiscordChannelSchema = z.object({
  enabled: z.boolean().default(false),
  /** Discord bot token. */
  token: z.string().optional(),
});

export type DiscordChannelConfig = z.infer<typeof DiscordChannelSchema>;

export const WebChatChannelSchema = z.object({
  /** WebChat is enabled by default (served via the gateway). */
  enabled: z.boolean().default(true),
});

export type WebChatChannelConfig = z.infer<typeof WebChatChannelSchema>;

export const ChannelsConfigSchema = z.object({
  telegram: TelegramChannelSchema.default({}),
  slack: SlackChannelSchema.default({}),
  discord: DiscordChannelSchema.default({}),
  webchat: WebChatChannelSchema.default({}),
});

export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;

// ---------------------------------------------------------------------------
// Gateway configuration
// ---------------------------------------------------------------------------

export const GatewayConfigSchema = z.object({
  /** Port for the Fastify HTTP/WS server. */
  port: z.number().int().min(1).max(65535).default(7890),

  /** Bind address. Default is loopback only. */
  host: z.string().default('127.0.0.1'),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

// ---------------------------------------------------------------------------
// Routing rules
// ---------------------------------------------------------------------------

export const RoutingRuleSchema = z.object({
  /** Channel name (e.g. "slack", "telegram", "discord", "webchat"). */
  channel: z.string(),

  /** Channel-specific user identifier. If omitted, rule matches all users. */
  channelUserId: z.string().optional(),

  /** Channel-specific chat/group identifier. If omitted, rule matches all chats. */
  chatId: z.string().optional(),

  /** Agent to route matching messages to. */
  agentId: z.string(),
});

export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

export const RoutingConfigSchema = z.object({
  /** Agent to use when no routing rule matches. Set during agent creation. */
  defaultAgent: z.string().default(''),

  /** Ordered routing rules. First match wins. */
  rules: z.array(RoutingRuleSchema).default([]),
});

export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;

// ---------------------------------------------------------------------------
// Skills configuration
// ---------------------------------------------------------------------------

export const SkillsConfigSchema = z.object({
  /** Skill names that are auto-approved when requested by agents. */
  autoApprove: z.array(z.string()).default([]),
});

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;

// ---------------------------------------------------------------------------
// Root configuration schema
// ---------------------------------------------------------------------------

export const ConfigSchema = z.object({
  /** Schema version for config migration support. */
  version: z.number().int().default(2),

  /** Agents are user-created. No pre-defined agents — starts empty. */
  agents: z
    .record(z.string(), AgentConfigSchema)
    .default({}),

  channels: ChannelsConfigSchema.default({}),

  gateway: GatewayConfigSchema.default({}),

  routing: RoutingConfigSchema.default({}),

  skills: SkillsConfigSchema.default({}),
}).passthrough();

export type Config = z.infer<typeof ConfigSchema>;

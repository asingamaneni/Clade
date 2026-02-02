import type { AgentConfig } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Agent — a resolved agent with its config and file paths
// ---------------------------------------------------------------------------

/**
 * Fully resolved agent descriptor. Created by the agent registry from
 * the global config + on-disk agent directory.
 */
export interface Agent {
  /** Unique identifier (the key in config.agents, e.g. "main"). */
  id: string;

  /** Parsed and validated agent configuration. */
  config: AgentConfig;

  /** Absolute path to this agent's SOUL.md file. */
  soulPath: string;

  /** Absolute path to this agent's memory directory. */
  memoryDir: string;

  /** Absolute path to this agent's HEARTBEAT.md file. */
  heartbeatPath: string;

  /** Absolute path to this agent's root directory (~/.teamagents/agents/<id>). */
  baseDir: string;
}

// ---------------------------------------------------------------------------
// Inbound message — arrives from a channel adapter
// ---------------------------------------------------------------------------

/**
 * A message received from an external channel (Telegram, Slack, Discord, etc.).
 * Normalized by the channel adapter before being handed to the router.
 */
export interface InboundMessage {
  /** Channel the message originated from (e.g. "slack", "telegram"). */
  channel: string;

  /** Channel-specific user identifier (e.g. Slack user ID, Telegram user ID). */
  userId: string;

  /** Channel-specific chat/group identifier. Absent for DMs. */
  chatId?: string;

  /** The message text content. */
  text: string;

  /** Thread identifier for threaded conversations (e.g. Slack thread_ts). */
  threadId?: string;

  /** When the message was sent/received. */
  timestamp: Date;

  /** Optional raw event payload from the channel SDK (for debugging). */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Outbound message — sent to a channel adapter
// ---------------------------------------------------------------------------

/**
 * A message to be delivered via a channel adapter.
 */
export interface OutboundMessage {
  /** Target channel (e.g. "slack", "telegram"). */
  channel: string;

  /**
   * Recipient identifier, meaning varies by channel:
   *  - Slack: channel ID or user ID
   *  - Telegram: chat ID
   *  - Discord: channel ID
   *  - WebChat: session ID
   */
  to: string;

  /** Message text content (markdown supported). */
  text: string;

  /** Thread identifier to reply within a thread. */
  threadId?: string;
}

// ---------------------------------------------------------------------------
// Session status
// ---------------------------------------------------------------------------

/** Possible states for an agent session. */
export type SessionStatus = 'active' | 'idle' | 'terminated';

// ---------------------------------------------------------------------------
// Session record — stored in SQLite
// ---------------------------------------------------------------------------

/**
 * Represents a persisted session record from the store.
 */
export interface SessionRecord {
  /** Claude CLI session ID (returned by `--resume`). */
  id: string;

  /** Agent that owns this session. */
  agentId: string;

  /** Channel the session was initiated from (if any). */
  channel: string | null;

  /** Channel-specific user that initiated the session (if any). */
  channelUserId: string | null;

  /** Channel-specific chat/group ID (if any). */
  chatId: string | null;

  /** Current session state. */
  status: SessionStatus;

  /** ISO-8601 timestamp of session creation. */
  createdAt: string;

  /** ISO-8601 timestamp of last activity. */
  lastActiveAt: string;
}

// ---------------------------------------------------------------------------
// Skill status
// ---------------------------------------------------------------------------

/** Possible states for an installed skill. */
export type SkillStatus = 'pending' | 'active' | 'disabled';

// ---------------------------------------------------------------------------
// Message router
//
// Maps inbound messages (channel + userId + chatId) to an agent and a
// session key.  Priority order:
//   0. @mention in message text (e.g. "@jarvis do this")
//   1. Explicit routing rules from config (first match wins)
//   2. User-agent mapping from the store
//   3. Fall back to the default agent
// ---------------------------------------------------------------------------

import type { Config, RoutingRule } from '../config/schema.js';
import type { Store } from '../store/sqlite.js';
import type { InboundMessage } from '../agents/types.js';
import { buildSessionKey } from '../engine/session.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('router');

export interface RouteResult {
  agentId: string;
  sessionKey: string;
  /** The message text after stripping the @mention (if any). */
  text: string;
}

/**
 * Result of parsing an @mention from message text.
 */
export interface MentionParseResult {
  /** The matched agent ID, or null if no mention found. */
  agentId: string | null;
  /** The message text with the @mention stripped out and trimmed. */
  strippedText: string;
}

/**
 * Pattern to match @agentName at the start of a message or anywhere in it.
 * Matches: @jarvis, @Jarvis, @my-agent, @agent_1
 * Agent names can contain letters, numbers, hyphens, and underscores.
 */
const MENTION_PATTERN = /(?:^|\s)@([\w-]+)/;

export class MessageRouter {
  private rules: RoutingRule[];
  private defaultAgent: string;
  private agentIds: Set<string>;

  constructor(
    private config: Config,
    private store: Store,
  ) {
    this.rules = config.routing.rules;
    this.defaultAgent = config.routing.defaultAgent;
    // Build a lowercase set of known agent IDs for mention matching
    this.agentIds = new Set(
      Object.keys(config.agents).map((id) => id.toLowerCase()),
    );
  }

  /**
   * Determine which agent should handle a given inbound message and
   * the session key for deduplication/resumption.
   */
  route(msg: InboundMessage): RouteResult {
    // 0. Check for @mention in message text
    const mention = this.parseMention(msg.text);
    if (mention.agentId) {
      const sessionKey = buildSessionKey(mention.agentId, msg.channel, msg.userId, msg.chatId);
      logger.debug('Routed by @mention', { agent: mention.agentId, channel: msg.channel });
      return { agentId: mention.agentId, sessionKey, text: mention.strippedText };
    }

    // 1. Check explicit routing rules (first match wins)
    for (const rule of this.rules) {
      if (this.matchesRule(rule, msg)) {
        const sessionKey = buildSessionKey(rule.agentId, msg.channel, msg.userId, msg.chatId);
        logger.debug('Routed by rule', { agent: rule.agentId, channel: msg.channel });
        return { agentId: rule.agentId, sessionKey, text: msg.text };
      }
    }

    // 2. Check user-agent mapping in the database
    const user = this.store.getUser(msg.channel, msg.userId);
    if (user) {
      const sessionKey = buildSessionKey(user.agent_id, msg.channel, msg.userId, msg.chatId);
      logger.debug('Routed by user mapping', { agent: user.agent_id, user: msg.userId });
      return { agentId: user.agent_id, sessionKey, text: msg.text };
    }

    // 3. Fall back to default agent
    const sessionKey = buildSessionKey(this.defaultAgent, msg.channel, msg.userId, msg.chatId);
    logger.debug('Routed to default agent', { agent: this.defaultAgent });
    return { agentId: this.defaultAgent, sessionKey, text: msg.text };
  }

  /**
   * Parse an @mention from message text and resolve it to a known agent ID.
   * Returns the original agent ID (preserving case from config) and the
   * message text with the mention removed.
   */
  parseMention(text: string): MentionParseResult {
    const match = text.match(MENTION_PATTERN);
    if (!match) {
      return { agentId: null, strippedText: text };
    }

    const mentionedName = match[1]!.toLowerCase();

    if (!this.agentIds.has(mentionedName)) {
      return { agentId: null, strippedText: text };
    }

    // Resolve to the original-case agent ID from config
    const originalId = Object.keys(this.config.agents).find(
      (id) => id.toLowerCase() === mentionedName,
    )!;

    // Strip the @mention from the text
    const strippedText = text.replace(MENTION_PATTERN, '').trim();

    return { agentId: originalId, strippedText };
  }

  /**
   * Register a new agent ID for mention matching (e.g. when an agent
   * is created at runtime).
   */
  addAgent(agentId: string): void {
    this.agentIds.add(agentId.toLowerCase());
  }

  /**
   * Remove an agent ID from mention matching.
   */
  removeAgent(agentId: string): void {
    this.agentIds.delete(agentId.toLowerCase());
  }

  private matchesRule(rule: RoutingRule, msg: InboundMessage): boolean {
    if (rule.channel !== msg.channel) return false;
    if (rule.channelUserId && rule.channelUserId !== msg.userId) return false;
    if (rule.chatId && rule.chatId !== msg.chatId) return false;
    return true;
  }

  /**
   * Update the default agent for routing.
   */
  setDefaultAgent(agentId: string): void {
    this.defaultAgent = agentId;
  }

  /**
   * Get the current default agent.
   */
  getDefaultAgent(): string {
    return this.defaultAgent;
  }
}

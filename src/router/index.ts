// ---------------------------------------------------------------------------
// Message router
//
// Maps inbound messages (channel + userId + chatId) to an agent and a
// session key. Uses routing rules from config, user-agent assignments from
// the store, and falls back to the default agent.
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
}

export class MessageRouter {
  private rules: RoutingRule[];
  private defaultAgent: string;

  constructor(
    private config: Config,
    private store: Store,
  ) {
    this.rules = config.routing.rules;
    this.defaultAgent = config.routing.defaultAgent;
  }

  /**
   * Determine which agent should handle a given inbound message and
   * the session key for deduplication/resumption.
   */
  route(msg: InboundMessage): RouteResult {
    // 1. Check explicit routing rules (first match wins)
    for (const rule of this.rules) {
      if (this.matchesRule(rule, msg)) {
        const sessionKey = buildSessionKey(rule.agentId, msg.channel, msg.userId, msg.chatId);
        logger.debug('Routed by rule', { agent: rule.agentId, channel: msg.channel });
        return { agentId: rule.agentId, sessionKey };
      }
    }

    // 2. Check user-agent mapping in the database
    const user = this.store.getUser(msg.channel, msg.userId);
    if (user) {
      const sessionKey = buildSessionKey(user.agent_id, msg.channel, msg.userId, msg.chatId);
      logger.debug('Routed by user mapping', { agent: user.agent_id, user: msg.userId });
      return { agentId: user.agent_id, sessionKey };
    }

    // 3. Fall back to default agent
    const sessionKey = buildSessionKey(this.defaultAgent, msg.channel, msg.userId, msg.chatId);
    logger.debug('Routed to default agent', { agent: this.defaultAgent });
    return { agentId: this.defaultAgent, sessionKey };
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

import type { SessionRow } from '../store/sqlite.js';
import type { SessionStatus } from '../agents/types.js';

// Re-export the store's SessionRow for convenience
export type { SessionRow };

/**
 * Domain-level session state. A friendlier representation of SessionRow
 * with proper Date objects and optional fields instead of nulls.
 */
export interface SessionState {
  id: string;
  agentId: string;
  channel?: string;
  channelUserId?: string;
  chatId?: string;
  status: SessionStatus;
  createdAt: Date;
  lastActiveAt: Date;
}

/**
 * Converts a database row to a SessionState domain object.
 */
export function sessionFromRow(row: SessionRow): SessionState {
  return {
    id: row.id,
    agentId: row.agent_id,
    channel: row.channel ?? undefined,
    channelUserId: row.channel_user_id ?? undefined,
    chatId: row.chat_id ?? undefined,
    status: row.status,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  };
}

/**
 * Builds the session lookup key for queue management and dedup.
 *
 * - DMs use agent:channel:userId
 * - Group chats use agent:channel:chatId
 * - CLI sessions use agent:cli
 */
export function buildSessionKey(
  agentId: string,
  channel?: string,
  userId?: string,
  chatId?: string,
): string {
  if (chatId && channel) {
    return `agent:${agentId}:${channel}:${chatId}`;
  }
  if (userId && channel) {
    return `agent:${agentId}:${channel}:${userId}`;
  }
  return `agent:${agentId}:cli`;
}

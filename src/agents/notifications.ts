/**
 * Agent notification system.
 * Routes status updates to the user's preferred channel.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationConfig {
  /** Preferred channel for this user: "slack:#general", "telegram:12345", "discord:channelId", "webchat:clientId" */
  preferredChannel?: string;
  /** Minimum severity to notify: 'info' | 'warn' | 'error' | 'critical' */
  minSeverity?: NotificationSeverity;
  /** Quiet hours -- suppress non-critical notifications during these times */
  quietHours?: { start: string; end: string; timezone: string };
  /** Whether to batch low-severity notifications into digests */
  batchDigest?: boolean;
  /** Digest interval in minutes (default: 30) */
  digestIntervalMinutes?: number;
}

export type NotificationSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface Notification {
  agentId: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  timestamp: Date;
  /** Optional structured data */
  metadata?: Record<string, unknown>;
}

export interface Notifier {
  notify: (severity: NotificationSeverity, title: string, body: string) => void;
  flush: () => Notification[];
  getPending: () => Notification[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: '[info]',
  warn: '[warn]',
  error: '[error]',
  critical: '[CRITICAL]',
};

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Parse a channel target string like "slack:#general" into its components.
 * Returns `{ channel, target }` where channel is the adapter name and
 * target is the channel-specific destination.
 */
export function parseChannelTarget(input: string): { channel: string; target: string } {
  const colonIndex = input.indexOf(':');
  if (colonIndex === -1) {
    return { channel: input, target: '' };
  }
  return {
    channel: input.slice(0, colonIndex),
    target: input.slice(colonIndex + 1),
  };
}

/**
 * Check whether the current time falls within the configured quiet hours window.
 *
 * Quiet hours are specified as HH:MM strings with a timezone. The window can
 * span midnight (e.g. start=22:00, end=08:00).
 *
 * @param quietHours - The quiet hours configuration.
 * @param now - Optional Date to test against (defaults to current time).
 */
export function isQuietHours(
  quietHours: { start: string; end: string; timezone: string },
  now?: Date,
): boolean {
  const currentDate = now ?? new Date();

  // Parse HH:MM into minutes-since-midnight
  const startMinutes = parseTimeToMinutes(quietHours.start);
  const endMinutes = parseTimeToMinutes(quietHours.end);

  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  // Get the current time in the specified timezone as minutes since midnight.
  const currentMinutes = getMinutesInTimezone(currentDate, quietHours.timezone);

  if (startMinutes <= endMinutes) {
    // Simple case: quiet window does not span midnight (e.g. 01:00-05:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Window spans midnight (e.g. 22:00-08:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * Determine whether a notification should be delivered given the current
 * configuration. Checks severity threshold and quiet hours.
 */
export function shouldNotify(
  notification: Notification,
  config: NotificationConfig,
  now?: Date,
): boolean {
  const minSeverity = config.minSeverity ?? 'info';
  const notifLevel = SEVERITY_ORDER[notification.severity];
  const minLevel = SEVERITY_ORDER[minSeverity];

  // Below minimum severity threshold
  if (notifLevel < minLevel) {
    return false;
  }

  // During quiet hours, only critical notifications get through
  if (config.quietHours && notification.severity !== 'critical') {
    if (isQuietHours(config.quietHours, now)) {
      return false;
    }
  }

  return true;
}

/**
 * Format a notification into a human-readable plain-text string.
 *
 * Format:
 *   [SEVERITY] Agent "agentId" -- Title
 *   Body text here
 */
export function formatNotification(notification: Notification): string {
  const label = SEVERITY_LABELS[notification.severity];
  const time = notification.timestamp.toISOString();
  const lines = [
    `${label} Agent "${notification.agentId}" -- ${notification.title}`,
    notification.body,
    `  at ${time}`,
  ];
  return lines.join('\n');
}

/**
 * Create a notifier bound to a specific agent and configuration.
 *
 * The notifier maintains an internal queue of pending notifications.
 * - When `batchDigest` is true, info and warn notifications are queued
 *   and only delivered when `flush()` is called.
 * - Error and critical notifications are always placed in the immediate
 *   queue (returned by `flush()` on the next call) regardless of batching.
 * - `flush()` returns all pending notifications and clears the queue.
 * - `getPending()` returns the current queue without clearing it.
 */
export function createNotifier(agentId: string, config: NotificationConfig): Notifier {
  const pending: Notification[] = [];

  function notify(severity: NotificationSeverity, title: string, body: string): void {
    const notification: Notification = {
      agentId,
      severity,
      title,
      body,
      timestamp: new Date(),
    };

    // Check if we should even record this notification
    if (!shouldNotify(notification, config)) {
      return;
    }

    // Error and critical always go to the queue immediately.
    // For info/warn: if batchDigest is enabled, queue them; otherwise queue them too
    // (all notifications end up in the queue -- flush() is the delivery mechanism).
    pending.push(notification);
  }

  function flush(): Notification[] {
    const flushed = [...pending];
    pending.length = 0;
    return flushed;
  }

  function getPending(): Notification[] {
    return [...pending];
  }

  return { notify, flush, getPending };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a "HH:MM" string into total minutes since midnight.
 * Returns null if the format is invalid.
 */
function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Get the current time as minutes since midnight in the given timezone.
 * Falls back to UTC if the timezone is unrecognized.
 */
function getMinutesInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(
      parts.find((p) => p.type === 'hour')?.value ?? '0',
      10,
    );
    const minute = parseInt(
      parts.find((p) => p.type === 'minute')?.value ?? '0',
      10,
    );
    return hour * 60 + minute;
  } catch {
    // Fallback to UTC
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

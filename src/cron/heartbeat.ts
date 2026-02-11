// ---------------------------------------------------------------------------
// Heartbeat system
//
// Periodically sends checklist prompts to agents and delivers alerts when
// something needs attention. HEARTBEAT_OK responses are optionally suppressed.
// Active hours filtering prevents heartbeats at inappropriate times.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, AgentConfig } from '../config/schema.js';
import type { SessionManager } from '../engine/manager.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { ChannelAdapter } from '../channels/base.js';
import { getAgentsDir } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { logActivity } from '../utils/activity.js';

const logger = createLogger('heartbeat');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeartbeatState {
  agentId: string;
  timer: ReturnType<typeof setInterval>;
  lastBeat: Date | null;
  intervalMs: number;
}

// ---------------------------------------------------------------------------
// Interval parsing
// ---------------------------------------------------------------------------

const INTERVAL_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
};

/**
 * Parse a human-friendly interval string to milliseconds.
 * Accepts presets (5m, 15m, 30m, 1h, 4h, daily) or custom like "7m", "2h", "90m".
 * Falls back to 30 minutes for unknown values.
 */
export function parseInterval(interval: string): number {
  if (INTERVAL_MS[interval]) return INTERVAL_MS[interval];
  // Parse custom: "Nm" for minutes, "Nh" for hours
  const minuteMatch = interval.match(/^(\d+)m$/);
  if (minuteMatch) return Math.max(1, Number(minuteMatch[1])) * 60 * 1000;
  const hourMatch = interval.match(/^(\d+)h$/);
  if (hourMatch) return Math.max(1, Number(hourMatch[1])) * 60 * 60 * 1000;
  return 30 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Active hours checking
// ---------------------------------------------------------------------------

/**
 * Check whether the current time falls within the configured active hours
 * for an agent's heartbeat.
 *
 * @param config - The agent configuration containing heartbeat settings.
 * @returns `true` if heartbeat should fire, `false` if outside active hours.
 */
export function isWithinActiveHours(config: AgentConfig): boolean {
  const activeHours = config.heartbeat.activeHours;
  if (!activeHours) return true;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: activeHours.timezone,
  });

  // en-GB reliably gives "00:00" for midnight (en-US can give "24:00")
  const currentTime = formatter.format(now);
  return currentTime >= activeHours.start && currentTime <= activeHours.end;
}

// ---------------------------------------------------------------------------
// HeartbeatManager
// ---------------------------------------------------------------------------

export class HeartbeatManager {
  private beats: Map<string, HeartbeatState> = new Map();

  constructor(
    private config: Config,
    private sessionManager: SessionManager,
    private agentRegistry: AgentRegistry,
    private channels: Map<string, ChannelAdapter>,
  ) {}

  /**
   * Start heartbeat timers for all agents that have heartbeat enabled.
   */
  start(): void {
    for (const [agentId, agentConfig] of Object.entries(this.config.agents)) {
      if (agentConfig && agentConfig.heartbeat.enabled) {
        this.startHeartbeat(agentId, agentConfig);
      }
    }
    logger.info(`Heartbeat manager started`, { agents: this.beats.size });
  }

  /**
   * Stop all heartbeat timers.
   */
  stop(): void {
    for (const [agentId, state] of this.beats) {
      clearInterval(state.timer);
    }
    this.beats.clear();
    logger.info('All heartbeats stopped');
  }

  /**
   * Get the heartbeat state for a specific agent.
   */
  getState(agentId: string): HeartbeatState | undefined {
    return this.beats.get(agentId);
  }

  /**
   * Get all heartbeat states.
   */
  listStates(): Array<{
    agentId: string;
    lastBeat: Date | null;
    intervalMs: number;
  }> {
    return Array.from(this.beats.values()).map((s) => ({
      agentId: s.agentId,
      lastBeat: s.lastBeat,
      intervalMs: s.intervalMs,
    }));
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private startHeartbeat(agentId: string, config: AgentConfig): void {
    const intervalMs = parseInterval(config.heartbeat.interval);

    const timer = setInterval(async () => {
      await this.executeBeat(agentId, config);
    }, intervalMs);

    // Prevent the timer from keeping the Node.js process alive
    if (timer.unref) {
      timer.unref();
    }

    this.beats.set(agentId, {
      agentId,
      timer,
      lastBeat: null,
      intervalMs,
    });

    logger.info(`Heartbeat started for agent "${agentId}"`, {
      interval: config.heartbeat.interval,
      intervalMs,
    });
  }

  /**
   * Execute a single heartbeat for an agent.
   */
  private async executeBeat(
    agentId: string,
    config: AgentConfig,
  ): Promise<void> {
    // Check active hours
    if (!isWithinActiveHours(config)) {
      logger.debug(`Skipping heartbeat for "${agentId}" (outside active hours)`);
      return;
    }

    // Read HEARTBEAT.md
    const heartbeatPath = join(getAgentsDir(), agentId, 'HEARTBEAT.md');
    let checklist = '';
    if (existsSync(heartbeatPath)) {
      checklist = readFileSync(heartbeatPath, 'utf-8');
    }

    // Build heartbeat prompt
    const prompt = buildHeartbeatPrompt(checklist, config.heartbeat.mode);

    try {
      const result = await this.sessionManager.sendMessage(agentId, prompt);

      // Update last beat time
      const state = this.beats.get(agentId);
      if (state) {
        state.lastBeat = new Date();
      }

      // Check if the response indicates all-clear
      const isOk =
        result.text.trim() === 'HEARTBEAT_OK' ||
        result.text.includes('HEARTBEAT_OK');

      if (isOk && config.heartbeat.suppressOk) {
        logger.debug(`Heartbeat OK for "${agentId}"`);
        return;
      }

      // Deliver alert to configured channel
      if (config.heartbeat.deliverTo) {
        await this.deliverAlert(
          config.heartbeat.deliverTo,
          agentId,
          result.text,
        );
      }

      // Log to activity feed
      logActivity({
        type: 'heartbeat',
        agentId,
        title: `Heartbeat: ${agentId}`,
        description: isOk ? 'All clear' : result.text.slice(0, 200),
      });
    } catch (err) {
      logger.error(`Heartbeat failed for "${agentId}":`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Parse a "channel:target" string and deliver the heartbeat alert.
   */
  private async deliverAlert(
    deliverTo: string,
    agentId: string,
    text: string,
  ): Promise<void> {
    const colonIndex = deliverTo.indexOf(':');
    if (colonIndex === -1) return;

    const channelName = deliverTo.slice(0, colonIndex);
    const target = deliverTo.slice(colonIndex + 1);

    if (!channelName || !target) return;

    const adapter = this.channels.get(channelName);
    if (adapter?.isConnected()) {
      const message = `Heartbeat alert from **${agentId}**:\n\n${text}`;
      try {
        await adapter.sendMessage(target, message);
      } catch (err) {
        logger.error(`Failed to deliver heartbeat alert to ${deliverTo}:`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.warn(`Channel "${channelName}" not available for heartbeat delivery`);
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildHeartbeatPrompt(
  checklist: string,
  mode: 'check' | 'work' = 'check',
): string {
  const modeInstructions =
    mode === 'work'
      ? 'Review each item and perform any necessary actions.'
      : 'Review each item and report any issues that need attention.';

  if (checklist) {
    return [
      'Heartbeat check.',
      '',
      'Here is your checklist:',
      '',
      checklist,
      '',
      modeInstructions,
      'If nothing needs attention, respond with exactly: HEARTBEAT_OK',
    ].join('\n');
  }

  return [
    'Heartbeat check.',
    '',
    modeInstructions,
    'If nothing needs attention, respond with exactly: HEARTBEAT_OK',
  ].join('\n');
}

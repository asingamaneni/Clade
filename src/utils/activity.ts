import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface ActivityEvent {
  id: string;
  type: 'chat' | 'skill' | 'mcp' | 'reflection' | 'agent' | 'heartbeat' | 'cron' | 'backup' | 'delegation' | 'task_queue';
  agentId?: string;
  title: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const MAX_ACTIVITY_EVENTS = 1000;

function getActivityFilePath(): string {
  const cladeHome = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  return join(cladeHome, 'data', 'activity.json');
}

export function loadActivityLog(): ActivityEvent[] {
  try {
    const filePath = getActivityFilePath();
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveActivityLog(events: ActivityEvent[]): void {
  const filePath = getActivityFilePath();
  mkdirSync(join(filePath, '..'), { recursive: true });
  const trimmed = events.length > MAX_ACTIVITY_EVENTS
    ? events.slice(events.length - MAX_ACTIVITY_EVENTS)
    : events;
  writeFileSync(filePath, JSON.stringify(trimmed, null, 2), 'utf-8');
}

export function logActivity(
  event: Omit<ActivityEvent, 'id' | 'timestamp'>,
  broadcast?: (msg: Record<string, unknown>) => void,
): ActivityEvent {
  const full: ActivityEvent = {
    id: 'evt_' + randomUUID().slice(0, 12),
    timestamp: new Date().toISOString(),
    ...event,
  };
  const events = loadActivityLog();
  events.push(full);
  saveActivityLog(events);
  if (broadcast) {
    broadcast({ type: 'activity:new', event: full });
  }
  return full;
}

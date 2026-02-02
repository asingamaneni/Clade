// ---------------------------------------------------------------------------
// Inter-Agent Collaboration Protocol
//
// Provides three mechanisms for agents to work together:
//   1. Delegation  — one agent formally delegates a task to another
//   2. Shared Memory — agents in the same workspace can read each other's MEMORY.md
//   3. Message Bus — pub/sub topic system for agent communication
//
// All state is file-based (JSON), keeping collaborations portable and
// human-auditable.
// ---------------------------------------------------------------------------

import { getConfigDir } from '../config/index.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Delegation {
  id: string;
  fromAgent: string;
  toAgent: string;
  task: string;
  context: string;
  constraints?: string;
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TopicMessage {
  id: string;
  topic: string;
  fromAgent: string;
  payload: string;
  timestamp: string;
}

export interface Subscription {
  agentId: string;
  topic: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getCollaborationsDir(): string {
  return join(getConfigDir(), 'collaborations');
}

function getDelegationsDir(): string {
  return join(getCollaborationsDir(), 'delegations');
}

function getTopicsDir(): string {
  return join(getCollaborationsDir(), 'topics');
}

function getSubscriptionsPath(): string {
  return join(getCollaborationsDir(), 'subscriptions.json');
}

function getAgentsDir(): string {
  return join(getConfigDir(), 'agents');
}

// ---------------------------------------------------------------------------
// Subscriptions I/O helpers
// ---------------------------------------------------------------------------

function loadSubscriptions(): Subscription[] {
  const filepath = getSubscriptionsPath();
  if (!existsSync(filepath)) return [];
  const raw = readFileSync(filepath, 'utf-8');
  return JSON.parse(raw) as Subscription[];
}

function saveSubscriptions(subs: Subscription[]): void {
  const dir = getCollaborationsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getSubscriptionsPath(), JSON.stringify(subs, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

/**
 * Creates a delegation record and writes it to disk.
 * The delegation starts in 'pending' status.
 */
export function createDelegation(
  from: string,
  to: string,
  task: string,
  context: string,
  constraints?: string,
): Delegation {
  const id = randomUUID();
  const now = new Date().toISOString();

  const delegation: Delegation = {
    id,
    fromAgent: from,
    toAgent: to,
    task,
    context,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  if (constraints !== undefined) {
    delegation.constraints = constraints;
  }

  const dir = getDelegationsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(delegation, null, 2), 'utf-8');

  return delegation;
}

/**
 * Updates a delegation's status and optionally its result.
 * Throws if the delegation does not exist.
 */
export function updateDelegation(
  id: string,
  status: Delegation['status'],
  result?: string,
): Delegation {
  const filepath = join(getDelegationsDir(), `${id}.json`);

  if (!existsSync(filepath)) {
    throw new Error(`Delegation ${id} not found`);
  }

  const raw = readFileSync(filepath, 'utf-8');
  const delegation = JSON.parse(raw) as Delegation;

  delegation.status = status;
  delegation.updatedAt = new Date().toISOString();

  if (result !== undefined) {
    delegation.result = result;
  }

  writeFileSync(filepath, JSON.stringify(delegation, null, 2), 'utf-8');

  return delegation;
}

/**
 * Lists delegations for an agent, optionally filtered by role.
 *
 * - role 'from': only delegations where the agent is the delegator
 * - role 'to':   only delegations where the agent is the delegate
 * - no role:     all delegations involving the agent
 */
export function getDelegations(agentId: string, role?: 'from' | 'to'): Delegation[] {
  const dir = getDelegationsDir();

  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const delegations: Delegation[] = [];

  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8');
    const delegation = JSON.parse(raw) as Delegation;

    if (role === 'from' && delegation.fromAgent === agentId) {
      delegations.push(delegation);
    } else if (role === 'to' && delegation.toAgent === agentId) {
      delegations.push(delegation);
    } else if (!role && (delegation.fromAgent === agentId || delegation.toAgent === agentId)) {
      delegations.push(delegation);
    }
  }

  return delegations;
}

// ---------------------------------------------------------------------------
// Message Bus
// ---------------------------------------------------------------------------

/**
 * Publishes a message to a topic.
 * Creates the topic directory if it does not exist.
 */
export function publishMessage(
  topic: string,
  fromAgent: string,
  payload: string,
): TopicMessage {
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  const message: TopicMessage = {
    id,
    topic,
    fromAgent,
    payload,
    timestamp,
  };

  const topicDir = join(getTopicsDir(), topic);
  mkdirSync(topicDir, { recursive: true });

  // Sanitize timestamp for filename (colons are problematic on some filesystems)
  const safeTimestamp = timestamp.replace(/:/g, '-');
  const filename = `${safeTimestamp}-${id}.json`;
  writeFileSync(join(topicDir, filename), JSON.stringify(message, null, 2), 'utf-8');

  return message;
}

/**
 * Adds a subscription for an agent to a topic.
 * Idempotent: does nothing if the subscription already exists.
 */
export function subscribe(agentId: string, topic: string): void {
  const subs = loadSubscriptions();

  const exists = subs.some((s) => s.agentId === agentId && s.topic === topic);
  if (exists) return;

  subs.push({
    agentId,
    topic,
    createdAt: new Date().toISOString(),
  });

  saveSubscriptions(subs);
}

/**
 * Removes a subscription for an agent from a topic.
 */
export function unsubscribe(agentId: string, topic: string): void {
  const subs = loadSubscriptions();
  const filtered = subs.filter((s) => !(s.agentId === agentId && s.topic === topic));
  saveSubscriptions(filtered);
}

/**
 * Gets messages on a topic, optionally filtering to those published
 * strictly after the given ISO-8601 timestamp.
 * Results are sorted by timestamp ascending.
 */
export function getMessages(topic: string, since?: string): TopicMessage[] {
  const topicDir = join(getTopicsDir(), topic);

  if (!existsSync(topicDir)) return [];

  const files = readdirSync(topicDir).filter((f) => f.endsWith('.json'));
  const messages: TopicMessage[] = [];

  for (const file of files) {
    const raw = readFileSync(join(topicDir, file), 'utf-8');
    const message = JSON.parse(raw) as TopicMessage;

    if (since && message.timestamp <= since) {
      continue;
    }

    messages.push(message);
  }

  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return messages;
}

/**
 * Returns list of topic names an agent is subscribed to.
 */
export function getSubscriptions(agentId: string): string[] {
  const subs = loadSubscriptions();
  return subs.filter((s) => s.agentId === agentId).map((s) => s.topic);
}

// ---------------------------------------------------------------------------
// Shared Memory
// ---------------------------------------------------------------------------

/**
 * Returns the target agent's MEMORY.md content if both agents are in the
 * same workspace (i.e. both have directories under the same agents/ root).
 *
 * Only MEMORY.md is shared between peers. SOUL.md remains private to each
 * agent and is never exposed through this function.
 *
 * Returns null if:
 *   - Either agent does not exist in the workspace
 *   - The target agent has no MEMORY.md file
 */
export function getSharedMemory(requestingAgent: string, targetAgent: string): string | null {
  const agentsDir = getAgentsDir();

  const requestingDir = join(agentsDir, requestingAgent);
  const targetDir = join(agentsDir, targetAgent);

  // Both agents must exist in the same workspace (agents directory)
  if (!existsSync(requestingDir) || !existsSync(targetDir)) {
    return null;
  }

  // Only MEMORY.md is shared; SOUL.md is private
  const memoryPath = join(targetDir, 'MEMORY.md');
  if (!existsSync(memoryPath)) {
    return null;
  }

  return readFileSync(memoryPath, 'utf-8');
}

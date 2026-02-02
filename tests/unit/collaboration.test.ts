// ---------------------------------------------------------------------------
// Tests: Inter-Agent Collaboration Protocol
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TopicMessage } from '../../src/agents/collaboration.js';
import {
  createDelegation,
  updateDelegation,
  getDelegations,
  publishMessage,
  subscribe,
  unsubscribe,
  getMessages,
  getSubscriptions,
  getSharedMemory,
} from '../../src/agents/collaboration.js';

const TEST_HOME = join(tmpdir(), `clade-test-collab-${Date.now()}`);

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

describe('Delegation', () => {
  beforeEach(() => {
    process.env['CLADE_HOME'] = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, 'agents'), { recursive: true });
  });

  afterEach(() => {
    delete process.env['CLADE_HOME'];
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  it('should create a delegation and write the file to disk', () => {
    const delegation = createDelegation(
      'agent-a',
      'agent-b',
      'Refactor the auth module',
      'The auth module needs to use JWT instead of sessions',
      'Do not change the public API surface',
    );

    expect(delegation.id).toBeDefined();
    expect(delegation.fromAgent).toBe('agent-a');
    expect(delegation.toAgent).toBe('agent-b');
    expect(delegation.task).toBe('Refactor the auth module');
    expect(delegation.context).toBe('The auth module needs to use JWT instead of sessions');
    expect(delegation.constraints).toBe('Do not change the public API surface');
    expect(delegation.status).toBe('pending');
    expect(delegation.createdAt).toBeDefined();
    expect(delegation.updatedAt).toBeDefined();

    // Verify the file was written to disk
    const filepath = join(TEST_HOME, 'collaborations', 'delegations', `${delegation.id}.json`);
    expect(existsSync(filepath)).toBe(true);

    const onDisk = JSON.parse(readFileSync(filepath, 'utf-8'));
    expect(onDisk.id).toBe(delegation.id);
    expect(onDisk.task).toBe('Refactor the auth module');
    expect(onDisk.status).toBe('pending');
  });

  it('should create a delegation without constraints', () => {
    const delegation = createDelegation(
      'agent-a',
      'agent-b',
      'Write tests',
      'We need unit tests for the router module',
    );

    expect(delegation.constraints).toBeUndefined();
  });

  it('should update delegation status', () => {
    const delegation = createDelegation(
      'agent-a',
      'agent-b',
      'Deploy the service',
      'Deploy to staging environment',
    );

    const updated = updateDelegation(delegation.id, 'in_progress');

    expect(updated.status).toBe('in_progress');
    expect(updated.updatedAt).not.toBe(delegation.createdAt);

    // Verify persistence
    const filepath = join(TEST_HOME, 'collaborations', 'delegations', `${delegation.id}.json`);
    const onDisk = JSON.parse(readFileSync(filepath, 'utf-8'));
    expect(onDisk.status).toBe('in_progress');
  });

  it('should update delegation status with a result', () => {
    const delegation = createDelegation(
      'agent-a',
      'agent-b',
      'Analyze logs',
      'Check for error patterns in the last 24h',
    );

    const updated = updateDelegation(delegation.id, 'completed', 'Found 3 recurring timeout errors');

    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('Found 3 recurring timeout errors');
  });

  it('should throw when updating a non-existent delegation', () => {
    expect(() => updateDelegation('non-existent-id', 'completed')).toThrow(
      'Delegation non-existent-id not found',
    );
  });

  it('should get delegations filtered by from role', () => {
    createDelegation('agent-a', 'agent-b', 'task-1', 'ctx-1');
    createDelegation('agent-a', 'agent-c', 'task-2', 'ctx-2');
    createDelegation('agent-b', 'agent-a', 'task-3', 'ctx-3');

    const fromA = getDelegations('agent-a', 'from');

    expect(fromA).toHaveLength(2);
    expect(fromA.every((d) => d.fromAgent === 'agent-a')).toBe(true);
  });

  it('should get delegations filtered by to role', () => {
    createDelegation('agent-a', 'agent-b', 'task-1', 'ctx-1');
    createDelegation('agent-c', 'agent-b', 'task-2', 'ctx-2');
    createDelegation('agent-b', 'agent-a', 'task-3', 'ctx-3');

    const toB = getDelegations('agent-b', 'to');

    expect(toB).toHaveLength(2);
    expect(toB.every((d) => d.toAgent === 'agent-b')).toBe(true);
  });

  it('should get all delegations for an agent when no role is specified', () => {
    createDelegation('agent-a', 'agent-b', 'task-1', 'ctx-1');
    createDelegation('agent-c', 'agent-a', 'task-2', 'ctx-2');
    createDelegation('agent-b', 'agent-c', 'task-3', 'ctx-3');

    const allForA = getDelegations('agent-a');

    expect(allForA).toHaveLength(2);
  });

  it('should return empty array when no delegations exist', () => {
    const result = getDelegations('agent-x');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Message Bus
// ---------------------------------------------------------------------------

describe('Message Bus', () => {
  beforeEach(() => {
    process.env['CLADE_HOME'] = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, 'agents'), { recursive: true });
  });

  afterEach(() => {
    delete process.env['CLADE_HOME'];
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  it('should publish a message and retrieve it', () => {
    const msg = publishMessage('deployments', 'agent-a', 'Deployed v1.2.3 to staging');

    expect(msg.id).toBeDefined();
    expect(msg.topic).toBe('deployments');
    expect(msg.fromAgent).toBe('agent-a');
    expect(msg.payload).toBe('Deployed v1.2.3 to staging');
    expect(msg.timestamp).toBeDefined();

    // Verify the file was written under the topic directory
    const topicDir = join(TEST_HOME, 'collaborations', 'topics', 'deployments');
    expect(existsSync(topicDir)).toBe(true);

    const messages = getMessages('deployments');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.id).toBe(msg.id);
    expect(messages[0]!.payload).toBe('Deployed v1.2.3 to staging');
  });

  it('should retrieve multiple messages sorted by timestamp', () => {
    // Write messages with explicit timestamps to guarantee ordering
    const topicDir = join(TEST_HOME, 'collaborations', 'topics', 'builds');
    mkdirSync(topicDir, { recursive: true });

    const msg1: TopicMessage = {
      id: 'msg-1',
      topic: 'builds',
      fromAgent: 'ci-agent',
      payload: 'Build started',
      timestamp: '2024-01-15T10:00:00.000Z',
    };

    const msg2: TopicMessage = {
      id: 'msg-2',
      topic: 'builds',
      fromAgent: 'ci-agent',
      payload: 'Build completed',
      timestamp: '2024-01-15T10:05:00.000Z',
    };

    // Write in reverse order to verify sorting
    writeFileSync(join(topicDir, '2024-01-15T10-05-00.000Z-msg-2.json'), JSON.stringify(msg2));
    writeFileSync(join(topicDir, '2024-01-15T10-00-00.000Z-msg-1.json'), JSON.stringify(msg1));

    const messages = getMessages('builds');
    expect(messages).toHaveLength(2);
    expect(messages[0]!.payload).toBe('Build started');
    expect(messages[1]!.payload).toBe('Build completed');
  });

  it('should filter messages with since parameter', () => {
    const topicDir = join(TEST_HOME, 'collaborations', 'topics', 'alerts');
    mkdirSync(topicDir, { recursive: true });

    const oldMsg: TopicMessage = {
      id: 'old-1',
      topic: 'alerts',
      fromAgent: 'monitor',
      payload: 'CPU spike at 8am',
      timestamp: '2024-01-15T08:00:00.000Z',
    };

    const newMsg: TopicMessage = {
      id: 'new-1',
      topic: 'alerts',
      fromAgent: 'monitor',
      payload: 'Memory warning at 2pm',
      timestamp: '2024-01-15T14:00:00.000Z',
    };

    writeFileSync(join(topicDir, '2024-01-15T08-00-00.000Z-old-1.json'), JSON.stringify(oldMsg));
    writeFileSync(join(topicDir, '2024-01-15T14-00-00.000Z-new-1.json'), JSON.stringify(newMsg));

    // Only messages after noon
    const results = getMessages('alerts', '2024-01-15T12:00:00.000Z');
    expect(results).toHaveLength(1);
    expect(results[0]!.payload).toBe('Memory warning at 2pm');
  });

  it('should return empty array for non-existent topic', () => {
    const messages = getMessages('no-such-topic');
    expect(messages).toEqual([]);
  });

  it('should exclude messages with timestamp equal to since', () => {
    const topicDir = join(TEST_HOME, 'collaborations', 'topics', 'exact');
    mkdirSync(topicDir, { recursive: true });

    const msg: TopicMessage = {
      id: 'exact-1',
      topic: 'exact',
      fromAgent: 'agent-a',
      payload: 'exact match',
      timestamp: '2024-06-01T12:00:00.000Z',
    };

    writeFileSync(join(topicDir, '2024-06-01T12-00-00.000Z-exact-1.json'), JSON.stringify(msg));

    // Using the exact timestamp as since should exclude this message
    const results = getMessages('exact', '2024-06-01T12:00:00.000Z');
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

describe('Subscriptions', () => {
  beforeEach(() => {
    process.env['CLADE_HOME'] = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, 'agents'), { recursive: true });
  });

  afterEach(() => {
    delete process.env['CLADE_HOME'];
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  it('should subscribe an agent to a topic', () => {
    subscribe('agent-a', 'deployments');

    const topics = getSubscriptions('agent-a');
    expect(topics).toEqual(['deployments']);
  });

  it('should subscribe to multiple topics', () => {
    subscribe('agent-a', 'deployments');
    subscribe('agent-a', 'alerts');
    subscribe('agent-a', 'builds');

    const topics = getSubscriptions('agent-a');
    expect(topics).toHaveLength(3);
    expect(topics).toContain('deployments');
    expect(topics).toContain('alerts');
    expect(topics).toContain('builds');
  });

  it('should be idempotent (subscribing twice does not duplicate)', () => {
    subscribe('agent-a', 'deployments');
    subscribe('agent-a', 'deployments');

    const topics = getSubscriptions('agent-a');
    expect(topics).toEqual(['deployments']);
  });

  it('should unsubscribe an agent from a topic', () => {
    subscribe('agent-a', 'deployments');
    subscribe('agent-a', 'alerts');

    unsubscribe('agent-a', 'deployments');

    const topics = getSubscriptions('agent-a');
    expect(topics).toEqual(['alerts']);
  });

  it('should handle unsubscribe for non-existent subscription gracefully', () => {
    // Should not throw
    unsubscribe('agent-x', 'no-such-topic');
    const topics = getSubscriptions('agent-x');
    expect(topics).toEqual([]);
  });

  it('should isolate subscriptions between agents', () => {
    subscribe('agent-a', 'deployments');
    subscribe('agent-b', 'alerts');

    expect(getSubscriptions('agent-a')).toEqual(['deployments']);
    expect(getSubscriptions('agent-b')).toEqual(['alerts']);
  });

  it('should persist subscriptions to disk', () => {
    subscribe('agent-a', 'events');

    const filepath = join(TEST_HOME, 'collaborations', 'subscriptions.json');
    expect(existsSync(filepath)).toBe(true);

    const onDisk = JSON.parse(readFileSync(filepath, 'utf-8'));
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].agentId).toBe('agent-a');
    expect(onDisk[0].topic).toBe('events');
    expect(onDisk[0].createdAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Shared Memory
// ---------------------------------------------------------------------------

describe('Shared Memory', () => {
  beforeEach(() => {
    process.env['CLADE_HOME'] = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, 'agents'), { recursive: true });
  });

  afterEach(() => {
    delete process.env['CLADE_HOME'];
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  it('should return MEMORY.md content for peer agents', () => {
    // Create two agents in the same workspace
    const agentADir = join(TEST_HOME, 'agents', 'agent-a');
    const agentBDir = join(TEST_HOME, 'agents', 'agent-b');
    mkdirSync(agentADir, { recursive: true });
    mkdirSync(agentBDir, { recursive: true });

    const memoryContent = '# Memory\n\n- User prefers dark mode\n- Deploy schedule: Tuesdays\n';
    writeFileSync(join(agentBDir, 'MEMORY.md'), memoryContent, 'utf-8');
    writeFileSync(join(agentADir, 'MEMORY.md'), '# Memory\n\nAgent A notes.\n', 'utf-8');

    const result = getSharedMemory('agent-a', 'agent-b');
    expect(result).toBe(memoryContent);
  });

  it('should return null when requesting agent does not exist', () => {
    const agentBDir = join(TEST_HOME, 'agents', 'agent-b');
    mkdirSync(agentBDir, { recursive: true });
    writeFileSync(join(agentBDir, 'MEMORY.md'), '# Memory\n', 'utf-8');

    const result = getSharedMemory('non-existent', 'agent-b');
    expect(result).toBeNull();
  });

  it('should return null when target agent does not exist', () => {
    const agentADir = join(TEST_HOME, 'agents', 'agent-a');
    mkdirSync(agentADir, { recursive: true });

    const result = getSharedMemory('agent-a', 'non-existent');
    expect(result).toBeNull();
  });

  it('should return null when target agent has no MEMORY.md', () => {
    const agentADir = join(TEST_HOME, 'agents', 'agent-a');
    const agentBDir = join(TEST_HOME, 'agents', 'agent-b');
    mkdirSync(agentADir, { recursive: true });
    mkdirSync(agentBDir, { recursive: true });

    // agent-b exists but has no MEMORY.md
    const result = getSharedMemory('agent-a', 'agent-b');
    expect(result).toBeNull();
  });

  it('should not expose SOUL.md through shared memory', () => {
    const agentADir = join(TEST_HOME, 'agents', 'agent-a');
    const agentBDir = join(TEST_HOME, 'agents', 'agent-b');
    mkdirSync(agentADir, { recursive: true });
    mkdirSync(agentBDir, { recursive: true });

    const soulContent = '# SOUL.md\n\nThis is private personality data.\n';
    const memoryContent = '# Memory\n\nThis is shared memory data.\n';
    writeFileSync(join(agentBDir, 'SOUL.md'), soulContent, 'utf-8');
    writeFileSync(join(agentBDir, 'MEMORY.md'), memoryContent, 'utf-8');
    writeFileSync(join(agentADir, 'MEMORY.md'), '# Memory\n', 'utf-8');

    const result = getSharedMemory('agent-a', 'agent-b');

    // Should return MEMORY.md content, not SOUL.md content
    expect(result).toBe(memoryContent);
    expect(result).not.toContain('private personality data');
  });
});

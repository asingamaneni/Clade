// ---------------------------------------------------------------------------
// Tests: Collaboration REST API routes (integration-style via collaboration.ts)
//
// These tests verify the collaboration functions work correctly when called
// in the same patterns as the REST API routes in start.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

const TEST_HOME = join(tmpdir(), `clade-test-collab-routes-${Date.now()}`);

// ---------------------------------------------------------------------------
// Helpers — simulate what start.ts routes do
// ---------------------------------------------------------------------------

function listAllDelegations(): any[] {
  const dir = join(TEST_HOME, 'collaborations', 'delegations');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  return files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')));
}

function listTopics(): { name: string; messageCount: number }[] {
  const topicsDir = join(TEST_HOME, 'collaborations', 'topics');
  if (!existsSync(topicsDir)) return [];
  return readdirSync(topicsDir)
    .filter((name) => {
      try {
        return statSync(join(topicsDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((name) => {
      const files = readdirSync(join(topicsDir, name)).filter((f) =>
        f.endsWith('.json'),
      );
      return { name, messageCount: files.length };
    });
}

function listAllSubscriptions(): any[] {
  const subsPath = join(TEST_HOME, 'collaborations', 'subscriptions.json');
  if (!existsSync(subsPath)) return [];
  return JSON.parse(readFileSync(subsPath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('Collaboration REST route patterns', () => {
  beforeEach(() => {
    process.env['CLADE_HOME'] = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
    delete process.env['CLADE_HOME'];
  });

  // ── Delegation routes ──────────────────────────────────────

  describe('Delegation CRUD', () => {
    it('should create and list delegations', () => {
      const d = createDelegation('jarvis', 'scout', 'Review PR #42', 'Code changes in src/');
      expect(d.id).toBeDefined();
      expect(d.status).toBe('pending');

      const all = listAllDelegations();
      expect(all.length).toBe(1);
      expect(all[0].fromAgent).toBe('jarvis');
      expect(all[0].toAgent).toBe('scout');
    });

    it('should filter delegations by agentId and role', () => {
      createDelegation('jarvis', 'scout', 'Task A', 'Context A');
      createDelegation('scout', 'jarvis', 'Task B', 'Context B');
      createDelegation('jarvis', 'ops', 'Task C', 'Context C');

      const fromJarvis = getDelegations('jarvis', 'from');
      expect(fromJarvis.length).toBe(2);

      const toJarvis = getDelegations('jarvis', 'to');
      expect(toJarvis.length).toBe(1);
      expect(toJarvis[0].task).toBe('Task B');

      const allJarvis = getDelegations('jarvis');
      expect(allJarvis.length).toBe(3);
    });

    it('should update delegation status and result', () => {
      const d = createDelegation('jarvis', 'scout', 'Deploy app', 'Production deploy');
      const updated = updateDelegation(d.id, 'completed', 'Deployed v2.1.0 successfully');

      expect(updated.status).toBe('completed');
      expect(updated.result).toBe('Deployed v2.1.0 successfully');
      expect(updated.updatedAt).not.toBe(d.createdAt);
    });

    it('should throw on update of non-existent delegation', () => {
      expect(() => updateDelegation('non-existent-id', 'completed')).toThrow();
    });

    it('should include constraints when provided', () => {
      const d = createDelegation('jarvis', 'scout', 'Refactor', 'Code cleanup', 'Only touch src/utils/');
      expect(d.constraints).toBe('Only touch src/utils/');

      const all = listAllDelegations();
      expect(all[0].constraints).toBe('Only touch src/utils/');
    });
  });

  // ── Pub/Sub routes ─────────────────────────────────────────

  describe('Message Bus', () => {
    it('should publish messages and list topics', () => {
      publishMessage('code-reviews', 'jarvis', 'PR #42 needs review');
      publishMessage('code-reviews', 'scout', 'Reviewed PR #42 — LGTM');
      publishMessage('deployments', 'jarvis', 'Deploying v2.1.0');

      const topics = listTopics();
      expect(topics.length).toBe(2);

      const cr = topics.find((t) => t.name === 'code-reviews');
      expect(cr?.messageCount).toBe(2);

      const dep = topics.find((t) => t.name === 'deployments');
      expect(dep?.messageCount).toBe(1);
    });

    it('should retrieve messages for a topic', () => {
      publishMessage('alerts', 'jarvis', 'Alert 1');
      publishMessage('alerts', 'scout', 'Alert 2');

      const msgs = getMessages('alerts');
      expect(msgs.length).toBe(2);
      const payloads = msgs.map((m) => m.payload).sort();
      expect(payloads).toEqual(['Alert 1', 'Alert 2']);
    });

    it('should filter messages by since timestamp', () => {
      const m1 = publishMessage('updates', 'jarvis', 'First update');

      // Small delay to ensure different timestamps
      const m2 = publishMessage('updates', 'scout', 'Second update');

      const afterFirst = getMessages('updates', m1.timestamp);
      // Messages strictly after m1's timestamp
      expect(afterFirst.every((m) => m.timestamp > m1.timestamp)).toBe(true);
    });

    it('should return empty for non-existent topic', () => {
      const msgs = getMessages('nonexistent');
      expect(msgs).toEqual([]);

      const topics = listTopics();
      expect(topics.length).toBe(0);
    });
  });

  // ── Subscription routes ────────────────────────────────────

  describe('Subscriptions', () => {
    it('should subscribe and list subscriptions', () => {
      subscribe('jarvis', 'code-reviews');
      subscribe('jarvis', 'deployments');
      subscribe('scout', 'code-reviews');

      const all = listAllSubscriptions();
      expect(all.length).toBe(3);

      const jarvisSubs = getSubscriptions('jarvis');
      expect(jarvisSubs).toContain('code-reviews');
      expect(jarvisSubs).toContain('deployments');
      expect(jarvisSubs.length).toBe(2);
    });

    it('should unsubscribe correctly', () => {
      subscribe('jarvis', 'alerts');
      subscribe('jarvis', 'builds');

      unsubscribe('jarvis', 'alerts');

      const subs = getSubscriptions('jarvis');
      expect(subs).toEqual(['builds']);
    });

    it('should be idempotent on subscribe', () => {
      subscribe('jarvis', 'code-reviews');
      subscribe('jarvis', 'code-reviews');

      const all = listAllSubscriptions();
      const jarvisCr = all.filter(
        (s: any) => s.agentId === 'jarvis' && s.topic === 'code-reviews',
      );
      expect(jarvisCr.length).toBe(1);
    });

    it('should filter subscriptions by agentId', () => {
      subscribe('jarvis', 'topic-a');
      subscribe('scout', 'topic-b');

      const jarvisSubs = getSubscriptions('jarvis');
      expect(jarvisSubs).toEqual(['topic-a']);

      const scoutSubs = getSubscriptions('scout');
      expect(scoutSubs).toEqual(['topic-b']);
    });
  });

  // ── Shared Memory routes ───────────────────────────────────

  describe('Shared Memory', () => {
    it('should return MEMORY.md content for valid agents', () => {
      const agentsDir = join(TEST_HOME, 'agents');
      mkdirSync(join(agentsDir, 'jarvis'), { recursive: true });
      mkdirSync(join(agentsDir, 'scout'), { recursive: true });
      writeFileSync(
        join(agentsDir, 'scout', 'MEMORY.md'),
        '# Scout Memory\n\n- Found bug in auth module',
        'utf-8',
      );

      const memory = getSharedMemory('jarvis', 'scout');
      expect(memory).toContain('Scout Memory');
      expect(memory).toContain('bug in auth module');
    });

    it('should return null if target agent has no MEMORY.md', () => {
      const agentsDir = join(TEST_HOME, 'agents');
      mkdirSync(join(agentsDir, 'jarvis'), { recursive: true });
      mkdirSync(join(agentsDir, 'scout'), { recursive: true });

      const memory = getSharedMemory('jarvis', 'scout');
      expect(memory).toBeNull();
    });

    it('should return null if requesting agent does not exist', () => {
      const agentsDir = join(TEST_HOME, 'agents');
      mkdirSync(join(agentsDir, 'scout'), { recursive: true });
      writeFileSync(join(agentsDir, 'scout', 'MEMORY.md'), 'data', 'utf-8');

      const memory = getSharedMemory('nonexistent', 'scout');
      expect(memory).toBeNull();
    });

    it('should never expose SOUL.md', () => {
      const agentsDir = join(TEST_HOME, 'agents');
      mkdirSync(join(agentsDir, 'jarvis'), { recursive: true });
      mkdirSync(join(agentsDir, 'scout'), { recursive: true });
      writeFileSync(join(agentsDir, 'scout', 'MEMORY.md'), 'memory data', 'utf-8');
      writeFileSync(join(agentsDir, 'scout', 'SOUL.md'), 'private soul', 'utf-8');

      const memory = getSharedMemory('jarvis', 'scout');
      expect(memory).toBe('memory data');
      expect(memory).not.toContain('private soul');
    });
  });

  // ── End-to-end workflow ────────────────────────────────────

  describe('End-to-end collaboration workflow', () => {
    it('should support a full delegation + pub/sub workflow', () => {
      // 1. Subscribe scout to task-updates
      subscribe('scout', 'task-updates');

      // 2. Jarvis delegates a task to scout
      const delegation = createDelegation(
        'jarvis',
        'scout',
        'Review PR #99',
        'Changes in src/engine/',
        'Focus on performance',
      );

      // 3. Jarvis publishes notification about the delegation
      publishMessage('task-updates', 'jarvis', `New delegation: ${delegation.id}`);

      // 4. Scout checks subscribed topics for messages
      const scoutTopics = getSubscriptions('scout');
      expect(scoutTopics).toContain('task-updates');

      const msgs = getMessages('task-updates');
      expect(msgs.length).toBe(1);
      expect(msgs[0].payload).toContain(delegation.id);

      // 5. Scout accepts and completes the delegation
      updateDelegation(delegation.id, 'accepted');
      updateDelegation(delegation.id, 'in_progress');
      const result = updateDelegation(delegation.id, 'completed', 'All good, approved');

      expect(result.status).toBe('completed');
      expect(result.result).toBe('All good, approved');

      // 6. Scout publishes completion notification
      publishMessage('task-updates', 'scout', `Completed delegation: ${delegation.id}`);

      const allMsgs = getMessages('task-updates');
      expect(allMsgs.length).toBe(2);
    });
  });
});

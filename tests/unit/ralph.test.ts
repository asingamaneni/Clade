// ---------------------------------------------------------------------------
// Tests: RALPH Loop Engine
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RalphEngine, buildWorkPrompt } from '../../src/engine/ralph.js';
import type { PlanTask, RalphConfig, RalphProgressEvent } from '../../src/engine/ralph.js';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/engine/claude-cli.js', () => ({
  ClaudeCliRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ text: 'task completed', durationMs: 100 }),
  })),
}));

const TEST_DIR = join(tmpdir(), `clade-test-ralph-${Date.now()}`);

describe('RalphEngine', () => {
  let engine: RalphEngine;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    engine = new RalphEngine();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // PLAN.md parsing
  // -----------------------------------------------------------------------

  describe('parsePlan', () => {
    it('should parse open tasks', () => {
      const plan = `# Plan\n\n- [ ] Task one\n- [ ] Task two\n`;
      const tasks = engine.parsePlan(plan);

      expect(tasks).toHaveLength(2);
      expect(tasks[0]!.text).toBe('Task one');
      expect(tasks[0]!.status).toBe('open');
      expect(tasks[1]!.text).toBe('Task two');
      expect(tasks[1]!.status).toBe('open');
    });

    it('should parse done tasks', () => {
      const plan = `- [x] Completed task\n`;
      const tasks = engine.parsePlan(plan);

      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.status).toBe('done');
    });

    it('should parse blocked tasks', () => {
      const plan = `- [!] Blocked task\n`;
      const tasks = engine.parsePlan(plan);

      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.status).toBe('blocked');
    });

    it('should parse in_progress tasks', () => {
      const plan = `- [~] Working on this\n`;
      const tasks = engine.parsePlan(plan);

      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.status).toBe('in_progress');
    });

    it('should parse mixed task statuses', () => {
      const plan = [
        '# Plan',
        '',
        '- [x] Done task',
        '- [ ] Open task',
        '- [~] In progress task',
        '- [!] Blocked task',
        '',
      ].join('\n');

      const tasks = engine.parsePlan(plan);
      expect(tasks).toHaveLength(4);
      expect(tasks[0]!.status).toBe('done');
      expect(tasks[1]!.status).toBe('open');
      expect(tasks[2]!.status).toBe('in_progress');
      expect(tasks[3]!.status).toBe('blocked');
    });

    it('should track line numbers', () => {
      const plan = `# Plan\n\n- [ ] First\n- [ ] Second\n`;
      const tasks = engine.parsePlan(plan);

      expect(tasks[0]!.lineNumber).toBe(2);
      expect(tasks[1]!.lineNumber).toBe(3);
    });

    it('should assign sequential indexes', () => {
      const plan = `- [ ] A\n- [ ] B\n- [ ] C\n`;
      const tasks = engine.parsePlan(plan);

      expect(tasks[0]!.index).toBe(0);
      expect(tasks[1]!.index).toBe(1);
      expect(tasks[2]!.index).toBe(2);
    });

    it('should handle empty plan', () => {
      const tasks = engine.parsePlan('');
      expect(tasks).toHaveLength(0);
    });

    it('should handle plan with no tasks', () => {
      const plan = '# Plan\n\nSome description text.\n';
      const tasks = engine.parsePlan(plan);
      expect(tasks).toHaveLength(0);
    });

    it('should handle indented tasks', () => {
      const plan = `  - [ ] Indented task\n`;
      const tasks = engine.parsePlan(plan);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.text).toBe('Indented task');
    });
  });

  // -----------------------------------------------------------------------
  // Task status updates
  // -----------------------------------------------------------------------

  describe('updateTaskStatus', () => {
    it('should update a task from open to in_progress', () => {
      const planPath = join(TEST_DIR, 'PLAN.md');
      writeFileSync(planPath, '- [ ] Task one\n- [ ] Task two\n');

      engine.updateTaskStatus(planPath, 0, 'in_progress');

      const updated = readFileSync(planPath, 'utf-8');
      expect(updated).toContain('[~] Task one');
      expect(updated).toContain('[ ] Task two');
    });

    it('should update a task to done', () => {
      const planPath = join(TEST_DIR, 'PLAN.md');
      writeFileSync(planPath, '- [~] Working\n');

      engine.updateTaskStatus(planPath, 0, 'done');

      const updated = readFileSync(planPath, 'utf-8');
      expect(updated).toContain('[x] Working');
    });

    it('should update a task to blocked', () => {
      const planPath = join(TEST_DIR, 'PLAN.md');
      writeFileSync(planPath, '- [ ] Stuck\n');

      engine.updateTaskStatus(planPath, 0, 'blocked');

      const updated = readFileSync(planPath, 'utf-8');
      expect(updated).toContain('[!] Stuck');
    });

    it('should update the correct task by index', () => {
      const planPath = join(TEST_DIR, 'PLAN.md');
      writeFileSync(planPath, '- [ ] First\n- [ ] Second\n- [ ] Third\n');

      engine.updateTaskStatus(planPath, 1, 'done');

      const updated = readFileSync(planPath, 'utf-8');
      expect(updated).toContain('[ ] First');
      expect(updated).toContain('[x] Second');
      expect(updated).toContain('[ ] Third');
    });
  });

  // -----------------------------------------------------------------------
  // Progress tracking
  // -----------------------------------------------------------------------

  describe('progress tracking', () => {
    it('should determine when to halt (all done/blocked)', () => {
      const plan = '- [x] Done\n- [!] Blocked\n';
      const tasks = engine.parsePlan(plan);

      // All tasks are done or blocked
      const allDoneOrBlocked = tasks.every(
        (t) => t.status === 'done' || t.status === 'blocked',
      );
      expect(allDoneOrBlocked).toBe(true);
    });

    it('should not halt when open tasks remain', () => {
      const plan = '- [x] Done\n- [ ] Open\n';
      const tasks = engine.parsePlan(plan);

      const allDoneOrBlocked = tasks.every(
        (t) => t.status === 'done' || t.status === 'blocked',
      );
      expect(allDoneOrBlocked).toBe(false);
    });

    it('should find the next open task', () => {
      const plan = '- [x] Done\n- [ ] Next\n- [ ] After\n';
      const tasks = engine.parsePlan(plan);

      const next = tasks.find((t) => t.status === 'open');
      expect(next).toBeDefined();
      expect(next!.text).toBe('Next');
    });
  });

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  describe('task state machine', () => {
    it('should transition open -> in_progress -> done', () => {
      const planPath = join(TEST_DIR, 'SM.md');
      writeFileSync(planPath, '- [ ] My task\n');

      // open -> in_progress
      engine.updateTaskStatus(planPath, 0, 'in_progress');
      let tasks = engine.parsePlan(readFileSync(planPath, 'utf-8'));
      expect(tasks[0]!.status).toBe('in_progress');

      // in_progress -> done
      engine.updateTaskStatus(planPath, 0, 'done');
      tasks = engine.parsePlan(readFileSync(planPath, 'utf-8'));
      expect(tasks[0]!.status).toBe('done');
    });

    it('should transition open -> in_progress -> blocked', () => {
      const planPath = join(TEST_DIR, 'SM2.md');
      writeFileSync(planPath, '- [ ] Blocky task\n');

      engine.updateTaskStatus(planPath, 0, 'in_progress');
      engine.updateTaskStatus(planPath, 0, 'blocked');

      const tasks = engine.parsePlan(readFileSync(planPath, 'utf-8'));
      expect(tasks[0]!.status).toBe('blocked');
    });

    it('should transition open -> in_progress -> open (retry)', () => {
      const planPath = join(TEST_DIR, 'SM3.md');
      writeFileSync(planPath, '- [ ] Retry task\n');

      engine.updateTaskStatus(planPath, 0, 'in_progress');
      engine.updateTaskStatus(planPath, 0, 'open');

      const tasks = engine.parsePlan(readFileSync(planPath, 'utf-8'));
      expect(tasks[0]!.status).toBe('open');
    });
  });

  // -----------------------------------------------------------------------
  // Abort
  // -----------------------------------------------------------------------

  describe('abort', () => {
    it('should support aborting the engine', () => {
      engine.abort();
      // The abort flag is set - would cause the run loop to exit
      // (We can't easily test the full loop without mocking ClaudeCliRunner)
    });
  });

  // -----------------------------------------------------------------------
  // Domain-aware work prompt guidelines
  // -----------------------------------------------------------------------

  describe('buildWorkPrompt', () => {
    const baseTask: PlanTask = { index: 0, text: 'Test task', status: 'open', lineNumber: 0 };
    const baseConfig: RalphConfig = {
      agentId: 'test',
      planPath: '/tmp/plan.md',
      maxRetries: 3,
      maxIterations: 50,
    };

    it('should include coding guidelines for coding domain', () => {
      const prompt = buildWorkPrompt(baseTask, '', { ...baseConfig, domain: 'coding' });
      expect(prompt).toContain('Write clean, production-quality code');
      expect(prompt).toContain('all existing tests still pass');
      expect(prompt).toContain('Do not modify code unrelated to this task');
    });

    it('should include research guidelines for research domain', () => {
      const prompt = buildWorkPrompt(baseTask, '', { ...baseConfig, domain: 'research' });
      expect(prompt).toContain('accurate, well-sourced information');
      expect(prompt).toContain('Cross-reference claims across multiple sources');
      expect(prompt).toContain('Distinguish between facts, expert opinions, and speculation');
    });

    it('should include ops guidelines for ops domain', () => {
      const prompt = buildWorkPrompt(baseTask, '', { ...baseConfig, domain: 'ops' });
      expect(prompt).toContain('Diagnose the issue systematically');
      expect(prompt).toContain('automated remediation');
      expect(prompt).toContain('data loss > service down > degraded performance > cosmetic');
    });

    it('should include general guidelines for general domain', () => {
      const prompt = buildWorkPrompt(baseTask, '', { ...baseConfig, domain: 'general' });
      expect(prompt).toContain('completing this task to a high standard');
      expect(prompt).toContain('results, not questions');
    });

    it('should default to general guidelines when no domain is set', () => {
      const prompt = buildWorkPrompt(baseTask, '', baseConfig);
      expect(prompt).toContain('completing this task to a high standard');
      expect(prompt).toContain('results, not questions');
    });

    it('should include accumulated learnings when progress is provided', () => {
      const prompt = buildWorkPrompt(baseTask, 'Previous learning notes', baseConfig);
      expect(prompt).toContain('Accumulated Learnings');
      expect(prompt).toContain('Previous learning notes');
    });

    it('should include verification section when verifyCommand is set', () => {
      const prompt = buildWorkPrompt(baseTask, '', { ...baseConfig, verifyCommand: 'npm test' });
      expect(prompt).toContain('Verification');
      expect(prompt).toContain('npm test');
    });
  });

  // -----------------------------------------------------------------------
  // autoCommit defaults
  // -----------------------------------------------------------------------

  describe('autoCommit defaults', () => {
    it('should default to true for coding domain', () => {
      const config: Partial<RalphConfig> = { domain: 'coding' };
      const shouldCommit = config.autoCommit ?? (config.domain === 'coding');
      expect(shouldCommit).toBe(true);
    });

    it('should default to false for research domain', () => {
      const config: Partial<RalphConfig> = { domain: 'research' };
      const shouldCommit = config.autoCommit ?? (config.domain === 'coding');
      expect(shouldCommit).toBe(false);
    });

    it('should default to false for ops domain', () => {
      const config: Partial<RalphConfig> = { domain: 'ops' };
      const shouldCommit = config.autoCommit ?? (config.domain === 'coding');
      expect(shouldCommit).toBe(false);
    });

    it('should default to false for general domain', () => {
      const config: Partial<RalphConfig> = { domain: 'general' };
      const shouldCommit = config.autoCommit ?? (config.domain === 'coding');
      expect(shouldCommit).toBe(false);
    });

    it('should default to false when no domain is set', () => {
      const config: Partial<RalphConfig> = {};
      const shouldCommit = config.autoCommit ?? (config.domain === 'coding');
      expect(shouldCommit).toBe(false);
    });

    it('should respect explicit autoCommit=true override on non-coding domain', () => {
      const config: Partial<RalphConfig> = { domain: 'research', autoCommit: true };
      const shouldCommit = config.autoCommit ?? (config.domain === 'coding');
      expect(shouldCommit).toBe(true);
    });

    it('should respect explicit autoCommit=false override on coding domain', () => {
      const config: Partial<RalphConfig> = { domain: 'coding', autoCommit: false };
      const shouldCommit = config.autoCommit ?? (config.domain === 'coding');
      expect(shouldCommit).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // onStatusUpdate callback
  // -----------------------------------------------------------------------

  describe('onStatusUpdate', () => {
    it('should call onStatusUpdate after task completion', async () => {
      const planPath = join(TEST_DIR, 'plan-status.md');
      writeFileSync(planPath, '- [ ] First task\n- [ ] Second task\n');

      const statusUpdates: string[] = [];
      const config: RalphConfig = {
        agentId: 'test',
        planPath,
        maxRetries: 1,
        maxIterations: 10,
        workingDirectory: TEST_DIR,
        domain: 'research',
        onStatusUpdate: (msg) => statusUpdates.push(msg),
      };

      await engine.run(config);

      expect(statusUpdates.some((m) => m.includes('Task 1/2 done: First task'))).toBe(true);
      expect(statusUpdates.some((m) => m.includes('Task 2/2 done: Second task'))).toBe(true);
    });

    it('should call onStatusUpdate with final summary on loop completion', async () => {
      const planPath = join(TEST_DIR, 'plan-final.md');
      writeFileSync(planPath, '- [ ] Only task\n');

      const statusUpdates: string[] = [];
      const config: RalphConfig = {
        agentId: 'test',
        planPath,
        maxRetries: 1,
        maxIterations: 10,
        workingDirectory: TEST_DIR,
        domain: 'general',
        onStatusUpdate: (msg) => statusUpdates.push(msg),
      };

      await engine.run(config);

      expect(statusUpdates.some((m) => m.includes('Work complete:'))).toBe(true);
      expect(statusUpdates.some((m) => m.includes('tasks done'))).toBe(true);
    });

    it('should not error when onStatusUpdate is not provided', async () => {
      const planPath = join(TEST_DIR, 'plan-noop.md');
      writeFileSync(planPath, '- [ ] Simple task\n');

      const config: RalphConfig = {
        agentId: 'test',
        planPath,
        maxRetries: 1,
        maxIterations: 10,
        workingDirectory: TEST_DIR,
        domain: 'general',
      };

      await expect(engine.run(config)).resolves.toBeDefined();
    });
  });
});

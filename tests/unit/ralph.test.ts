// ---------------------------------------------------------------------------
// Tests: RALPH Loop Engine
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RalphEngine } from '../../src/engine/ralph.js';
import type { PlanTask, RalphConfig, RalphProgressEvent } from '../../src/engine/ralph.js';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
});

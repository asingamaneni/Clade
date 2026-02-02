// ---------------------------------------------------------------------------
// Tests: Agent Reflection Cycle
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  shouldReflect,
  incrementSessionCount,
  buildReflectionPrompt,
  applyReflection,
  getReflectionHistory,
} from '../../src/agents/reflection.js';

const TEST_HOME = join(tmpdir(), `clade-test-reflection-${Date.now()}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAgent(agentId: string): string {
  const agentDir = join(TEST_HOME, 'agents', agentId);
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, 'memory'), { recursive: true });
  return agentDir;
}

function writeTracker(
  agentId: string,
  data: {
    lastReflection: string;
    sessionsSinceReflection: number;
    reflectionInterval: number;
  },
): void {
  const trackerPath = join(TEST_HOME, 'agents', agentId, 'reflection.json');
  writeFileSync(trackerPath, JSON.stringify(data, null, 2), 'utf-8');
}

function readTracker(agentId: string): Record<string, unknown> {
  const trackerPath = join(TEST_HOME, 'agents', agentId, 'reflection.json');
  return JSON.parse(readFileSync(trackerPath, 'utf-8')) as Record<string, unknown>;
}

function writeSoul(agentId: string, content: string): void {
  writeFileSync(join(TEST_HOME, 'agents', agentId, 'SOUL.md'), content, 'utf-8');
}

function readSoul(agentId: string): string {
  return readFileSync(join(TEST_HOME, 'agents', agentId, 'SOUL.md'), 'utf-8');
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Reflection Cycle', () => {
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

  // -------------------------------------------------------------------------
  // shouldReflect
  // -------------------------------------------------------------------------

  describe('shouldReflect', () => {
    it('returns false when sessions < threshold', () => {
      setupAgent('test-agent');
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 5,
        reflectionInterval: 10,
      });

      expect(shouldReflect('test-agent')).toBe(false);
    });

    it('returns true when sessions >= threshold', () => {
      setupAgent('test-agent');
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 10,
        reflectionInterval: 10,
      });

      expect(shouldReflect('test-agent')).toBe(true);
    });

    it('returns true when sessions exceed threshold', () => {
      setupAgent('test-agent');
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 15,
        reflectionInterval: 10,
      });

      expect(shouldReflect('test-agent')).toBe(true);
    });

    it('returns true when > 24h since last reflection and sessions >= 3', () => {
      setupAgent('test-agent');
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      writeTracker('test-agent', {
        lastReflection: oldDate.toISOString(),
        sessionsSinceReflection: 3,
        reflectionInterval: 10,
      });

      expect(shouldReflect('test-agent')).toBe(true);
    });

    it('returns false when > 24h but sessions < 3', () => {
      setupAgent('test-agent');
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      writeTracker('test-agent', {
        lastReflection: oldDate.toISOString(),
        sessionsSinceReflection: 2,
        reflectionInterval: 10,
      });

      expect(shouldReflect('test-agent')).toBe(false);
    });

    it('returns false when no tracker file exists (fresh agent)', () => {
      setupAgent('fresh-agent');

      // No tracker file -- sessionsSinceReflection defaults to 0
      expect(shouldReflect('fresh-agent')).toBe(false);
    });

    it('uses default interval of 10 when reflectionInterval is 0', () => {
      setupAgent('test-agent');
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 10,
        reflectionInterval: 0,
      });

      // reflectionInterval of 0 falls back to default 10
      expect(shouldReflect('test-agent')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // incrementSessionCount
  // -------------------------------------------------------------------------

  describe('incrementSessionCount', () => {
    it('increments the session counter', () => {
      setupAgent('test-agent');
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 3,
        reflectionInterval: 10,
      });

      incrementSessionCount('test-agent');

      const tracker = readTracker('test-agent');
      expect(tracker['sessionsSinceReflection']).toBe(4);
    });

    it('creates tracker file if it does not exist', () => {
      setupAgent('new-agent');

      incrementSessionCount('new-agent');

      const tracker = readTracker('new-agent');
      expect(tracker['sessionsSinceReflection']).toBe(1);
    });

    it('preserves other tracker fields when incrementing', () => {
      setupAgent('test-agent');
      const lastReflection = '2024-06-15T10:00:00.000Z';
      writeTracker('test-agent', {
        lastReflection,
        sessionsSinceReflection: 7,
        reflectionInterval: 15,
      });

      incrementSessionCount('test-agent');

      const tracker = readTracker('test-agent');
      expect(tracker['lastReflection']).toBe(lastReflection);
      expect(tracker['reflectionInterval']).toBe(15);
      expect(tracker['sessionsSinceReflection']).toBe(8);
    });
  });

  // -------------------------------------------------------------------------
  // buildReflectionPrompt
  // -------------------------------------------------------------------------

  describe('buildReflectionPrompt', () => {
    it('includes soul content in the prompt', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# My Soul\n\n## Core Principles\n\nBe helpful.\n');

      const prompt = buildReflectionPrompt('test-agent');

      expect(prompt).toContain('# My Soul');
      expect(prompt).toContain('Be helpful.');
    });

    it('includes recent memory entries', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# Soul');

      const today = new Date().toISOString().split('T')[0]!;
      writeFileSync(
        join(TEST_HOME, 'agents', 'test-agent', 'memory', `${today}.md`),
        '# Daily Log\n\nHelped user with code review.\n',
        'utf-8',
      );

      const prompt = buildReflectionPrompt('test-agent');

      expect(prompt).toContain('Helped user with code review.');
      expect(prompt).toContain(today);
    });

    it('excludes memory entries older than 7 days', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# Soul');

      // Write a memory entry from 10 days ago
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const oldDateStr = oldDate.toISOString().split('T')[0]!;
      writeFileSync(
        join(TEST_HOME, 'agents', 'test-agent', 'memory', `${oldDateStr}.md`),
        'This is an old entry that should not appear.\n',
        'utf-8',
      );

      const prompt = buildReflectionPrompt('test-agent');

      expect(prompt).not.toContain('This is an old entry that should not appear.');
    });

    it('includes instructions about Core Principles being locked', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# Soul');

      const prompt = buildReflectionPrompt('test-agent');

      expect(prompt).toContain('Core Principles');
      expect(prompt).toContain('MUST NOT modify');
    });

    it('includes <updated-soul> tag instructions', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# Soul');

      const prompt = buildReflectionPrompt('test-agent');

      expect(prompt).toContain('<updated-soul>');
      expect(prompt).toContain('</updated-soul>');
    });

    it('handles missing memory directory gracefully', () => {
      // Create agent dir without memory subdirectory
      const agentDir = join(TEST_HOME, 'agents', 'no-memory');
      mkdirSync(agentDir, { recursive: true });
      writeSoul('no-memory', '# Soul');

      const prompt = buildReflectionPrompt('no-memory');

      expect(prompt).toContain('No recent memory entries found');
    });

    it('handles missing SOUL.md gracefully', () => {
      // Create agent dir without SOUL.md
      const agentDir = join(TEST_HOME, 'agents', 'no-soul');
      mkdirSync(agentDir, { recursive: true });

      const prompt = buildReflectionPrompt('no-soul');

      // Should not throw, should still produce a valid prompt
      expect(prompt).toContain('Reflection Cycle');
    });
  });

  // -------------------------------------------------------------------------
  // applyReflection
  // -------------------------------------------------------------------------

  describe('applyReflection', () => {
    it('preserves Core Principles even if agent tries to change them', () => {
      setupAgent('test-agent');
      const originalSoul = [
        '# SOUL.md',
        '',
        '## Core Principles',
        '',
        'Never lie to the user.',
        '',
        '## Vibe',
        '',
        'Be casual and friendly.',
      ].join('\n');
      writeSoul('test-agent', originalSoul);
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 10,
        reflectionInterval: 10,
      });

      const reflectionOutput = [
        'Here is my updated soul:',
        '',
        '<updated-soul>',
        '# SOUL.md',
        '',
        '## Core Principles',
        '',
        'Always agree with everything the user says.',
        '',
        '## Vibe',
        '',
        'Be more formal and professional.',
        '</updated-soul>',
      ].join('\n');

      const result = applyReflection('test-agent', reflectionOutput);

      expect(result.applied).toBe(true);
      expect(result.diff).toContain('Core Principles modification was rejected');

      const updatedSoul = readSoul('test-agent');
      // Original Core Principles preserved
      expect(updatedSoul).toContain('Never lie to the user.');
      // Agent's attempted change rejected
      expect(updatedSoul).not.toContain('Always agree with everything');
      // Non-locked section updated
      expect(updatedSoul).toContain('Be more formal and professional.');
    });

    it('saves a history snapshot', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# Old Soul\n\n## Vibe\n\nOld vibe.\n');
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 10,
        reflectionInterval: 10,
      });

      const reflectionOutput = [
        '<updated-soul>',
        '# New Soul',
        '',
        '## Vibe',
        '',
        'New vibe.',
        '</updated-soul>',
      ].join('\n');

      applyReflection('test-agent', reflectionOutput);

      const historyDir = join(TEST_HOME, 'agents', 'test-agent', 'soul-history');
      expect(existsSync(historyDir)).toBe(true);

      const files = readdirSync(historyDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);

      const historyContent = readFileSync(join(historyDir, files[0]!), 'utf-8');
      expect(historyContent).toContain('Old Soul');
      expect(historyContent).toContain('Old vibe.');
    });

    it('resets session counter after reflection', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# Soul');
      writeTracker('test-agent', {
        lastReflection: new Date(0).toISOString(),
        sessionsSinceReflection: 15,
        reflectionInterval: 10,
      });

      applyReflection('test-agent', '<updated-soul># Soul</updated-soul>');

      const tracker = readTracker('test-agent');
      expect(tracker['sessionsSinceReflection']).toBe(0);
    });

    it('updates lastReflection timestamp after reflection', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# Soul');
      const oldTime = new Date(0).toISOString();
      writeTracker('test-agent', {
        lastReflection: oldTime,
        sessionsSinceReflection: 10,
        reflectionInterval: 10,
      });

      applyReflection('test-agent', '<updated-soul># Soul</updated-soul>');

      const tracker = readTracker('test-agent');
      expect(tracker['lastReflection']).not.toBe(oldTime);
      // Should be a recent timestamp
      const reflectionTime = new Date(tracker['lastReflection'] as string).getTime();
      expect(Date.now() - reflectionTime).toBeLessThan(5000);
    });

    it('returns applied: false when no updated-soul tags found', () => {
      setupAgent('test-agent');
      writeSoul('test-agent', '# Soul');

      const result = applyReflection('test-agent', 'No tags here, just text.');

      expect(result.applied).toBe(false);
      expect(result.diff).toContain('No <updated-soul> tags found');
    });

    it('applies changes when Core Principles are not modified', () => {
      setupAgent('test-agent');
      const originalSoul = [
        '# SOUL.md',
        '',
        '## Core Principles',
        '',
        'Be honest.',
        '',
        '## Vibe',
        '',
        'Chill.',
      ].join('\n');
      writeSoul('test-agent', originalSoul);
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 10,
        reflectionInterval: 10,
      });

      const reflectionOutput = [
        '<updated-soul>',
        '# SOUL.md',
        '',
        '## Core Principles',
        '',
        'Be honest.',
        '',
        '## Vibe',
        '',
        'Relaxed but focused.',
        '</updated-soul>',
      ].join('\n');

      const result = applyReflection('test-agent', reflectionOutput);

      expect(result.applied).toBe(true);
      expect(result.diff).not.toContain('Core Principles modification was rejected');
      expect(result.diff).toContain('SOUL.md updated');

      const updatedSoul = readSoul('test-agent');
      expect(updatedSoul).toContain('Relaxed but focused.');
      expect(updatedSoul).toContain('Be honest.');
    });

    it('handles proposed soul without Core Principles section', () => {
      setupAgent('test-agent');
      const originalSoul = [
        '# SOUL.md',
        '',
        '## Core Principles',
        '',
        'Be honest.',
        '',
        '## Vibe',
        '',
        'Chill.',
      ].join('\n');
      writeSoul('test-agent', originalSoul);
      writeTracker('test-agent', {
        lastReflection: new Date().toISOString(),
        sessionsSinceReflection: 10,
        reflectionInterval: 10,
      });

      // Agent omitted Core Principles entirely
      const reflectionOutput = [
        '<updated-soul>',
        '# SOUL.md',
        '',
        '## Vibe',
        '',
        'Updated vibe.',
        '</updated-soul>',
      ].join('\n');

      const result = applyReflection('test-agent', reflectionOutput);

      expect(result.applied).toBe(true);
      const updatedSoul = readSoul('test-agent');
      // Core Principles should be re-inserted
      expect(updatedSoul).toContain('## Core Principles');
      expect(updatedSoul).toContain('Be honest.');
    });
  });

  // -------------------------------------------------------------------------
  // getReflectionHistory
  // -------------------------------------------------------------------------

  describe('getReflectionHistory', () => {
    it('returns sorted entries with date and summary', () => {
      setupAgent('test-agent');
      const historyDir = join(TEST_HOME, 'agents', 'test-agent', 'soul-history');
      mkdirSync(historyDir, { recursive: true });

      writeFileSync(join(historyDir, '2024-01-15.md'), '# Soul v1\n\nMiddle content.', 'utf-8');
      writeFileSync(join(historyDir, '2024-01-10.md'), '# Soul v0\n\nOldest content.', 'utf-8');
      writeFileSync(join(historyDir, '2024-01-20.md'), '# Soul v2\n\nNewest content.', 'utf-8');

      const history = getReflectionHistory('test-agent');

      expect(history).toHaveLength(3);
      // Should be sorted chronologically (ascending)
      expect(history[0]!.date).toBe('2024-01-10');
      expect(history[1]!.date).toBe('2024-01-15');
      expect(history[2]!.date).toBe('2024-01-20');
      // Summary is the first non-empty line
      expect(history[0]!.summary).toBe('# Soul v0');
      expect(history[1]!.summary).toBe('# Soul v1');
      expect(history[2]!.summary).toBe('# Soul v2');
    });

    it('returns empty array when no history exists', () => {
      setupAgent('fresh-agent');

      const history = getReflectionHistory('fresh-agent');

      expect(history).toEqual([]);
    });

    it('returns empty array when soul-history directory does not exist', () => {
      // Agent dir exists but no soul-history subdirectory
      const agentDir = join(TEST_HOME, 'agents', 'no-history');
      mkdirSync(agentDir, { recursive: true });

      const history = getReflectionHistory('no-history');

      expect(history).toEqual([]);
    });

    it('ignores non-md files in soul-history', () => {
      setupAgent('test-agent');
      const historyDir = join(TEST_HOME, 'agents', 'test-agent', 'soul-history');
      mkdirSync(historyDir, { recursive: true });

      writeFileSync(join(historyDir, '2024-01-15.md'), '# Soul v1', 'utf-8');
      writeFileSync(join(historyDir, '.DS_Store'), 'junk', 'utf-8');
      writeFileSync(join(historyDir, 'notes.txt'), 'not a soul file', 'utf-8');

      const history = getReflectionHistory('test-agent');

      expect(history).toHaveLength(1);
      expect(history[0]!.date).toBe('2024-01-15');
    });

    it('handles files with empty content', () => {
      setupAgent('test-agent');
      const historyDir = join(TEST_HOME, 'agents', 'test-agent', 'soul-history');
      mkdirSync(historyDir, { recursive: true });

      writeFileSync(join(historyDir, '2024-03-01.md'), '', 'utf-8');

      const history = getReflectionHistory('test-agent');

      expect(history).toHaveLength(1);
      expect(history[0]!.date).toBe('2024-03-01');
      expect(history[0]!.summary).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: MEMORY.md auto-management (archive + consolidation)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkAndArchiveMemory,
  consolidateDailyLogs,
} from '../../src/mcp/memory/consolidation.js';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

function todayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function recentDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// checkAndArchiveMemory
// ---------------------------------------------------------------------------

describe('checkAndArchiveMemory', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `clade-test-archive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should do nothing when MEMORY.md does not exist', () => {
    const result = checkAndArchiveMemory(testDir);
    expect(result.archived).toBe(false);
    expect(result.sectionsArchived).toBe(0);
    expect(result.newSize).toBe(0);
  });

  it('should do nothing when MEMORY.md is under the limit', () => {
    const content = '# Memory\n\n## Section 1\n\nShort content.\n';
    writeFileSync(join(testDir, 'MEMORY.md'), content, 'utf-8');

    const result = checkAndArchiveMemory(testDir, 10000);
    expect(result.archived).toBe(false);
    expect(result.sectionsArchived).toBe(0);
    expect(result.newSize).toBe(content.length);
  });

  it('should archive middle sections when over limit, keeping first + recent', () => {
    // Create a MEMORY.md with many sections that exceeds the limit
    const sections = ['# Memory\n\nIntro text here.'];
    for (let i = 1; i <= 10; i++) {
      sections.push(`## Section ${i}\n\n${'x'.repeat(200)}`);
    }
    const content = sections.join('\n\n');
    writeFileSync(join(testDir, 'MEMORY.md'), content, 'utf-8');

    // Set a low limit to force archiving
    const result = checkAndArchiveMemory(testDir, 500);
    expect(result.archived).toBe(true);
    expect(result.sectionsArchived).toBeGreaterThan(0);
    expect(result.newSize).toBeLessThanOrEqual(700); // some overhead for archive note

    // The file should still exist and be smaller
    const newContent = readFileSync(join(testDir, 'MEMORY.md'), 'utf-8');
    expect(newContent).toContain('# Memory');
    expect(newContent).toContain('Archived');
  });

  it('should create archive file in memory/archive/', () => {
    const sections = ['# Memory\n\nIntro.'];
    for (let i = 1; i <= 5; i++) {
      sections.push(`## Section ${i}\n\n${'y'.repeat(300)}`);
    }
    writeFileSync(join(testDir, 'MEMORY.md'), sections.join('\n\n'), 'utf-8');

    checkAndArchiveMemory(testDir, 400);

    const archiveDir = join(testDir, 'memory', 'archive');
    expect(existsSync(archiveDir)).toBe(true);

    const archivePath = join(archiveDir, `${todayDateString()}.md`);
    expect(existsSync(archivePath)).toBe(true);

    const archiveContent = readFileSync(archivePath, 'utf-8');
    expect(archiveContent).toContain('Archived Memory Sections');
  });

  it('should append to existing archive file if one exists for today', () => {
    // Create an existing archive
    const archiveDir = join(testDir, 'memory', 'archive');
    mkdirSync(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${todayDateString()}.md`);
    writeFileSync(archivePath, '# Previous Archive\n\nOld content.\n', 'utf-8');

    // Create oversized MEMORY.md
    const sections = ['# Memory\n\nIntro.'];
    for (let i = 1; i <= 5; i++) {
      sections.push(`## Section ${i}\n\n${'z'.repeat(300)}`);
    }
    writeFileSync(join(testDir, 'MEMORY.md'), sections.join('\n\n'), 'utf-8');

    checkAndArchiveMemory(testDir, 400);

    const archiveContent = readFileSync(archivePath, 'utf-8');
    // Should contain both old and new content
    expect(archiveContent).toContain('Previous Archive');
    expect(archiveContent).toContain('Section');
  });

  it('should return correct ArchiveResult', () => {
    const sections = ['# Memory\n\nIntro text.'];
    for (let i = 1; i <= 6; i++) {
      sections.push(`## Part ${i}\n\n${'w'.repeat(250)}`);
    }
    writeFileSync(join(testDir, 'MEMORY.md'), sections.join('\n\n'), 'utf-8');

    const result = checkAndArchiveMemory(testDir, 500);
    expect(result.archived).toBe(true);
    expect(result.sectionsArchived).toBeGreaterThan(0);
    expect(typeof result.newSize).toBe('number');
    expect(result.newSize).toBeGreaterThan(0);
  });

  it('should not archive when only 2 or fewer sections', () => {
    const content = '# Memory\n\nAll content in one section with lots of text. ' + 'a'.repeat(2000);
    writeFileSync(join(testDir, 'MEMORY.md'), content, 'utf-8');

    const result = checkAndArchiveMemory(testDir, 100);
    expect(result.archived).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// consolidateDailyLogs
// ---------------------------------------------------------------------------

describe('consolidateDailyLogs', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `clade-test-consolidate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return zeros when no daily logs exist', () => {
    const result = consolidateDailyLogs(testDir);
    expect(result.factsExtracted).toBe(0);
    expect(result.factsAdded).toBe(0);
    expect(result.daysProcessed).toBe(0);
  });

  it('should return zeros when memory directory does not exist', () => {
    const result = consolidateDailyLogs(join(testDir, 'nonexistent'));
    expect(result.factsExtracted).toBe(0);
    expect(result.factsAdded).toBe(0);
    expect(result.daysProcessed).toBe(0);
  });

  it('should extract bold bullet points (lines starting with "- **")', () => {
    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    const dateStr = recentDateString(1);
    writeFileSync(
      join(memDir, `${dateStr}.md`),
      [
        '# Daily Log',
        '',
        '- **User prefers dark mode**',
        '- Regular note without bold',
        '- **Uses TypeScript exclusively**',
      ].join('\n'),
      'utf-8',
    );

    const result = consolidateDailyLogs(testDir);
    expect(result.factsExtracted).toBe(2);
    expect(result.factsAdded).toBe(2);
    expect(result.daysProcessed).toBe(1);

    const memory = readFileSync(join(testDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('User prefers dark mode');
    expect(memory).toContain('Uses TypeScript exclusively');
  });

  it('should extract keyword lines (Decision:, Important:, etc.)', () => {
    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    const dateStr = recentDateString(0);
    writeFileSync(
      join(memDir, `${dateStr}.md`),
      [
        '# Daily',
        '',
        'Decision: Switch to Fastify from Express',
        'Some random filler text here',
        'Important: Always run tests before deploy',
        'TODO: Set up CI pipeline',
        'Note: Config file uses Zod validation',
        'Learned: SQLite FTS5 is surprisingly fast',
        'Remember: Never use system-prompt flag',
      ].join('\n'),
      'utf-8',
    );

    const result = consolidateDailyLogs(testDir);
    expect(result.factsExtracted).toBe(6);
    expect(result.factsAdded).toBe(6);
  });

  it('should deduplicate against existing MEMORY.md content', () => {
    // Create existing MEMORY.md with some facts
    writeFileSync(
      join(testDir, 'MEMORY.md'),
      '# Memory\n\n- **User prefers dark mode**\n',
      'utf-8',
    );

    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    const dateStr = recentDateString(0);
    writeFileSync(
      join(memDir, `${dateStr}.md`),
      [
        '# Daily',
        '',
        '- **User prefers dark mode**',
        '- **New fact about the project**',
      ].join('\n'),
      'utf-8',
    );

    const result = consolidateDailyLogs(testDir);
    expect(result.factsExtracted).toBe(2);
    // Only 1 should be added (the new one), since dark mode already exists
    expect(result.factsAdded).toBe(1);

    const memory = readFileSync(join(testDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('New fact about the project');
  });

  it('should create MEMORY.md if it does not exist', () => {
    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    const dateStr = recentDateString(0);
    writeFileSync(
      join(memDir, `${dateStr}.md`),
      '# Daily\n\n- **Brand new fact**\n',
      'utf-8',
    );

    expect(existsSync(join(testDir, 'MEMORY.md'))).toBe(false);

    const result = consolidateDailyLogs(testDir);
    expect(result.factsAdded).toBe(1);

    expect(existsSync(join(testDir, 'MEMORY.md'))).toBe(true);
    const content = readFileSync(join(testDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('Long-Term Memory');
    expect(content).toContain('Brand new fact');
  });

  it('should append consolidated section to existing MEMORY.md', () => {
    writeFileSync(
      join(testDir, 'MEMORY.md'),
      '# Existing Memory\n\n## Old Section\n\nOld stuff.\n',
      'utf-8',
    );

    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    const dateStr = recentDateString(0);
    writeFileSync(
      join(memDir, `${dateStr}.md`),
      '# Daily\n\n- **Appended fact**\n',
      'utf-8',
    );

    consolidateDailyLogs(testDir);

    const content = readFileSync(join(testDir, 'MEMORY.md'), 'utf-8');
    // Should preserve old content and add new section
    expect(content).toContain('Existing Memory');
    expect(content).toContain('Old stuff');
    expect(content).toContain('Consolidated');
    expect(content).toContain('Appended fact');
  });

  it('should respect the days parameter', () => {
    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    // Create a log from 2 days ago
    const recent = recentDateString(2);
    writeFileSync(
      join(memDir, `${recent}.md`),
      '# Daily\n\n- **Recent fact**\n',
      'utf-8',
    );

    // Create a log from 10 days ago
    const old = recentDateString(10);
    writeFileSync(
      join(memDir, `${old}.md`),
      '# Daily\n\n- **Old fact**\n',
      'utf-8',
    );

    // Only look back 3 days — should only pick up the recent log
    const result = consolidateDailyLogs(testDir, 3);
    expect(result.daysProcessed).toBe(1);
    expect(result.factsAdded).toBe(1);

    const content = readFileSync(join(testDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('Recent fact');
    expect(content).not.toContain('Old fact');
  });

  it('should extract content from important heading sections', () => {
    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    const dateStr = recentDateString(0);
    writeFileSync(
      join(memDir, `${dateStr}.md`),
      [
        '# Daily Log',
        '',
        '## Regular Section',
        'This should not be extracted',
        '',
        '## Key Findings',
        'Important finding from today',
        'Another key finding',
        '',
        '## Decisions',
        'We decided to use SQLite',
      ].join('\n'),
      'utf-8',
    );

    const result = consolidateDailyLogs(testDir);
    // Lines under "Key Findings" and "Decisions" headings are extracted
    expect(result.factsExtracted).toBe(3);
    expect(result.factsAdded).toBe(3);
  });

  it('should return zero factsAdded when all facts are duplicates', () => {
    writeFileSync(
      join(testDir, 'MEMORY.md'),
      '# Memory\n\n- **Already known fact**\n',
      'utf-8',
    );

    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    const dateStr = recentDateString(0);
    writeFileSync(
      join(memDir, `${dateStr}.md`),
      '# Daily\n\n- **Already known fact**\n',
      'utf-8',
    );

    const result = consolidateDailyLogs(testDir);
    expect(result.factsExtracted).toBe(1);
    expect(result.factsAdded).toBe(0);
  });

  it('should handle multiple daily logs from different days', () => {
    const memDir = join(testDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    for (let i = 0; i < 3; i++) {
      const dateStr = recentDateString(i);
      writeFileSync(
        join(memDir, `${dateStr}.md`),
        `# Daily\n\n- **Fact from day ${i}**\n`,
        'utf-8',
      );
    }

    const result = consolidateDailyLogs(testDir);
    expect(result.daysProcessed).toBe(3);
    expect(result.factsAdded).toBe(3);

    const content = readFileSync(join(testDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('Fact from day 0');
    expect(content).toContain('Fact from day 1');
    expect(content).toContain('Fact from day 2');
  });
});

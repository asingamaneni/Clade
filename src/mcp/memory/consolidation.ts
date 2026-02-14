import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchiveResult {
  archived: boolean;
  sectionsArchived: number;
  newSize: number;
}

export interface ConsolidationResult {
  factsExtracted: number;
  factsAdded: number;
  daysProcessed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_DAYS = 7;

/** Keywords that signal an "important" line in a daily log. */
const IMPORTANT_KEYWORDS = [
  'Decision:',
  'Important:',
  'Remember:',
  'TODO:',
  'Note:',
  'Learned:',
  'Preference:',
  'Action:',
  'Scheduled:',
  'Confirmed:',
  'Booked:',
  'Reserved:',
  'Delegation to',
  'Result:',
];

/** Heading patterns that mark a section as important. */
const IMPORTANT_HEADING_PATTERNS = [
  /^## Key/i,
  /^## Important/i,
  /^## Decisions/i,
  /^## Delegation/i,
  /^## Preferences/i,
  /^## Summary/i,
  /^## Result/i,
];

/** Patterns that look important (bold bullets) but are actually status-check noise. */
const LOW_SIGNAL_PATTERNS = [
  /^- \*\*No open/i,
  /^- \*\*No unfulfilled/i,
  /^- \*\*No active/i,
  /^- \*\*No pending/i,
  /^- \*\*No remaining/i,
  /^- \*\*All (clear|good|done)/i,
  /^- \*\*Nothing to/i,
  /^- \*\*Status:?\s*(ok|good|normal|clear|checked)/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Split markdown content into sections based on `## ` headings.
 * Each section includes its heading line and body.
 * Text before the first `## ` heading is treated as the "intro" section.
 */
function parseSections(content: string): string[] {
  const sections: string[] = [];
  const lines = content.split('\n');

  let currentSection: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ') && currentSection.length > 0) {
      sections.push(currentSection.join('\n'));
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection.join('\n'));
  }

  return sections;
}

/**
 * Collect daily log filenames (YYYY-MM-DD.md) from memory/ dir,
 * returning only those within the last `days` days, sorted newest first.
 */
function getRecentDailyLogs(
  agentDir: string,
  days: number,
): { filename: string; path: string }[] {
  const memoryDir = join(agentDir, 'memory');
  if (!existsSync(memoryDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(memoryDir);
  } catch {
    return [];
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}\.md$/;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  const logs: { filename: string; path: string; date: Date }[] = [];

  for (const entry of entries) {
    if (!datePattern.test(entry)) continue;

    const dateStr = entry.replace('.md', '');
    const date = new Date(dateStr + 'T00:00:00');

    if (isNaN(date.getTime())) continue;
    if (date < cutoff) continue;

    logs.push({
      filename: entry,
      path: join(memoryDir, entry),
      date,
    });
  }

  // Sort newest first
  logs.sort((a, b) => b.date.getTime() - a.date.getTime());

  return logs.map(({ filename, path }) => ({ filename, path }));
}

/**
 * Check if a line is considered "important" based on heuristics.
 */
function isImportantLine(line: string): boolean {
  const trimmed = line.trim();

  // Reject status-check noise before checking positive signals
  for (const pattern of LOW_SIGNAL_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Bold bullet points (after filtering noise)
  if (trimmed.startsWith('- **')) return true;

  // Delegation summaries
  if (trimmed.startsWith('**Delegation')) return true;
  if (trimmed.startsWith('**Result')) return true;

  // Lines containing important keywords
  for (const keyword of IMPORTANT_KEYWORDS) {
    if (trimmed.includes(keyword)) return true;
  }

  return false;
}

/**
 * Check if a heading line marks an "important" section.
 */
function isImportantHeading(heading: string): boolean {
  for (const pattern of IMPORTANT_HEADING_PATTERNS) {
    if (pattern.test(heading)) return true;
  }
  return false;
}

/**
 * Extract important facts from daily log content.
 * Returns deduplicated lines.
 */
function extractImportantFacts(content: string): string[] {
  const facts: string[] = [];
  const lines = content.split('\n');
  let inImportantSection = false;

  for (const line of lines) {
    // Track if we're under an "important" heading
    if (line.startsWith('## ')) {
      // Heartbeat sections are status checks, not knowledge — skip
      if (/heartbeat/i.test(line)) {
        inImportantSection = false;
        continue;
      }
      inImportantSection = isImportantHeading(line);
      continue;
    }

    // Skip blank lines and top-level headings
    if (line.trim() === '' || line.startsWith('# ')) continue;

    if (inImportantSection || isImportantLine(line)) {
      facts.push(line);
    }
  }

  return facts;
}

/**
 * Normalize a line for deduplication comparison.
 * Strips whitespace, bullet prefixes, and lowercases.
 */
function normalizeLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*/g, '')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// checkAndArchiveMemory
// ---------------------------------------------------------------------------

/**
 * Archive oversized MEMORY.md by moving older middle sections
 * to memory/archive/YYYY-MM-DD.md.
 *
 * Strategy: keep the first section (intro) and most recent sections (by position),
 * archive the middle sections.
 */
export function checkAndArchiveMemory(
  agentDir: string,
  maxChars?: number,
): ArchiveResult {
  const limit = maxChars ?? DEFAULT_MAX_CHARS;
  const memoryPath = join(agentDir, 'MEMORY.md');

  if (!existsSync(memoryPath)) {
    return { archived: false, sectionsArchived: 0, newSize: 0 };
  }

  const content = readFileSync(memoryPath, 'utf-8');

  if (content.length <= limit) {
    return { archived: false, sectionsArchived: 0, newSize: content.length };
  }

  const sections = parseSections(content);

  // If there are 2 or fewer sections, nothing meaningful to archive
  if (sections.length <= 2) {
    return { archived: false, sectionsArchived: 0, newSize: content.length };
  }

  // Keep first section (intro/title) always.
  // Then figure out how many recent (tail) sections we can keep within budget.
  const firstSection = sections[0]!;
  const middleAndTail = sections.slice(1);

  // We need to fit: firstSection + kept tail sections + archive note
  const archiveNote = `\n> Archived ${0} sections on ${todayDateString()}. See memory/archive/ for history.\n`;
  const noteOverhead = archiveNote.length + 20; // extra buffer for the count

  let budget = limit - firstSection.length - noteOverhead;
  const keptTail: string[] = [];

  // Walk from the end backwards, keeping sections that fit
  for (let i = middleAndTail.length - 1; i >= 0; i--) {
    const section = middleAndTail[i]!;
    const sectionLen = section.length + 1; // +1 for newline
    if (sectionLen <= budget) {
      keptTail.unshift(section);
      budget -= sectionLen;
    } else {
      break; // stop once we can't fit anymore (preserving contiguous recent block)
    }
  }

  const sectionsToArchive = middleAndTail.slice(
    0,
    middleAndTail.length - keptTail.length,
  );

  if (sectionsToArchive.length === 0) {
    return { archived: false, sectionsArchived: 0, newSize: content.length };
  }

  // Write archived sections to memory/archive/YYYY-MM-DD.md
  const archiveDir = join(agentDir, 'memory', 'archive');
  mkdirSync(archiveDir, { recursive: true });

  const archivePath = join(archiveDir, `${todayDateString()}.md`);
  const archiveHeader = `# Archived Memory Sections - ${todayDateString()}\n\n`;
  const archiveContent = archiveHeader + sectionsToArchive.join('\n\n') + '\n';

  // Append to existing archive if there is one for today
  if (existsSync(archivePath)) {
    const existing = readFileSync(archivePath, 'utf-8');
    writeFileSync(
      archivePath,
      existing + '\n\n' + sectionsToArchive.join('\n\n') + '\n',
      'utf-8',
    );
  } else {
    writeFileSync(archivePath, archiveContent, 'utf-8');
  }

  // Rewrite MEMORY.md with kept sections + note
  const realNote = `\n> Archived ${sectionsToArchive.length} sections on ${todayDateString()}. See memory/archive/ for history.\n`;
  const newContent =
    firstSection + '\n' + realNote + '\n' + keptTail.join('\n\n') + '\n';

  writeFileSync(memoryPath, newContent, 'utf-8');

  return {
    archived: true,
    sectionsArchived: sectionsToArchive.length,
    newSize: newContent.length,
  };
}

/**
 * Extract a key entity identifier from a line for semantic dedup.
 * Returns null if no recognizable entity is found.
 */
function extractEntityKey(line: string): string | null {
  // Phone numbers (US format variations)
  const phone = line.match(/\+?1?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phone) return `phone:${phone[0].replace(/\D/g, '')}`;

  // Confirmation numbers
  const conf = line.match(/[Cc]onfirmation\s*#?\s*(\d+)/);
  if (conf) return `conf:${conf[1]}`;

  // Emails
  const email = line.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (email) return `email:${email[0].toLowerCase()}`;

  return null;
}

// ---------------------------------------------------------------------------
// consolidateDailyLogs
// ---------------------------------------------------------------------------

/**
 * Read recent daily logs, extract important facts, deduplicate against
 * existing MEMORY.md, and append new facts under a consolidated section.
 */
export function consolidateDailyLogs(
  agentDir: string,
  days?: number,
): ConsolidationResult {
  const lookback = days ?? DEFAULT_DAYS;
  const memoryPath = join(agentDir, 'MEMORY.md');

  const logs = getRecentDailyLogs(agentDir, lookback);
  if (logs.length === 0) {
    return { factsExtracted: 0, factsAdded: 0, daysProcessed: 0 };
  }

  // Collect all important facts across daily logs
  const allFacts: string[] = [];
  let daysProcessed = 0;

  for (const log of logs) {
    try {
      const content = readFileSync(log.path, 'utf-8');
      const facts = extractImportantFacts(content);
      allFacts.push(...facts);
      daysProcessed++;
    } catch {
      // Skip unreadable logs
      continue;
    }
  }

  if (allFacts.length === 0) {
    return { factsExtracted: 0, factsAdded: 0, daysProcessed };
  }

  // Read existing MEMORY.md for deduplication
  let existingContent = '';
  if (existsSync(memoryPath)) {
    existingContent = readFileSync(memoryPath, 'utf-8');
  }

  const existingNormalized = new Set(
    existingContent.split('\n').map(normalizeLine).filter((l) => l.length > 0),
  );

  // Deduplicate facts
  const newFacts: string[] = [];
  const seenNormalized = new Set<string>();

  for (const fact of allFacts) {
    const normalized = normalizeLine(fact);
    if (
      normalized.length > 0 &&
      !existingNormalized.has(normalized) &&
      !seenNormalized.has(normalized)
    ) {
      newFacts.push(fact);
      seenNormalized.add(normalized);
    }
  }

  // Entity-level dedup: when multiple lines reference the same entity, keep the longest
  const entityBest = new Map<string, { line: string; index: number }>();
  for (let i = 0; i < newFacts.length; i++) {
    const key = extractEntityKey(newFacts[i]!);
    if (!key) continue;
    const existing = entityBest.get(key);
    if (!existing || newFacts[i]!.length > existing.line.length) {
      entityBest.set(key, { line: newFacts[i]!, index: i });
    }
  }

  const finalFacts = newFacts.filter((fact, i) => {
    const key = extractEntityKey(fact);
    if (!key) return true; // no entity key — keep
    return entityBest.get(key)!.index === i; // only keep the best version
  });

  if (finalFacts.length === 0) {
    return {
      factsExtracted: allFacts.length,
      factsAdded: 0,
      daysProcessed,
    };
  }

  // Append consolidated section to MEMORY.md
  const dateStr = todayDateString();
  const consolidatedSection =
    `\n## Consolidated (${dateStr})\n\n` + finalFacts.join('\n') + '\n';

  if (!existsSync(memoryPath)) {
    writeFileSync(
      memoryPath,
      '# Long-Term Memory\n' + consolidatedSection,
      'utf-8',
    );
  } else {
    const current = readFileSync(memoryPath, 'utf-8');
    writeFileSync(memoryPath, current + consolidatedSection, 'utf-8');
  }

  return {
    factsExtracted: allFacts.length,
    factsAdded: finalFacts.length,
    daysProcessed,
  };
}

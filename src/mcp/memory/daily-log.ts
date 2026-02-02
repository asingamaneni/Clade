import { mkdirSync, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Daily log helpers
// ---------------------------------------------------------------------------

/**
 * Returns the filename for today's daily log (YYYY-MM-DD.md).
 */
function todayFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}.md`;
}

/**
 * Returns the absolute path to today's daily log for the given agent directory.
 */
export function getDailyLogPath(agentDir: string): string {
  return join(agentDir, 'memory', todayFilename());
}

/**
 * Ensures the memory/ directory and today's daily log file exist.
 * If the file is newly created, writes a markdown header.
 * Returns the absolute path to the daily log.
 */
export function ensureDailyLog(agentDir: string): string {
  const memoryDir = join(agentDir, 'memory');
  mkdirSync(memoryDir, { recursive: true });

  const logPath = getDailyLogPath(agentDir);

  if (!existsSync(logPath)) {
    const now = new Date();
    const header = `# Daily Log - ${now.toISOString().split('T')[0]}\n\n`;
    appendFileSync(logPath, header, 'utf-8');
  }

  return logPath;
}

/**
 * Append a timestamped entry to today's daily log.
 */
export function appendToDailyLog(agentDir: string, content: string): void {
  const logPath = ensureDailyLog(agentDir);
  const timestamp = new Date().toISOString();
  const entry = `\n## ${timestamp}\n\n${content}\n`;
  appendFileSync(logPath, entry, 'utf-8');
}

/**
 * Append a timestamped entry to the long-term MEMORY.md.
 * Creates the file with a header if it does not exist.
 */
export function appendToLongTermMemory(
  agentDir: string,
  content: string,
): void {
  const memoryPath = join(agentDir, 'MEMORY.md');

  if (!existsSync(memoryPath)) {
    appendFileSync(memoryPath, '# Long-Term Memory\n\n', 'utf-8');
  }

  const timestamp = new Date().toISOString();
  const entry = `\n## ${timestamp}\n\n${content}\n`;
  appendFileSync(memoryPath, entry, 'utf-8');
}

/**
 * Read the contents of a memory file.
 * `file` is a relative path within the agent directory (e.g. "MEMORY.md" or "memory/2026-02-01.md").
 * Supports optional offset (line number, 0-based) and limit (number of lines).
 */
export function readMemoryFile(
  agentDir: string,
  file: string,
  offset?: number,
  limit?: number,
): string {
  const fullPath = join(agentDir, file);

  if (!existsSync(fullPath)) {
    throw new Error(`Memory file not found: ${file}`);
  }

  const content = readFileSync(fullPath, 'utf-8');

  if (offset === undefined && limit === undefined) {
    return content;
  }

  const lines = content.split('\n');
  const start = offset ?? 0;
  const end = limit !== undefined ? start + limit : lines.length;
  return lines.slice(start, end).join('\n');
}

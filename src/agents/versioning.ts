/**
 * Reusable versioning module for file history tracking.
 *
 * Follows the soul-history pattern: saves dated snapshots (YYYY-MM-DD.md)
 * before updates, lists history entries, and retrieves specific versions.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VersionHistoryEntry {
  date: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Save a version snapshot before updating a file.
 * Creates a dated snapshot (YYYY-MM-DD.md) in the history directory.
 * Only saves if the file exists and content differs from any existing snapshot for today.
 */
export function saveVersion(filePath: string, historyDir: string): void {
  if (!existsSync(filePath)) return;

  mkdirSync(historyDir, { recursive: true });

  const content = readFileSync(filePath, 'utf-8');
  const today = new Date().toISOString().split('T')[0]!;
  const historyPath = join(historyDir, `${today}.md`);

  // Only save if different from existing snapshot for today
  if (existsSync(historyPath)) {
    const existing = readFileSync(historyPath, 'utf-8');
    if (existing === content) return;
  }

  writeFileSync(historyPath, content, 'utf-8');
}

/**
 * Get version history entries for a history directory.
 * Returns entries sorted reverse-chronologically (newest first) with date
 * and first-line summary. Limited to the most recent `limit` entries.
 */
export function getVersionHistory(historyDir: string, limit = 15): VersionHistoryEntry[] {
  if (!existsSync(historyDir)) return [];

  const files = readdirSync(historyDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map((file) => {
    const date = file.replace('.md', '');
    const content = readFileSync(join(historyDir, file), 'utf-8');
    const firstLine = content.split('\n').find((l) => l.trim().length > 0) || '';
    return { date, summary: firstLine.trim() };
  });
}

/**
 * Get the full content of a specific version snapshot.
 * Returns the markdown content or null if not found.
 */
export function getVersionContent(historyDir: string, date: string): string | null {
  // Validate date format to prevent path traversal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const filePath = join(historyDir, `${date}.md`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

/**
 * Get the history directory path for USER.md.
 */
export function getUserHistoryPath(configDir: string): string {
  return join(configDir, 'user-history');
}

/**
 * Get the history directory path for an agent's TOOLS.md.
 */
export function getToolsHistoryPath(agentDir: string): string {
  return join(agentDir, 'tools-history');
}

/**
 * Get the history directory path for an agent's SOUL.md.
 */
export function getSoulHistoryPath(agentDir: string): string {
  return join(agentDir, 'soul-history');
}

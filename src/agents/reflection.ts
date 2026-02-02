/**
 * Agent self-improvement reflection cycle.
 *
 * After every N sessions (configurable), the agent receives a dedicated
 * reflection prompt that lets it review recent interactions and propose
 * updates to its own SOUL.md. The "## Core Principles" section is locked
 * and cannot be modified by the agent.
 */

import { getAgentsDir } from '../config/index.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReflectionTracker {
  lastReflection: string;
  sessionsSinceReflection: number;
  reflectionInterval: number;
}

interface ReflectionResult {
  applied: boolean;
  diff: string;
}

interface ReflectionHistoryEntry {
  date: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REFLECTION_INTERVAL = 10;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MEMORY_LOOKBACK_DAYS = 7;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getReflectionPath(agentId: string): string {
  return join(getAgentsDir(), agentId, 'reflection.json');
}

function getSoulPath(agentId: string): string {
  return join(getAgentsDir(), agentId, 'SOUL.md');
}

function getSoulHistoryDir(agentId: string): string {
  return join(getAgentsDir(), agentId, 'soul-history');
}

function getMemoryDir(agentId: string): string {
  return join(getAgentsDir(), agentId, 'memory');
}

function loadTracker(agentId: string): ReflectionTracker {
  const trackerPath = getReflectionPath(agentId);
  if (!existsSync(trackerPath)) {
    return {
      lastReflection: new Date(0).toISOString(),
      sessionsSinceReflection: 0,
      reflectionInterval: DEFAULT_REFLECTION_INTERVAL,
    };
  }
  const raw = readFileSync(trackerPath, 'utf-8');
  return JSON.parse(raw) as ReflectionTracker;
}

function saveTracker(agentId: string, tracker: ReflectionTracker): void {
  const agentDir = join(getAgentsDir(), agentId);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    getReflectionPath(agentId),
    JSON.stringify(tracker, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Extract the "## Core Principles" section from SOUL.md content.
 * Returns the section content including the heading, or empty string if not found.
 */
function extractCorePrinciples(soulContent: string): string {
  const lines = soulContent.split('\n');
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (start === -1 && /^## Core Principles/.test(line)) {
      start = i;
      continue;
    }
    if (start !== -1 && /^## /.test(line)) {
      end = i;
      break;
    }
  }

  if (start === -1) return '';
  return lines.slice(start, end).join('\n');
}

/**
 * Replace the Core Principles section in the proposed SOUL.md with the
 * original one so the agent cannot mutate its own core constraints.
 */
function preserveCorePrinciples(originalSoul: string, proposedSoul: string): string {
  const originalCP = extractCorePrinciples(originalSoul);
  if (!originalCP) return proposedSoul;

  const proposedCP = extractCorePrinciples(proposedSoul);
  if (!proposedCP) {
    // Proposed soul dropped Core Principles entirely -- re-insert before
    // the first ## heading, or append at the end.
    const lines = proposedSoul.split('\n');
    const firstH2 = lines.findIndex((l) => /^## /.test(l));
    if (firstH2 !== -1) {
      lines.splice(firstH2, 0, originalCP, '');
      return lines.join('\n');
    }
    return proposedSoul + '\n\n' + originalCP + '\n';
  }

  // Replace the proposed Core Principles with the original.
  return proposedSoul.replace(proposedCP, originalCP);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Check whether it is time for an agent to perform a reflection cycle.
 *
 * Returns true when either:
 *  - sessionsSinceReflection >= reflectionInterval (default 10), OR
 *  - lastReflection was more than 24 hours ago AND sessionsSinceReflection >= 3
 */
export function shouldReflect(agentId: string): boolean {
  const tracker = loadTracker(agentId);
  const interval = tracker.reflectionInterval || DEFAULT_REFLECTION_INTERVAL;

  if (tracker.sessionsSinceReflection >= interval) {
    return true;
  }

  const msSinceReflection = Date.now() - new Date(tracker.lastReflection).getTime();
  if (msSinceReflection > TWENTY_FOUR_HOURS_MS && tracker.sessionsSinceReflection >= 3) {
    return true;
  }

  return false;
}

/**
 * Increment the session counter for an agent. Called after each session ends.
 */
export function incrementSessionCount(agentId: string): void {
  const tracker = loadTracker(agentId);
  tracker.sessionsSinceReflection += 1;
  saveTracker(agentId, tracker);
}

/**
 * Build a reflection prompt for the agent.
 *
 * Reads the current SOUL.md and the last 7 days of daily memory logs,
 * then constructs a prompt asking the agent to review interactions and
 * propose updates to non-locked SOUL.md sections.
 */
export function buildReflectionPrompt(agentId: string): string {
  // Read current SOUL.md
  const soulPath = getSoulPath(agentId);
  const soul = existsSync(soulPath) ? readFileSync(soulPath, 'utf-8') : '';

  // Read recent memory entries (last 7 days)
  const memoryDir = getMemoryDir(agentId);
  let recentMemories = '';

  if (existsSync(memoryDir)) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - MEMORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const files = readdirSync(memoryDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse();

    for (const file of files) {
      // Files are named YYYY-MM-DD.md
      const dateStr = file.replace('.md', '');
      const fileDate = new Date(dateStr + 'T00:00:00Z');
      if (fileDate >= cutoff) {
        const content = readFileSync(join(memoryDir, file), 'utf-8');
        recentMemories += `\n### ${dateStr}\n${content}\n`;
      }
    }
  }

  return [
    '# Reflection Cycle',
    '',
    'You are entering a reflection cycle. This is a dedicated moment to review',
    'your recent interactions and improve how you serve your user.',
    '',
    '## Your Current SOUL.md',
    '',
    '```markdown',
    soul,
    '```',
    '',
    '## Recent Interaction Logs (Last 7 Days)',
    '',
    recentMemories || '*No recent memory entries found.*',
    '',
    '## Your Task',
    '',
    'Please review the above and:',
    '',
    '1. **Identify user patterns**: Communication style, work habits, preferences, recurring topics.',
    '2. **Note what worked well**: Interactions where you were particularly helpful or where the user responded positively.',
    '3. **Note what didn\'t work**: Interactions where you missed the mark, were too verbose, too brief, or misunderstood the user.',
    '4. **Propose specific updates** to your SOUL.md to better serve this user.',
    '',
    '**IMPORTANT**: You MUST NOT modify the "## Core Principles" section. It is locked and any changes to it will be rejected.',
    '',
    'Output your updated SOUL.md content between these tags:',
    '',
    '<updated-soul>',
    '(your updated SOUL.md here)',
    '</updated-soul>',
    '',
    'Focus on actionable, specific improvements. Don\'t just add generic statements.',
  ].join('\n');
}

/**
 * Apply the reflection output to update the agent's SOUL.md.
 *
 * - Parses the <updated-soul>...</updated-soul> content from reflectionOutput
 * - Extracts and compares Core Principles from both original and proposed
 * - If Core Principles was modified, rejects the change and keeps original
 * - Saves old SOUL.md to soul-history/YYYY-MM-DD.md
 * - Writes new SOUL.md (with original Core Principles preserved)
 * - Resets sessionsSinceReflection to 0
 */
export function applyReflection(
  agentId: string,
  reflectionOutput: string,
): ReflectionResult {
  // Parse the updated soul content from tags
  const match = reflectionOutput.match(/<updated-soul>([\s\S]*?)<\/updated-soul>/);
  if (!match?.[1]) {
    return { applied: false, diff: 'No <updated-soul> tags found in reflection output.' };
  }

  const proposedSoul = match[1].trim();
  const soulPath = getSoulPath(agentId);
  const originalSoul = existsSync(soulPath) ? readFileSync(soulPath, 'utf-8') : '';

  // Check whether Core Principles was tampered with
  const originalCP = extractCorePrinciples(originalSoul);
  const proposedCP = extractCorePrinciples(proposedSoul);
  const corePrinciplesModified =
    originalCP !== '' && proposedCP !== '' && originalCP !== proposedCP;

  // Build the final soul with original Core Principles preserved
  const finalSoul = preserveCorePrinciples(originalSoul, proposedSoul);

  // Save history snapshot
  const historyDir = getSoulHistoryDir(agentId);
  mkdirSync(historyDir, { recursive: true });
  const today = new Date().toISOString().split('T')[0]!;
  const historyPath = join(historyDir, `${today}.md`);
  writeFileSync(historyPath, originalSoul, 'utf-8');

  // Write updated SOUL.md
  writeFileSync(soulPath, finalSoul, 'utf-8');

  // Reset session counter and update last reflection time
  const tracker = loadTracker(agentId);
  tracker.sessionsSinceReflection = 0;
  tracker.lastReflection = new Date().toISOString();
  saveTracker(agentId, tracker);

  // Build a simple diff summary
  const diffParts: string[] = [];
  if (corePrinciplesModified) {
    diffParts.push('Core Principles modification was rejected and original preserved.');
  }
  if (originalSoul !== finalSoul) {
    diffParts.push('SOUL.md updated with new reflection insights.');
  } else {
    diffParts.push('No effective changes were made to SOUL.md.');
  }

  return {
    applied: true,
    diff: diffParts.join(' '),
  };
}

/**
 * List the reflection history for an agent.
 * Returns entries sorted chronologically with date and first-line summary.
 */
export function getReflectionHistory(agentId: string): ReflectionHistoryEntry[] {
  const historyDir = getSoulHistoryDir(agentId);
  if (!existsSync(historyDir)) return [];

  const files = readdirSync(historyDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  return files.map((file) => {
    const date = file.replace('.md', '');
    const content = readFileSync(join(historyDir, file), 'utf-8');
    const firstLine = content.split('\n').find((l) => l.trim().length > 0) || '';
    return { date, summary: firstLine.trim() };
  });
}

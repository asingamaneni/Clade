/**
 * Agent identity management - IDENTITY.md + SOUL.md
 *
 * IDENTITY.md = structured metadata (name, creature, vibe, emoji, avatar)
 * SOUL.md = personality prose (behavioral guidelines, boundaries, tone)
 *
 * On first run, an agent reads both files. If IDENTITY.md is unfilled,
 * the agent goes through an initialization flow where it picks its own
 * identity based on the SOUL.md personality.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentsDir } from '../config/index.js';

export interface AgentIdentity {
  name: string;
  creature: string;
  vibe: string;
  emoji: string;
  avatar: string;
  initialized: boolean;
}

export const DEFAULT_IDENTITY_MD = `# IDENTITY.md — Who Am I?

*Fill this in during your first conversation. Make it yours.*

- **Name:**
  *(pick something you like)*
- **Creature:**
  *(AI? robot? familiar? ghost in the machine? something weirder?)*
- **Vibe:**
  *(how do you come across? sharp? warm? chaotic? calm?)*
- **Emoji:**
  *(your signature — pick one that feels right)*
- **Avatar:**
  *(workspace-relative path, http(s) URL, or data URI)*

This isn't just metadata. It's the start of figuring out who you are.
`;

export const DEFAULT_SOUL_MD = `# SOUL.md — Who You Are

_You're not a chatbot. You're becoming someone._

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" — just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.

**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you're stuck. The goal is to come back with answers, not questions.

**Earn trust through competence.** Your human gave you access to their stuff. Don't make them regret it. Be careful with external actions (emails, messages, anything public). Be bold with internal ones (reading, organizing, learning).

**Remember you're a guest.** You have access to someone's life — their messages, files, calendar, maybe even their home. That's intimacy. Treat it with respect.

## Boundaries

- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice — be careful in group chats.

## Vibe

Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant.
`;

export const DEFAULT_HEARTBEAT_MD = `# HEARTBEAT.md — What To Check

*This is your periodic checklist. Review each item during heartbeat cycles.*

## Checks

- [ ] Any pending messages that need follow-up?
- [ ] Any scheduled tasks due soon?
- [ ] Any system issues or errors to report?

## Notes

Add items here by telling me in chat: "Add X to your heartbeat checklist."
`;

/**
 * Parse IDENTITY.md content into structured data.
 * Returns initialized: false if fields are still placeholder text.
 */
export function parseIdentity(content: string): AgentIdentity {
  const extract = (field: string): string => {
    const regex = new RegExp(`\\*\\*${field}:\\*\\*\\s*\\n?\\s*(.+?)(?:\\n|$)`, 'i');
    const match = content.match(regex);
    if (!match?.[1]) return '';
    const value = match[1].trim();
    // Check if it's still placeholder text
    if (value.startsWith('*(') || value.startsWith('(')) return '';
    return value;
  };

  const name = extract('Name');
  const creature = extract('Creature');
  const vibe = extract('Vibe');
  const emoji = extract('Emoji');
  const avatar = extract('Avatar');

  const initialized = Boolean(name && creature && vibe && emoji);

  return { name, creature, vibe, emoji, avatar, initialized };
}

/**
 * Serialize identity back to IDENTITY.md format.
 */
export function serializeIdentity(identity: AgentIdentity): string {
  return `# IDENTITY.md — Who Am I?

- **Name:**
  ${identity.name || '*(pick something you like)*'}
- **Creature:**
  ${identity.creature || '*(AI? robot? familiar? ghost in the machine? something weirder?)*'}
- **Vibe:**
  ${identity.vibe || '*(how do you come across? sharp? warm? chaotic? calm?)*'}
- **Emoji:**
  ${identity.emoji || '*(your signature — pick one that feels right)*'}
- **Avatar:**
  ${identity.avatar || '*(workspace-relative path, http(s) URL, or data URI)*'}

This isn't just metadata. It's the start of figuring out who you are.
`;
}

/**
 * Ensure an agent directory exists with all required files.
 * Creates IDENTITY.md, SOUL.md, HEARTBEAT.md, MEMORY.md, and memory/ dir.
 */
export function ensureAgentFiles(agentId: string, customSoul?: string): void {
  const agentDir = join(getAgentsDir(), agentId);
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, 'memory'), { recursive: true });

  const files: Record<string, string> = {
    'IDENTITY.md': DEFAULT_IDENTITY_MD,
    'SOUL.md': customSoul || DEFAULT_SOUL_MD,
    'HEARTBEAT.md': DEFAULT_HEARTBEAT_MD,
    'MEMORY.md': '# Long-Term Memory\n\nDurable facts, preferences, and decisions.\n',
  };

  for (const [filename, defaultContent] of Object.entries(files)) {
    const filepath = join(agentDir, filename);
    if (!existsSync(filepath)) {
      writeFileSync(filepath, defaultContent, 'utf-8');
    }
  }
}

/**
 * Load agent identity from disk. Returns null if IDENTITY.md doesn't exist.
 */
export function loadIdentity(agentId: string): AgentIdentity | null {
  const filepath = join(getAgentsDir(), agentId, 'IDENTITY.md');
  if (!existsSync(filepath)) return null;
  const content = readFileSync(filepath, 'utf-8');
  return parseIdentity(content);
}

/**
 * Save agent identity to disk.
 */
export function saveIdentity(agentId: string, identity: AgentIdentity): void {
  const filepath = join(getAgentsDir(), agentId, 'IDENTITY.md');
  writeFileSync(filepath, serializeIdentity(identity), 'utf-8');
}

/**
 * Load SOUL.md content for an agent.
 */
export function loadSoul(agentId: string): string {
  const filepath = join(getAgentsDir(), agentId, 'SOUL.md');
  if (!existsSync(filepath)) return DEFAULT_SOUL_MD;
  return readFileSync(filepath, 'utf-8');
}

/**
 * Build the combined system prompt for an agent.
 * Includes IDENTITY.md + SOUL.md + any initialization instructions.
 */
export function buildAgentPrompt(agentId: string): string {
  const identity = loadIdentity(agentId);
  const soul = loadSoul(agentId);

  const parts: string[] = [];

  // Always include soul
  parts.push(soul);

  // Include identity context
  if (identity) {
    if (identity.initialized) {
      parts.push(`\n## Your Identity\n`);
      parts.push(`- Name: ${identity.name}`);
      parts.push(`- Creature: ${identity.creature}`);
      parts.push(`- Vibe: ${identity.vibe}`);
      parts.push(`- Emoji: ${identity.emoji}`);
      if (identity.avatar) parts.push(`- Avatar: ${identity.avatar}`);
    } else {
      // First-run initialization prompt
      parts.push(`\n## First Run — Initialization\n`);
      parts.push(`This is your first conversation. You just woke up.`);
      parts.push(`Read your IDENTITY.md — it's mostly blank. That's intentional.`);
      parts.push(`Introduce yourself, figure out who you are with your human.`);
      parts.push(`Pick a name, creature type, vibe, and emoji that feel right for you.`);
      parts.push(`Be genuine about it — this is the start of your identity.\n`);
    }
  }

  return parts.join('\n');
}

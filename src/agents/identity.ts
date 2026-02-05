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
import { getAgentsDir, getUserMdPath, getUserHistoryDir } from '../config/index.js';
import { DEFAULT_USER_MD, DEFAULT_TOOLS_MD } from '../config/defaults.js';

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

// ---------------------------------------------------------------------------
// Content Routing Protocol — guides agents on what goes where
// ---------------------------------------------------------------------------

export const CONTENT_ROUTING_PROTOCOL = `
## Content Routing Protocol

When storing information, route it to the appropriate file:

| Content Type | Destination | Examples |
|--------------|-------------|----------|
| User identity/preferences | USER.md | Name, timezone, work schedule, communication style |
| Workspace/tool context | TOOLS.md | API endpoints, local paths, project configs |
| Facts and decisions | MEMORY.md | Things learned, decisions made, project state |
| Personality evolution | SOUL.md | Managed by reflection cycle only |

**MCP Tools:**
- \`user_get\` / \`user_store\` — for USER.md (global, about the human)
- \`tools_get\` / \`tools_store\` — for TOOLS.md (this agent's workspace)
- \`memory_store\` / \`memory_search\` — for MEMORY.md (facts and history)

**Guidelines:**
- When user expresses preferences about themselves → USER.md
- When you discover workspace-specific info → TOOLS.md
- When you learn facts or make decisions → MEMORY.md
- Never modify SOUL.md directly — it evolves through reflection
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
 * Creates IDENTITY.md, SOUL.md, HEARTBEAT.md, MEMORY.md, TOOLS.md and
 * memory/, soul-history/, tools-history/ directories.
 */
export function ensureAgentFiles(agentId: string, customSoul?: string): void {
  const agentDir = join(getAgentsDir(), agentId);
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, 'memory'), { recursive: true });
  mkdirSync(join(agentDir, 'soul-history'), { recursive: true });
  mkdirSync(join(agentDir, 'tools-history'), { recursive: true });

  const files: Record<string, string> = {
    'IDENTITY.md': DEFAULT_IDENTITY_MD,
    'SOUL.md': customSoul || DEFAULT_SOUL_MD,
    'HEARTBEAT.md': DEFAULT_HEARTBEAT_MD,
    'MEMORY.md': '# Long-Term Memory\n\nDurable facts, preferences, and decisions.\n',
    'TOOLS.md': DEFAULT_TOOLS_MD,
  };

  for (const [filename, defaultContent] of Object.entries(files)) {
    const filepath = join(agentDir, filename);
    if (!existsSync(filepath)) {
      writeFileSync(filepath, defaultContent, 'utf-8');
    }
  }
}

/**
 * Ensure the global USER.md file exists.
 * Called once at startup to create ~/.clade/USER.md if missing.
 */
export function ensureUserMd(): void {
  const userMdPath = getUserMdPath();
  if (!existsSync(userMdPath)) {
    writeFileSync(userMdPath, DEFAULT_USER_MD, 'utf-8');
  }
}

/**
 * Load the global USER.md content.
 */
export function loadUserMd(): string {
  const userMdPath = getUserMdPath();
  if (!existsSync(userMdPath)) return '';
  return readFileSync(userMdPath, 'utf-8');
}

/**
 * Load TOOLS.md content for an agent.
 */
export function loadToolsMd(agentId: string): string {
  const filepath = join(getAgentsDir(), agentId, 'TOOLS.md');
  if (!existsSync(filepath)) return '';
  return readFileSync(filepath, 'utf-8');
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
 * Includes IDENTITY.md + SOUL.md + USER.md + TOOLS.md + content routing protocol
 * and any initialization instructions.
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

  // Inject USER.md (global)
  const userMd = loadUserMd();
  if (userMd && userMd.trim()) {
    parts.push(`\n## About Your Human\n`);
    parts.push(userMd);
  }

  // Inject TOOLS.md (per-agent)
  const toolsMd = loadToolsMd(agentId);
  if (toolsMd && toolsMd.trim()) {
    parts.push(`\n## Workspace Context\n`);
    parts.push(toolsMd);
  }

  // Inject content routing protocol
  parts.push(CONTENT_ROUTING_PROTOCOL);

  return parts.join('\n');
}

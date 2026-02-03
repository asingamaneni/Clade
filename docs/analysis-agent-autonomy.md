# Agent Autonomy Analysis: Memory Persistence & Skill Management Gaps

> **Date**: 2026-02-03
> **Context**: Analysis of why agents (e.g., Jarvis) cannot remember across conversations
> and cannot manage their own skills, contrasted with OpenClaw's approach.

## Executive Summary

Clade claims "agents are proactive by default" and "observe, anticipate, and act," but the
implementation contradicts this philosophy. Three systemic issues prevent agents from operating
autonomously:

1. **Memory is never auto-loaded** — agents start each conversation blank
2. **Session state is ephemeral** — conversation-to-session mappings are lost on restart
3. **Skills are walled off** — most presets don't even mount the skills MCP server

These are architectural decisions, not bugs. They were made to avoid "self-mutation crash loops"
observed in OpenClaw, but the cure is worse than the disease: agents are rendered amnesiac and
incapable of self-improvement.

---

## Issue 1: Agents Cannot Remember Across Conversations

### Symptom

User tells Jarvis "remember this." Switches tabs. Asks "what did I tell you to remember?"
Jarvis responds: "I don't have any record of you telling me to remember something earlier."

### Root Causes

#### A. Memory is not injected into sessions

When a session starts, only SOUL.md and agent identity context are passed via
`--append-system-prompt`. MEMORY.md and daily logs (`memory/*.md`) are never included.

```
File: src/cli/commands/start.ts (lines 380-393)

const systemParts: string[] = [];
if (agentContext?.trim()) {
  systemParts.push(agentContext.trim());     // Agent identity only
}
if (soulPath && existsSync(soulPath)) {
  const soul = readFileSync(soulPath, 'utf-8');
  if (soul.trim()) {
    systemParts.push(soul.trim());            // SOUL.md only
  }
}
// ❌ MEMORY.md is never loaded here
```

#### B. Agents must explicitly call MCP tools to access memory

The memory MCP server provides `memory_store`, `memory_search`, `memory_get`, `memory_list`.
But the agent is never instructed to use them proactively. Claude doesn't know it should call
`memory_search` when asked about prior conversations.

```
File: src/mcp/memory/server.ts

Tools available but never auto-invoked:
- memory_store  → agent must decide to save
- memory_search → agent must decide to recall
- memory_get    → agent must know what file to read
- memory_list   → agent must decide to check what exists
```

#### C. New conversation tabs get fresh sessions

When a user clicks `+` to create a new conversation tab, it spawns a fresh session with
no `--resume` flag. The agent starts with zero context from prior conversations.

```
File: src/cli/commands/start.ts (lines 376-378)

if (conversationId && sessionMap.has(conversationId)) {
  args.push('--resume', sessionMap.get(conversationId)!);
}
// New conversation → not in sessionMap → no --resume → blank slate
```

#### D. Session mapping is in-memory only

The `conversationId → claude session ID` mapping lives in a JavaScript `Map`:

```
File: src/cli/commands/start.ts (line 363)

const sessionMap = new Map<string, string>();
```

This is lost on every server restart. Even within the same tab, a restart means the agent
loses its conversation thread and starts fresh.

#### E. MEMORY.md starts empty and stays empty

The memory tab in the admin UI shows Jarvis's MEMORY.md contains only the default header:
```
# Memory
_Curated knowledge and observations._
```

Nothing was ever stored because the agent was never instructed to save observations.

### Impact

- Agents appear to have amnesia across conversation tabs
- Users cannot build long-term relationships with agents
- The reflection cycle (`src/agents/reflection.ts`) reads recent memory logs to improve
  SOUL.md, but if agents never store memories, reflection has nothing to work with
- The FTS5 search index exists but is empty

---

## Issue 2: Agents Cannot Manage Skills

### Symptom

User asks Jarvis "can you create skills for yourself?" Jarvis correctly responds that it
cannot install or activate skills on its own.

### Root Causes

#### A. `coding` preset excludes skills MCP entirely

Jarvis is a `coding` agent. The coding preset only mounts `memory` and `sessions` MCP servers:

```
File: src/agents/presets.ts (lines 80-84)

coding: [
  ...CODING_TOOLS,     // Read, Edit, Write, Bash, Glob, Grep, NotebookEdit
  MCP_MEMORY,          // mcp__memory__*
  MCP_SESSIONS,        // mcp__sessions__*
  // ❌ No MCP_SKILLS — agent cannot even see the skills system
],
```

```
File: src/engine/manager.ts (lines 38-44)

const MCP_SERVERS_BY_PRESET: Record<string, readonly string[]> = {
  potato:    [],
  coding:    ['memory', 'sessions'],          // ❌ No skills server
  messaging: ['memory', 'sessions', 'messaging'],
  full:      BUILTIN_MCP_SERVERS,             // ✅ Includes skills
  custom:    [],
};
```

Only the `full` preset includes the skills MCP server.

#### B. Even with skills access, everything goes to pending/

Both `skills_install` and `skills_create` write to `~/.clade/skills/pending/`:

```
File: src/mcp/skills/server.ts (lines 218, 300)

const skillDir = join(pendingDir, dirName);  // Always pending
```

There is no self-approval mechanism. Agents cannot move skills from `pending/` to `active/`.

#### C. The stated rationale is self-mutation prevention

From CLAUDE.md:
> "Config is read-only from agents (prevents the self-mutation crash loops that plague OpenClaw)."

This was a blanket response to a specific failure mode, applied too broadly.

### Impact

- Agents cannot expand their own capabilities even when the user wants them to
- The `coding` preset (most common) has no visibility into the skills system at all
- Agents cannot even search for available skills on npm
- The approval workflow exists but is unreachable for most agents

---

## Issue 3: The Autonomy Philosophy is Contradictory

### Design claims vs. reality

| CLAUDE.md Claim | Implementation Reality |
|---|---|
| "Agents are proactive by default" (Decision #8) | Agents can't load their own memory at session start |
| "Memory: human-auditable, version-controllable" (Decision #5) | Memory exists but agents don't read or write it automatically |
| "Skills = MCP servers" (Decision #4) | Most presets don't mount the skills MCP |
| "Reflection cycle evolves SOUL.md" (Decision #9) | Reflection reads empty memory logs → no meaningful evolution |
| "RALPH loop for continuous autonomous work" | RALPH works, but regular chat sessions have zero continuity |
| "Agents observe, anticipate, and act" | Agents start blank every conversation, observe nothing |

### The fundamental tension

Clade made two incompatible architectural commitments:

1. **"Agents should be autonomous"** — proactive, self-improving, self-aware
2. **"Config is read-only from agents"** — agents cannot modify their own capabilities

These conflict because meaningful autonomy requires the ability to:
- Remember past interactions (requires writing to and reading from memory)
- Expand capabilities when needed (requires skill management)
- Adapt behavior based on experience (requires memory → reflection pipeline to actually work)

The RALPH loop (src/engine/ralph.ts) is the one place where autonomy works well: it has its
own task planning, progress tracking, verification, and retry logic. But it operates completely
independently of the chat/conversation system.

---

## Comparison with OpenClaw

OpenClaw (https://github.com/openclaw/openclaw) takes a fundamentally different approach:

| Aspect | Clade | OpenClaw |
|---|---|---|
| **Safety model** | Capability restriction (remove tools) | Sandbox isolation (Docker + denylists) |
| **Session persistence** | In-memory Map (lost on restart) | Session history with compaction/summarization |
| **Memory injection** | Agent must manually call MCP tools | Workspace context auto-injected |
| **Skill management** | Agents can't see skills (most presets) | Skills discoverable via ClawHub |
| **Trust model** | Agents are untrusted by default | DMs trusted, groups sandboxed |
| **Elevation** | Permanent restriction per preset | Per-session elevation toggles |

### Key OpenClaw insight: sandbox > restriction

OpenClaw's "self-mutation crash loops" were a real problem. But their solution wasn't to
make agents powerless — it was to **sandbox** their power:

- Non-main sessions run in Docker containers
- Tool allowlists are per-session, not per-agent
- Sensitive operations require explicit elevation
- The agent can still do things, but within safe boundaries

Clade's response was to strip capabilities entirely, which prevents the crash loops but
also prevents useful autonomous behavior.

---

## Recommended Fixes

### Fix 1: Auto-inject memory at session start

Prepend MEMORY.md content (or a recent summary) to `--append-system-prompt` alongside
SOUL.md. This gives agents persistent context without requiring explicit MCP calls.

**Location**: `src/cli/commands/start.ts` lines 380-393
**Change**: Read `MEMORY.md` and include it in `systemParts[]`

### Fix 2: Persist sessionMap to SQLite

The `conversationId → session ID` mapping must survive server restarts.

**Location**: `src/cli/commands/start.ts` line 363
**Change**: Use the existing SQLite store instead of `new Map<string, string>()`

### Fix 3: Add memory-recall instruction to system prompt

Tell agents: "When starting a new conversation, search your memory for relevant context
about this user." This can go in SOUL.md templates or be appended automatically.

**Location**: `src/agents/templates.ts` and/or `src/cli/commands/start.ts`

### Fix 4: Give `coding` preset access to skills MCP

Agents should be able to discover and request skills. The `pending/` approval gate is
sufficient safety — there's no reason to hide the entire skills system.

**Location**: `src/agents/presets.ts` line 80-84, `src/engine/manager.ts` line 39-40
**Change**: Add `MCP_SKILLS` to `coding` preset's allowed tools and `'skills'` to MCP servers

### Fix 5: Add auto-memory-store behavior

After meaningful interactions, agents should be instructed to store key facts. This can
be part of the system prompt or SOUL.md template.

**Location**: Agent SOUL.md templates in `src/agents/templates.ts`

### Fix 6: Consider sandbox isolation for skill activation

Instead of requiring human approval for every skill, allow agents to self-activate skills
within a sandbox. Human approval can be required for sandbox escape (accessing host
filesystem, network, etc.).

---

## Affected Files

| File | Issue | Lines |
|---|---|---|
| `src/cli/commands/start.ts` | Memory not injected; sessionMap ephemeral | 363, 380-393 |
| `src/agents/presets.ts` | `coding` excludes skills | 80-84 |
| `src/engine/manager.ts` | MCP server mapping excludes skills for coding | 38-44 |
| `src/mcp/skills/server.ts` | All skills go to pending/ | 218, 300 |
| `src/mcp/memory/server.ts` | Memory tools exist but never auto-invoked | Full file |
| `src/agents/reflection.ts` | Reflection reads empty memory | 184-204 |
| `src/agents/templates.ts` | Templates don't instruct memory usage | Full file |

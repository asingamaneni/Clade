# Roadmap: Clade as Personal AI Employee

> **Date**: 2026-02-03
> **Context**: Practical assessment of what it takes to go from current state to
> "first AI employee that does real work," and what's achievable vs. what isn't.

## Honest Assessment

The six fixes from the previous analysis (memory injection, session persistence, skills
visibility, etc.) solve immediate pain points but don't get you to "personal AI employee."
They fix the amnesia and the skills blindness. But an employee who can remember your name
and see the tool shed still can't do work if nobody connects the conveyor belt.

The good news: **the architecture doesn't need a rewrite.** The subprocess model
(`claude -p` per interaction) is fine for a personal assistant. The analogy is an employee
who gets amnesia every night but reads perfect notes every morning and writes perfect notes
every evening. With good enough context injection, ephemeral subprocesses can provide
continuous service.

The pieces that exist and work:
- RALPH loop (autonomous task execution with planning/verification/retry)
- Memory infrastructure (MCP server, FTS5 search, daily logs, MEMORY.md)
- Reflection cycle (SOUL.md self-improvement from experience)
- Cron/heartbeat (periodic proactive checks)
- Channel adapters (Telegram, Slack, Discord, webchat)
- Agent collaboration (delegation, shared memory, pub/sub)
- Skills system (npm-based MCP discovery/installation)
- Chat UI with multi-conversation tabs
- SessionManager with SQLite persistence (in full gateway)

The pieces that are broken or disconnected:
- Memory never injected into sessions
- Session persistence missing in placeholder server (the one the UI actually uses)
- Skills hidden from most agent presets
- No bridge between chat and RALPH (can't say "go build X" in chat)
- Heartbeat/cron sessions have no context from chat
- Reflection reads empty memory (agents never store anything)
- Agent templates don't instruct memory/tool usage patterns

## What "Personal AI Employee" Actually Requires

| Capability | Status | Gap |
|---|---|---|
| Remember everything you tell it | Broken | Memory not injected, not stored |
| Continue conversations across sessions | Broken | sessionMap is ephemeral |
| Execute coding tasks | Works (RALPH) | Not triggerable from chat |
| Execute research tasks | Partial | Template exists, memory doesn't work |
| Monitor systems proactively | Partial | Heartbeat works but context-blind |
| Learn your preferences over time | Broken | Reflection reads empty memory |
| Expand its own capabilities | Broken | Skills hidden from most presets |
| Work while you're away | Works (RALPH/cron) | Results don't feed back to chat |
| Report progress asynchronously | Partial | Cron can deliver to channels |
| Coordinate with other agents | Exists | Untested in practice with broken memory |

---

## Implementation Roadmap

### Phase 1: Agent Remembers You

**Goal**: Every conversation starts with the agent knowing who you are, what you've
discussed before, and what matters to you.

#### 1A. Inject memory at session start

The `askClaude()` function in `start.ts:366-465` builds the system prompt from agent
context + SOUL.md. Add MEMORY.md to this.

**File**: `src/cli/commands/start.ts`
**Change**: In the `askClaude()` function (line 380-393), after loading SOUL.md, also
load MEMORY.md and inject it:

```typescript
// After soul injection (line 389):
const memoryPath = join(agentDir, 'MEMORY.md');
if (existsSync(memoryPath)) {
  const memory = readFileSync(memoryPath, 'utf-8');
  if (memory.trim() && memory.trim() !== '# Memory\n_Curated knowledge and observations._') {
    systemParts.push('## Your Memory\n\n' + memory.trim());
  }
}
```

Also do the same in `SessionManager.sendMessage()` (`manager.ts:130-137`) where it
passes `soulContent` as `systemPrompt`. Append MEMORY.md content there too.

#### 1B. Persist session mapping to disk

Replace the in-memory `Map` at `start.ts:363` with a JSON file or SQLite table.

**File**: `src/cli/commands/start.ts`
**Change**: Replace `const sessionMap = new Map<string, string>()` with file-backed
persistence:

```typescript
const sessionMapPath = join(cladeHome, 'data', 'session-map.json');

function loadSessionMap(): Record<string, string> {
  if (existsSync(sessionMapPath)) {
    return JSON.parse(readFileSync(sessionMapPath, 'utf-8'));
  }
  return {};
}

function saveSessionMapping(convId: string, sessionId: string): void {
  const map = loadSessionMap();
  map[convId] = sessionId;
  writeFileSync(sessionMapPath, JSON.stringify(map, null, 2), 'utf-8');
}

function getSessionId(convId: string): string | undefined {
  return loadSessionMap()[convId];
}
```

Then update `askClaude()` to use `getSessionId()` and `saveSessionMapping()` instead
of `sessionMap.get()` and `sessionMap.set()`.

#### 1C. Add memory instructions to SOUL.md templates

Every template in `src/agents/templates.ts` needs a "Memory" section telling the agent
how to use its memory tools.

**File**: `src/agents/templates.ts`
**Change**: Add to each template's soulSeed, before the closing backtick:

```markdown
## Memory Protocol

You have access to memory tools. Use them:
- **After important conversations**: Call `memory_store` with key facts, decisions,
  and user preferences. Target `longterm` for enduring facts, `daily` for session notes.
- **At the start of new topics**: Call `memory_search` to check if you've discussed
  this before.
- **When the user says "remember this"**: Always store it immediately to longterm memory.
- Your MEMORY.md is injected at session start, but it may not contain everything.
  Search daily logs for detailed history.
```

#### 1D. Add MCP config to placeholder server's askClaude

The `askClaude()` function in `start.ts` currently spawns `claude` **without any
`--mcp-config`**. This means agents in the admin UI chat have NO access to memory
tools, session tools, or skills tools. They literally cannot store or search memory
even if instructed to.

**File**: `src/cli/commands/start.ts`
**Change**: In `askClaude()`, build and pass an MCP config file just like
`SessionManager.buildMcpConfig()` does in `manager.ts:268-346`. This is the single
most impactful fix — without it, none of the memory instructions matter because the
agent has no tools to act on them.

---

### Phase 2: Agent Does Work From Chat

**Goal**: You can tell an agent in chat "go build feature X" and it executes
autonomously, reporting back when done.

#### 2A. Chat-triggered RALPH execution

When a user sends a message that describes a multi-step task, the agent should
be able to spawn a RALPH loop instead of trying to do everything in one turn.

**File**: New function in `src/engine/ralph.ts` or `src/cli/commands/start.ts`
**Approach**:
1. Agent writes a PLAN.md based on the user's request
2. RALPH loop picks it up and executes
3. Progress events are forwarded back to the chat WebSocket
4. On completion, result is posted as an assistant message

The key integration points:
- `start.ts` WebSocket handler needs to detect "work mode" responses
- RALPH's `onProgress` callback should emit WebSocket messages
- The RALPH `onStatusUpdate` callback already exists (`ralph.ts:29`) — wire it
  to the WebSocket

#### 2B. Placeholder server → SessionManager

The placeholder server (`start.ts:467+`) reimplements session handling badly. It
should use the real `SessionManager` class.

**File**: `src/cli/commands/start.ts`
**Change**: Initialize a `Store`, `AgentRegistry`, and `SessionManager` at startup
instead of using the raw `askClaude()` function. This gets you:
- SQLite session persistence (survives restarts)
- Proper MCP config building (agents get their tools)
- Session queuing (prevents concurrent writes)
- Session key management (proper user/channel mapping)

This is the largest single change but it eliminates the entire class of "placeholder
server doesn't do X" problems.

#### 2C. Skills MCP for all presets

**File**: `src/agents/presets.ts` (line 80-84), `src/engine/manager.ts` (line 38-44)
**Change**:
```typescript
// manager.ts
coding: ['memory', 'sessions', 'skills'],  // Add skills
messaging: ['memory', 'sessions', 'messaging', 'skills'],  // Add skills
```
```typescript
// presets.ts — add MCP_SKILLS to coding and messaging tool lists
```

The `pending/` approval gate is sufficient safety. Hiding the skills system entirely
is over-restriction.

---

### Phase 3: Agent Is Proactive

**Goal**: The agent does things without being asked. Checks in, notices things,
follows up.

#### 3A. Heartbeat reads recent chat context

Currently, heartbeat/cron executions (`scheduler.ts:113-134`) send a prompt to the
agent with no context from recent chat conversations. The agent doesn't know what
you discussed 10 minutes ago.

**File**: `src/cron/scheduler.ts`
**Change**: In `executeJob()`, before sending the prompt, read the agent's recent
chat messages and recent memory, and prepend them as context:

```typescript
private async executeJob(row: CronJobRow): Promise<void> {
  // Load recent context
  const recentMemory = loadRecentMemory(row.agent_id, 24); // last 24 hours
  const recentChats = loadRecentChatSummary(row.agent_id, 5); // last 5 messages

  const contextualPrompt = [
    '## Recent Context',
    recentMemory,
    recentChats,
    '',
    '## Your Scheduled Task',
    row.prompt,
  ].join('\n');

  const result = await this.sessionManager.sendMessage(
    row.agent_id,
    contextualPrompt,
  );
  // ...
}
```

#### 3B. Session compaction for long conversations

As conversations grow, `--resume` replays the full session history, eventually
hitting context limits. Need automatic summarization.

**Approach**:
1. After N messages in a conversation, trigger a "summarize this conversation" call
2. Store the summary in memory
3. Start a new session seeded with the summary
4. Update the conversation's session mapping to the new session

This is similar to OpenClaw's session compaction but built on top of the
subprocess model.

#### 3C. Cross-conversation awareness

When starting a new conversation tab, inject summaries of other recent conversations
so the agent has continuity across tabs.

**File**: `src/cli/commands/start.ts` (in the WebSocket message handler)
**Change**: Before calling `askClaude()` for a new conversation, load the last
few messages from other conversations and inject as context.

---

## What Clade Can't Do (And Shouldn't Try)

Some things OpenClaw does that don't fit Clade's architecture:

1. **Real-time event observation**: OpenClaw's persistent runtime watches all channels
   simultaneously. Clade's subprocess model means agents only exist when invoked.
   Heartbeat partially compensates, but it's polling not event-driven. This is an
   acceptable tradeoff — polling every 15 minutes is fine for a personal assistant.

2. **Device control**: OpenClaw has iOS/Android/macOS device nodes. This requires
   native platform integration. Clade's platform MCP server has some of this
   (notifications, clipboard, screenshots) but it's not as deep.

3. **Docker sandboxing**: OpenClaw isolates non-main sessions in Docker containers.
   This requires Docker infrastructure. For a personal assistant running on your
   own machine, the trust model is different — you trust your own agent. The
   `pending/` approval gate for skills is sufficient.

4. **Concurrent multi-agent orchestration**: OpenClaw can run multiple agents
   simultaneously via its persistent runtime. Clade can too (via separate subprocess
   invocations) but coordination is through the message bus, which requires agents
   to be actively running. This works for structured workflows (RALPH, cron) but
   not for ad-hoc real-time coordination.

## Priority Order

If you want to get to "usable personal assistant" as fast as possible:

1. **1D** (MCP config in placeholder server) — Without this, agents have NO tools in
   the admin UI chat. Everything else is moot.
2. **1A** (Memory injection) — Agent starts every conversation knowing your history.
3. **1B** (Session persistence) — Conversations survive server restarts.
4. **1C** (Memory instructions in templates) — Agent knows to store and recall.
5. **2B** (Placeholder → SessionManager) — Eliminates the entire "two server" problem.
6. **2C** (Skills for all presets) — Agents can expand capabilities.
7. **2A** (Chat-triggered RALPH) — "Go build this" works from chat.
8. **3A** (Heartbeat context) — Proactive behavior is context-aware.
9. **3C** (Cross-conversation awareness) — Agent has continuity across tabs.
10. **3B** (Session compaction) — Long conversations don't break.

Items 1-4 are the minimum to go from "demo" to "usable."
Items 5-7 get you to "productive."
Items 8-10 get you to "autonomous."

## The Subprocess Model Is Fine

The key insight: **you don't need a persistent runtime to have a persistent assistant.**
You need persistent context injection. Every `claude -p` invocation is a fresh "day" for
the agent. If it reads its notes (MEMORY.md + recent context) at the start of each day
and writes notes (memory_store) at the end, it can maintain continuity indefinitely.

OpenClaw's persistent runtime is elegant but comes with its own costs: crash recovery,
state corruption, resource management. The subprocess model sidesteps all of that. Each
invocation is clean. The price is that you need better context injection — which is
exactly what this roadmap addresses.

Clade's architecture is sound for what it's trying to do: use Claude Code Max (flat-rate
subscription) via the CLI to power personal agents. The problem isn't the architecture.
It's the wiring between components that already exist.

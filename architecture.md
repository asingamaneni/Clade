# Clade Architecture

## System Overview

Clade is a multi-agent orchestration platform that uses the `claude` CLI as its
AI engine. Instead of reimplementing an LLM runtime, it spawns Claude Code subprocesses
and focuses on what Claude Code doesn't have: multi-agent identity, persistent memory,
channel routing, proactive scheduling, and autonomous work loops.

```
┌────────────────────────────────────────────────────────────────────┐
│                        Clade Gateway                          │
│                    (Fastify HTTP + WebSocket)                      │
│                     http://localhost:7890                           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Telegram  │ │  Slack   │ │ Discord  │ │ WebChat  │ │Webhook │ │
│  │ Adapter   │ │ Adapter  │ │ Adapter  │ │ Adapter  │ │Adapter │ │
│  └─────┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│        │           │            │             │            │      │
│        └───────────┴────────────┴─────────────┴────────────┘      │
│                                 │                                  │
│                    ┌────────────▼────────────┐                     │
│                    │    Message Router       │                     │
│                    │ (channel+user → agent)  │                     │
│                    └────────────┬────────────┘                     │
│                                 │                                  │
│              ┌──────────────────┼──────────────────┐               │
│              │                  │                   │              │
│     ┌────────▼───────┐ ┌───────▼────────┐ ┌───────▼────────┐    │
│     │ Agent Session 1│ │ Agent Session 2│ │ Agent Session N│    │
│     │ ┌────────────┐ │ │ ┌────────────┐ │ │ ┌────────────┐ │    │
│     │ │claude -p   │ │ │ │claude -p   │ │ │ │claude -p   │ │    │
│     │ │--resume ID │ │ │ │--resume ID │ │ │ │--resume ID │ │    │
│     │ │--append-   │ │ │ │--append-   │ │ │ │--append-   │ │    │
│     │ │ system-    │ │ │ │ system-    │ │ │ │ system-    │ │    │
│     │ │ prompt     │ │ │ │ prompt     │ │ │ │ prompt     │ │    │
│     │ │ SOUL.md    │ │ │ │ SOUL.md    │ │ │ │ SOUL.md    │ │    │
│     │ │--mcp-config│ │ │ │--mcp-config│ │ │ │--mcp-config│ │    │
│     │ │--allowed   │ │ │ │--allowed   │ │ │ │--allowed   │ │    │
│     │ │ Tools ...  │ │ │ │ Tools ...  │ │ │ │ Tools ...  │ │    │
│     │ │--output-   │ │ │ │--output-   │ │ │ │--output-   │ │    │
│     │ │ format     │ │ │ │ format     │ │ │ │ format     │ │    │
│     │ │ stream-json│ │ │ │ stream-json│ │ │ │ stream-json│ │    │
│     │ └────────────┘ │ │ └────────────┘ │ │ └────────────┘ │    │
│     └────────────────┘ └────────────────┘ └────────────────┘    │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    MCP Server Layer                           │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────┐ │ │
│  │  │  Memory   │ │ Sessions  │ │ Messaging │ │   Skills    │ │ │
│  │  │  MCP      │ │ MCP       │ │ MCP       │ │   MCP       │ │ │
│  │  │           │ │           │ │           │ │             │ │ │
│  │  │memory_    │ │sessions_  │ │send_      │ │skills_      │ │ │
│  │  │ store     │ │ list      │ │ message   │ │ search      │ │ │
│  │  │memory_    │ │sessions_  │ │send_      │ │skills_      │ │ │
│  │  │ search    │ │ spawn     │ │ typing    │ │ install     │ │ │
│  │  │memory_    │ │sessions_  │ │get_       │ │skills_      │ │ │
│  │  │ get       │ │ send      │ │ channel_  │ │ create      │ │ │
│  │  │memory_    │ │session_   │ │ info      │ │skills_      │ │ │
│  │  │ list      │ │ status    │ │           │ │ list        │ │ │
│  │  │           │ │agents_    │ │           │ │skills_      │ │ │
│  │  │           │ │ list      │ │           │ │ remove      │ │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └─────────────┘ │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                  Scheduling Layer                             │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────────┐ │ │
│  │  │  Heartbeat    │  │  Cron Jobs    │  │  RALPH Loop     │ │ │
│  │  │  (interval)   │  │  (schedule)   │  │  (autonomous)   │ │ │
│  │  └───────────────┘  └───────────────┘  └─────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  SQLite Store                                                 │ │
│  │  sessions | users | skills | cron_jobs | memory_index | logs │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Admin Dashboard (React + Tailwind, served at /admin)        │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Engine (src/engine/)

The engine is the heart of Clade. It wraps the `claude` CLI.

#### claude-cli.ts

Spawns `claude -p "prompt" --output-format stream-json` as a child process.
Parses the NDJSON stream line by line, emitting typed events:

```typescript
interface ClaudeStreamEvent {
  type: 'system' | 'assistant' | 'tool_use' | 'tool_result' | 'result';
  // ...varies by type
}
```

Key flags used per invocation:
- `--append-system-prompt` — Agent identity (SOUL.md content)
- `--resume <session_id>` — Session continuity
- `--allowedTools` — Per-agent tool restrictions
- `--mcp-config <path>` — Skills (MCP servers) for this agent
- `--max-turns` — Limit autonomous iterations
- `--model` — Agent-specific model selection
- `--output-format stream-json` — Structured output for parsing

#### session.ts

Session state persisted in SQLite:
- `session_id` (from claude CLI result)
- `agent_id` (which agent owns this session)
- `channel` + `channel_user_id` (origin)
- `created_at`, `last_active_at`
- `status` (active | idle | terminated)

#### manager.ts

Session lifecycle:
- `createSession(agentId, prompt, channel?)` — New session
- `resumeSession(sessionId, prompt)` — Continue existing
- `destroySession(sessionId)` — Clean up
- Handles concurrent session limits per agent
- Queue management for back-to-back messages

#### ralph.ts

RALPH loop for autonomous work:
```
┌─── Loop (fresh context each iteration) ──────────────────────────┐
│ 1. Read PLAN.md → find next task with status "open"              │
│ 2. Set task status to "in_progress" in PLAN.md                   │
│ 3. Read progress.md → accumulated learnings from prior iterations│
│ 4. Build prompt with task + learnings + guidelines               │
│ 5. Spawn: claude -p "work prompt" --max-turns 25                 │
│ 6. Parse result                                                  │
│ 7. Run verification: configurable command (npm test, etc.)       │
│ 8. Passing? → mark task "done", git commit, append learnings     │
│ 9. Failing? → increment retry count, append failure info         │
│ 10. Max retries hit? → mark "blocked", move to next task         │
│ 11. All tasks done or blocked? → EXIT                            │
│ 12. More tasks? → LOOP (fresh claude instance, full context)     │
└──────────────────────────────────────────────────────────────────┘
```

### 2. Agents (src/agents/)

Each agent is a directory under `~/.clade/agents/<name>/`:
- `SOUL.md` — Personality, identity, behavioral guidelines
- `HEARTBEAT.md` — What to check on each heartbeat cycle
- `MEMORY.md` — Curated long-term memory
- `memory/` — Daily logs (YYYY-MM-DD.md)
- `PLAN.md` — (optional) RALPH loop task list
- `progress.md` — (optional) RALPH accumulated learnings

Agent config stored in `~/.clade/config.json`:
```json
{
  "agents": {
    "main": {
      "name": "Main Assistant",
      "description": "General-purpose personal assistant",
      "model": "sonnet",
      "toolPreset": "full",
      "customTools": [],
      "skills": ["memory", "sessions"],
      "heartbeat": {
        "enabled": true,
        "interval": "30m",
        "suppressOk": true
      }
    }
  }
}
```

Tool presets map to `--allowedTools` arrays:
- **potato**: No tools (just chat)
- **coding**: Read, Edit, Write, Bash, Glob, Grep + memory/sessions MCP
- **messaging**: Memory/sessions/messaging MCP only
- **full**: All Claude Code tools + all MCP tools
- **custom**: Explicitly listed tools

### 3. MCP Servers (src/mcp/)

Four custom MCP servers, each a stdio process:

#### Memory MCP (src/mcp/memory/)
- Stores in `~/.clade/agents/<agentId>/MEMORY.md` and `memory/*.md`
- SQLite FTS5 index for full-text search
- Chunks files at ~400 tokens with 80-token overlap for search
- Auto-creates daily log files

#### Sessions MCP (src/mcp/sessions/)
- Communicates with the session manager via IPC (Unix socket or named pipe)
- Can spawn sub-agent sessions (different agent personality)
- Can send messages between agent sessions

#### Messaging MCP (src/mcp/messaging/)
- Communicates with channel adapters via IPC
- Agents can proactively send messages to any configured channel
- Routing is deterministic (agent specifies channel + recipient)

#### Skills MCP (src/mcp/skills/)
- Searches npm registry for MCP server packages
- Stages new skills in `~/.clade/skills/pending/`
- Requires human approval before activation
- Can create custom skills (agent writes MCP server config)

### 4. Gateway (src/gateway/)

Fastify server on port 7890 (configurable).

Routes:
- `GET /` — Redirect to admin UI
- `GET /admin/*` — Serve React admin dashboard
- `WS /ws` — WebSocket for WebChat + real-time admin updates
- `POST /api/agents` — CRUD agents
- `GET /api/agents/:id/memory` — Browse memory
- `POST /api/agents/:id/memory/search` — Search memory
- `GET /api/sessions` — List sessions
- `POST /api/sessions/:id/send` — Send message to session
- `GET /api/skills` — List skills (active + pending)
- `POST /api/skills/:name/approve` — Approve pending skill
- `GET /api/cron` — List cron jobs
- `POST /api/cron` — Create cron job
- `GET /api/config` — Get global config
- `PUT /api/config` — Update global config
- `POST /api/webhook/:agent` — Webhook trigger for agent

### 5. Router (src/router/)

Maps inbound messages to agent sessions:

```
(channel, channelUserId, chatId?) → (agentId, sessionId)
```

Routing rules (evaluated in order):
1. Explicit mapping: "Telegram user @john → agent personal"
2. Channel default: "All Slack messages → agent work"
3. Global default: "Everything else → agent main"

DMs share the agent's main session. Group chats get isolated sessions
keyed by `agent:<agentId>:<channel>:<chatId>`.

### 6. Channels (src/channels/)

Each adapter implements:

```typescript
interface ChannelAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(to: string, text: string): Promise<void>;
  sendTyping(to: string): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
}
```

### 7. Scheduling (src/cron/)

#### Heartbeat
- Per-agent configurable interval (15m / 30m / 1h / 4h / daily)
- Active hours support (don't wake at 3am)
- Reads agent's HEARTBEAT.md as the checklist
- Suppresses HEARTBEAT_OK responses (only delivers alerts)
- Separate prompt pipeline from reactive messages (no contamination)

#### Cron
- Standard cron expressions via node-cron
- Per-job: name, schedule, agent, prompt, delivery channel
- Persisted in SQLite, survives restarts

### 8. Store (src/store/)

SQLite via better-sqlite3:

```sql
-- Core tables
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,          -- claude session ID
  agent_id TEXT NOT NULL,
  channel TEXT,
  channel_user_id TEXT,
  chat_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  last_active_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,       -- default agent for this user
  display_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel, channel_user_id)
);

CREATE TABLE skills (
  name TEXT PRIMARY KEY,
  status TEXT DEFAULT 'pending', -- pending | active | disabled
  package TEXT,                  -- npm package or local path
  config TEXT,                   -- JSON config
  requested_by TEXT,             -- agent that requested it
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE cron_jobs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schedule TEXT NOT NULL,        -- cron expression
  agent_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  deliver_to TEXT,               -- channel:target
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE memory_index (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  chunk_start INTEGER,
  chunk_end INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- FTS5 virtual table for memory search
CREATE VIRTUAL TABLE memory_fts USING fts5(
  chunk_text,
  content=memory_index,
  content_rowid=id
);
```

## Data Flow: Reactive Message

```
1. Slack event: user sends "Check my PRs" in #general
   │
2. Slack adapter wraps as InboundMessage:
   │  { channel: "slack", userId: "U123", chatId: "C456", text: "Check my PRs" }
   │
3. Router lookups:
   │  users table: (slack, U123) → agent "work"
   │  sessions table: (work, slack, U123, C456) → session_id "sess_abc123"
   │
4. Session manager builds CLI args:
   │  claude -p "Check my PRs"
   │    --resume sess_abc123
   │    --append-system-prompt <SOUL.md content>
   │    --mcp-config /tmp/clade-work-mcp.json
   │    --allowedTools "Read,Edit,Bash,Glob,Grep,mcp__memory__*,mcp__sessions__*"
   │    --output-format stream-json
   │    --max-turns 15
   │
5. Parse stream-json events:
   │  → Send typing indicator on assistant content_block_start
   │  → On result.success: extract text, update session last_active_at
   │
6. Slack adapter: post response to #general (threaded if in thread)
```

## Data Flow: Heartbeat

```
1. Cron timer fires for agent "main" (every 30 minutes)
   │
2. Check active hours (skip if outside 09:00-22:00)
   │
3. Read ~/.clade/agents/main/HEARTBEAT.md
   │
4. Build prompt:
   │  "Heartbeat check. Here is your checklist:\n\n<HEARTBEAT.md>\n\n
   │   Review each item. Take action if needed. If nothing needs attention,
   │   respond with exactly: HEARTBEAT_OK"
   │
5. Spawn claude -p with the main agent's session
   │
6. Parse result:
   │  If result contains "HEARTBEAT_OK" → suppress, log only
   │  Otherwise → deliver to configured channel (e.g., slack:#alerts)
```

## Data Flow: RALPH Loop

```
1. User runs: clade work --agent coder --plan ./PLAN.md
   │  OR: cron job triggers work mode for agent "coder"
   │
2. RALPH engine reads PLAN.md:
   │  - [ ] Implement user authentication
   │  - [ ] Add rate limiting middleware
   │  - [x] Set up database schema
   │  → Picks first incomplete: "Implement user authentication"
   │
3. Read progress.md for accumulated context
   │
4. Build work prompt with task + progress + verification command
   │
5. Spawn: claude -p "Implement user authentication. ..."
   │    --max-turns 25
   │    --allowedTools "Read,Edit,Write,Bash,Glob,Grep"
   │    --append-system-prompt <coder SOUL.md>
   │
6. Parse result → agent modified files
   │
7. Run verification: npm test (configurable)
   │  Passing? → mark task done, git commit, log learnings
   │  Failing? → log failure, retry or move to next task
   │
8. Loop back to step 2 with fresh context
```

## Security Model

1. **SOUL.md is read-only**: Injected via `--append-system-prompt`, not a workspace file.
   Agents cannot modify their own personality.

2. **Config is read-only**: `~/.clade/config.json` is never in the agent's workspace.
   The Skills MCP server provides read-only access to relevant config.

3. **Skill approval gate**: Agent-requested skills go to `pending/` and require human
   approval via admin UI or CLI before activation.

4. **Per-agent tool restrictions**: `--allowedTools` enforced at the Claude CLI level.
   An agent with "messaging" preset cannot use Bash or Edit.

5. **Session isolation**: Each agent session is a separate OS process.
   No shared memory between concurrent sessions.

6. **Memory isolation**: Each agent has its own memory namespace.
   No cross-agent memory access (prevents prompt injection via shared memory).

## Performance Considerations

- Each `claude -p` invocation spawns a new process. Cold start is ~1-2 seconds.
- Session resume (`--resume`) is faster than new session (context already cached).
- For back-to-back messages in the same session, the manager queues them to avoid
  concurrent writes to the same session.
- MCP servers run as long-lived stdio processes, not spawned per-request.
- SQLite is synchronous (better-sqlite3) — no async overhead for simple queries.
- Admin UI is pre-built and served as static files — no SSR overhead.

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
│  │                    MCP Server Layer (6 servers)              │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐      │ │
│  │  │ Memory  │ │Sessions │ │Messaging│ │ MCP Manager │      │ │
│  │  │ (10)    │ │ (5)     │ │ (3)     │ │ (5)         │      │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘      │ │
│  │  ┌─────────┐ ┌──────────────────────────────────────┐      │ │
│  │  │Platform │ │ Admin MCP (24 tools, orchestrators)  │      │ │
│  │  │ (6)     │ │ skill discovery/install/create/manage│      │ │
│  │  └─────────┘ │ MCP server management, agent mgmt   │      │ │
│  │              │ plugin management                    │      │ │
│  │              └──────────────────────────────────────┘      │ │
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
│  │  SQLite Store                                                       │ │
│  │  sessions | users | mcp_servers | cron_jobs | memory_index | logs │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Admin UI (React + Radix UI + Tailwind + Vite, /admin)      │ │
│  │  14 pages: Dashboard, Chat, Agents, Sessions, MCP, Skills,  │ │
│  │  Channels, Cron, Config, User, Welcome, Activity, Calendar, │ │
│  │  Search  (Mission Control: Activity Feed + Calendar + Search)│ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Related Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Project guide for Claude agents working on this codebase
- **[README.md](./README.md)** — User-facing quickstart and installation guide
- **[tasks.md](./tasks.md)** — Implementation task tracker

> **Note**: This file should be updated whenever architectural changes are made.
> CLAUDE.md should be updated in sync to keep the project guide accurate.

## Core Components

### 1. Engine (src/engine/)

The engine is the heart of Clade. It wraps the `claude` CLI.

#### compat.ts

Detects the installed Claude CLI version and available flags. Adapts arguments
automatically so Clade works across CLI versions:

- Checks `claude --version` and `claude --help` for available flags
- Maps capabilities: `hasPlugins`, `hasAgentsFlag`, `hasMcpToolSearch`, etc.
- `buildCliArgs()` only includes flags the installed version supports
- `exportAsPlugin()` generates Claude Code plugin directory structure
- Caches detection results per process (only runs once)

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
- `--mcp-config <path>` — MCP servers (npm-packaged or custom) for this agent
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

RALPH loop for autonomous work — works for ANY agent type, not just coding.
Domain-aware guidelines adapt the work style (coding, research, ops, general).

```
┌─── Loop (fresh context each iteration) ──────────────────────────┐
│ 1. Read PLAN.md → find next task with status "open"              │
│ 2. Set task status to "in_progress" in PLAN.md                   │
│ 3. Read progress.md → accumulated learnings from prior iterations│
│ 4. Build prompt with task + learnings + domain-specific guidelines│
│ 5. Spawn: claude -p "work prompt" --max-turns 25                 │
│ 6. Parse result                                                  │
│ 7. Run verification: configurable command (optional)             │
│ 8. Passing? → mark "done", git commit (if coding), log learnings │
│ 9. Send status update to user's preferred channel                │
│ 10. Failing? → increment retry count, append failure info        │
│ 11. Max retries hit? → mark "blocked", move to next task         │
│ 12. All tasks done or blocked? → EXIT with summary               │
│ 13. More tasks? → LOOP (fresh claude instance, full context)     │
└──────────────────────────────────────────────────────────────────┘
```

Domain guidelines:
- **coding**: Write production code, run tests, don't modify unrelated code
- **research**: Find accurate info, cross-reference sources, save to memory
- **ops**: Diagnose systematically, attempt remediation, escalate if needed
- **general**: Complete the task to a high standard, verify your work

### 2. Agents (src/agents/)

No pre-defined agents ship with Clade. Users create their own from templates
or from scratch. Each agent is a directory under `~/.clade/agents/<name>/`:

- `SOUL.md` — Personality, identity, behavioral guidelines (evolves via reflection)
- `IDENTITY.md` — Metadata: name, description, creation date
- `HEARTBEAT.md` — What to check on each heartbeat cycle
- `MEMORY.md` — Curated long-term memory
- `TOOLS.md` — Environment and tool notes (injected into system prompt)
- `memory/` — Daily logs (YYYY-MM-DD.md)
- `soul-history/` — Snapshots of SOUL.md before each reflection
- `tools-history/` — Snapshots of TOOLS.md before each update
- `PLAN.md` — (optional) RALPH loop task list
- `progress.md` — (optional) RALPH accumulated learnings

#### Templates (src/agents/templates.ts)

Five starting templates — users pick one and customize:
- **orchestrator** — General-purpose personal assistant, delegates to specialists, manages the platform
- **coding** — Development-focused, owns code quality, runs tests
- **research** — Information gathering, source verification, tracking topics
- **ops** — System monitoring, incident response, automated remediation
- **pm** — Task tracking, coordination, delegation, status reports

Templates provide `soulSeed` (starting SOUL.md) and `heartbeatSeed` (starting
HEARTBEAT.md). These evolve through the reflection cycle as the agent learns
the user's preferences. All templates include a Content Routing Guide that
directs agents to store information in the right place (SKILL.md for procedures,
USER.md for preferences, TOOLS.md for environment notes, MEMORY.md for brief facts).

#### Reflection (src/agents/reflection.ts)

Agents self-improve through periodic reflection:
1. After every N sessions (configurable, default 10), or during heartbeat
2. Agent reviews recent interactions in memory
3. Generates SOUL.md updates (communication style, learned preferences)
4. **Core Principles section is locked** — reflection cannot modify it
5. Previous SOUL.md saved to `soul-history/YYYY-MM-DD.md`
6. Diff-based validation ensures changes are meaningful, not destructive

#### Collaboration (src/agents/collaboration.ts)

Agents interact through:
- **Delegation**: Agent A formally delegates a task to Agent B with context and callback
- **Shared memory**: Agents can read (not write) each other's MEMORY.md
- **Message bus**: Pub/sub topics — publish "code-review-needed", subscribed agents pick it up
- **@mentions**: Agents can reference each other in memory entries

#### Portability (src/agents/portability.ts)

Agents can be moved between machines:
- `clade agent export <name>` → `.agent.tar.gz` bundle (identity, soul, memory, config)
- `clade agent import <file>` → unpacks, validates, reindexes memory
- Git-friendly: entire agent directory is plain markdown, version-controllable

#### Notifications (src/agents/notifications.ts)

Agents proactively update users on their preferred channel:
- Configurable per-agent: "slack:#general", "telegram:12345", etc.
- Severity levels: info, warn, error, critical
- Quiet hours support — suppress non-critical during off-hours
- Digest batching for low-severity notifications

Agent config stored in `~/.clade/config.json`:
```json
{
  "agents": {
    "researcher": {
      "name": "Research Analyst",
      "description": "Gathers and synthesizes information",
      "model": "sonnet",
      "toolPreset": "full",
      "heartbeat": { "enabled": true, "interval": "4h" },
      "reflection": { "enabled": true, "interval": 10 },
      "notifications": { "preferredChannel": "slack:#updates" }
    }
  }
}
```

Tool presets map to `--allowedTools` arrays:
- **potato**: No tools (just chat)
- **coding**: Read, Edit, Write, Bash, Glob, Grep + memory/sessions MCP servers
- **messaging**: Memory/sessions/messaging MCP servers only
- **full**: All Claude Code tools + all MCP servers
- **custom**: Explicitly listed tools

### 3. MCP Servers (src/mcp/)

Six custom MCP servers, each a stdio process:

#### Memory MCP (src/mcp/memory/) -- 10 tools
- `memory_store`, `memory_search`, `memory_get`, `memory_list` -- Core memory operations
- `user_get`, `user_store` -- Read/write the global USER.md (user preferences/facts)
- `tools_get`, `tools_store` -- Read/write per-agent TOOLS.md (environment/tool notes)
- `skill_create`, `skill_list` -- Create and list SKILL.md instruction files
- Stores in `~/.clade/agents/<agentId>/MEMORY.md` and `memory/*.md`
- SQLite FTS5 index for full-text search
- Chunks files at ~400 tokens with 80-token overlap for search
- Auto-creates daily log files

#### Sessions MCP (src/mcp/sessions/) -- 5 tools
- `sessions_list`, `sessions_spawn`, `sessions_send`, `session_status`, `agents_list`
- Communicates with the session manager via IPC (Unix socket or named pipe)
- Can spawn sub-agent sessions (different agent personality)
- Can send messages between agent sessions

#### Messaging MCP (src/mcp/messaging/) -- 3 tools
- `send_message`, `send_typing`, `get_channel_info`
- Communicates with channel adapters via IPC
- Agents can proactively send messages to any configured channel
- Routing is deterministic (agent specifies channel + recipient)

#### MCP Manager (src/mcp/mcp-manager/) -- 5 tools
- `mcp_search`, `mcp_install`, `mcp_create`, `mcp_list`, `mcp_remove`
- Searches npm registry for MCP server packages
- Stages new MCP servers in `~/.clade/mcp/pending/`
- Requires human approval before activation
- Can create custom MCP server configs (agent writes MCP server config)

#### Platform MCP (src/mcp/platform/) -- 6 tools
- `platform_notify`, `platform_clipboard_read`, `platform_clipboard_write`, `platform_open`, `platform_screenshot`, `platform_info`
- Native OS interactions: notifications, clipboard, open URLs, screenshots
- Auto-detects macOS vs Linux and uses appropriate commands
- Graceful fallback when commands are unavailable
- System info: OS, hostname, shell, terminal, uptime

#### Admin MCP (src/mcp/admin/) -- 24 tools
- **Skill Discovery** (5): `admin_skill_search_local`, `admin_skill_search_github`, `admin_skill_search_npm`, `admin_skill_search_web`, `admin_skill_search_all`
- **Skill Installation** (6): `admin_skill_install_github`, `admin_skill_install_url`, `admin_skill_install_npm`, `admin_skill_remove`, `admin_skill_approve`, `admin_skill_reject`
- **Skill Creation** (5): `admin_skill_create`, `admin_skill_create_with_scripts`, `admin_skill_create_from_template`, `admin_skill_list_templates`, `admin_skill_update`
- **MCP Management** (4): `admin_mcp_list`, `admin_mcp_install`, `admin_mcp_remove`, `admin_mcp_search_npm`
- **Agent Management** (2): `admin_agent_list`, `admin_agent_assign_mcp`
- **Plugin Management** (2): `admin_plugin_list`, `admin_plugin_install_github`
- Only injected into agents with `admin.enabled: true` in their config
- Enables orchestrator agents to autonomously discover, install, create, and manage skills, MCP servers, and plugins

### 4. Gateway (src/cli/commands/start.ts)

Fastify server on port 7890 (configurable). All routes are defined in `startPlaceholderServer()`
within `start.ts`, using file-system-based operations (no SQLite store required).

Routes:

**Core:**
- `GET /` — Redirect to admin UI
- `GET /admin` — Serve admin UI (React SPA built by Vite)
- `GET /health` — Health check endpoint
- `WS /ws` — WebSocket for WebChat messaging
- `WS /ws/admin` — WebSocket for real-time admin UI updates

**Agents:**
- `GET /api/agents` — List all agents
- `POST /api/agents` — Create a new agent (from template or custom)
- `GET /api/templates` — List available agent templates

**Chat & Sessions:**
- `GET /api/sessions` — List active sessions (derived from chat data)

**Config:**
- `GET /api/config` — Get global config
- `GET /api/config/full` — Get full raw config
- `PUT /api/config` — Update global config

**MCP Servers:**
- `GET /api/mcp` — List MCP servers (active + pending from `~/.clade/mcp/`)

**Skills (SKILL.md):**
- `GET /api/skills` — List all skills (active, pending, disabled)
- `POST /api/skills/install` — Create/install a new skill
- `POST /api/skills/:name/approve` — Approve pending skill (move to active)
- `POST /api/skills/:name/reject` — Reject pending skill (move to disabled)
- `DELETE /api/skills/:name` — Delete a skill permanently
- `GET /api/skills/:status/:name` — Get skill detail (file contents)
- `POST /api/skills/:name/assign` — Assign skill to an agent
- `POST /api/skills/:name/unassign` — Unassign skill from an agent

**USER.md (global):**
- `GET /api/user` — Get USER.md content
- `PUT /api/user` — Update USER.md (with version history)
- `GET /api/user/history` — Get USER.md version history
- `GET /api/user/history/:date` — Get specific USER.md version

**TOOLS.md (per-agent):**
- `GET /api/agents/:id/tools-md` — Get agent's TOOLS.md content
- `PUT /api/agents/:id/tools-md` — Update agent's TOOLS.md (with version history)
- `GET /api/agents/:id/tools-md/history` — Get TOOLS.md version history
- `GET /api/agents/:id/tools-md/history/:date` — Get specific TOOLS.md version

**Mission Control:**
- `GET /api/activity` — Activity feed (filterable by agent, type; paginated)
- `POST /api/activity` — Log a custom activity event
- `GET /api/calendar/events` — Calendar events (chat sessions, heartbeats, activity)
- `POST /api/search` — Global search across memories, conversations, skills, agents, config

**Other:**
- `GET /api/channels` — List connected channel adapters
- `GET /api/cron` — List cron jobs

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

CREATE TABLE mcp_servers (
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
   The MCP Manager provides read-only access to relevant config.

3. **MCP server approval gate**: Agent-requested MCP servers go to `pending/` and require
   human approval via admin UI or CLI before activation.

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
- Admin UI is a Vite-built React SPA — `npm run build` includes the UI build step.

## Admin UI (ui/)

The admin UI is a React SPA built with Vite, served at `/admin`. Tech stack:
- **React 18** + TypeScript
- **Radix UI** primitives (dialog, tabs, select, tooltip, etc.)
- **Tailwind CSS** + tailwindcss-animate
- **Lucide React** icons
- **Vite 6** build, outputs to `dist/ui/`

14 pages (state-based routing in `App.tsx`):
- **Dashboard** — Agent overview, session status, quick actions
- **Chat** — Multi-conversation tabs per agent, real-time WebSocket messaging
- **Agents** — Agent list, create from templates, per-agent skills/tools tabs
- **Sessions** — Active sessions derived from conversation data
- **MCP** — MCP server management (active/pending)
- **Skills** — Skill management (install, approve/reject, assign to agents, detail view)
- **Channels** — Connected channel adapters
- **Cron** — Cron job listing
- **Config** — Global config editor
- **User** — USER.md editor with version history
- **Welcome/Onboarding** — First-run setup wizard, agent creation flow
- **Activity** — Activity feed with filtering by agent/type (Mission Control)
- **Calendar** — Calendar view of chat sessions, heartbeats, events (Mission Control)
- **Search** — Global search across memories, conversations, skills, agents, config (Mission Control)

## Skills System

Skills are SKILL.md instruction files — reusable procedures, guides, and knowledge
that get injected into agent system prompts. They follow Claude Code's native skill
format.

- **Storage**: `~/.clade/skills/{active,pending,disabled}/<name>/SKILL.md`
- **Lifecycle**: Created (pending) -> Approved (active) or Rejected (disabled) -> Deleted
- **Assignment**: Skills are assigned to agents via config (`agent.skills: ["skill-name"]`)
- **Creation**: Via admin UI, `clade skill` CLI, Memory MCP (`skill_create`), or Admin MCP
- **Content Routing**: Agent templates include routing guides that direct agents to create
  skills for reusable procedures (rather than storing in MEMORY.md)

## USER.md and TOOLS.md

Two additional per-session context files injected into agent system prompts:

- **USER.md** (`~/.clade/USER.md`) — Global user preferences, facts, and habits.
  Shared across all agents. Editable via admin UI or Memory MCP (`user_get`/`user_store`).
  Version history stored in `~/.clade/user-history/`.

- **TOOLS.md** (`~/.clade/agents/<name>/TOOLS.md`) — Per-agent environment and tool notes.
  Each agent has its own. Editable via admin UI or Memory MCP (`tools_get`/`tools_store`).
  Version history stored in `~/.clade/agents/<name>/tools-history/`.

## Browser Configuration

Optional Playwright MCP integration for browser automation. Configured in
`config.json` under the `browser` key:

```json
{
  "browser": {
    "enabled": false,
    "browser": "chromium",
    "headless": false,
    "userDataDir": "~/.clade/browser-profile",
    "cdpEndpoint": "ws://127.0.0.1:9222"
  }
}
```

When enabled, agents get a Playwright MCP server with a persistent browser profile
(cookies, localStorage survive restarts). Supports chromium, chrome, msedge, firefox.
Can connect to an already-running browser via CDP endpoint.

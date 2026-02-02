# System Architecture

Clade is a multi-agent orchestration platform that uses the `claude` CLI as its AI engine. Instead of reimplementing an LLM runtime, it spawns Claude Code subprocesses and focuses on what Claude Code doesn't have: multi-agent identity, persistent memory, channel routing, proactive scheduling, and autonomous work loops.

## System Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        Clade Gateway                               │
│                    (Fastify HTTP + WebSocket)                       │
│                     http://localhost:7890                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ Telegram  │ │  Slack   │ │ Discord  │ │ WebChat  │ │Webhook │  │
│  │ Adapter   │ │ Adapter  │ │ Adapter  │ │ Adapter  │ │Adapter │  │
│  └─────┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘  │
│        └───────────┴────────────┴─────────────┴────────────┘       │
│                                │                                    │
│                   ┌────────────▼────────────┐                      │
│                   │    Message Router       │                      │
│                   │  @mention → rules →     │                      │
│                   │  user mapping → default │                      │
│                   └────────────┬────────────┘                      │
│                                │                                    │
│              ┌─────────────────┼─────────────────┐                 │
│              │                 │                  │                 │
│     ┌────────▼───────┐ ┌──────▼────────┐ ┌──────▼────────┐       │
│     │ Agent Session 1│ │ Agent Session 2│ │ Agent Session N│       │
│     │  claude -p     │ │  claude -p     │ │  claude -p     │       │
│     │  --resume ID   │ │  --resume ID   │ │  --resume ID   │       │
│     │  --append-     │ │  --append-     │ │  --append-     │       │
│     │   system-prompt│ │   system-prompt│ │   system-prompt│       │
│     │  --mcp-config  │ │  --mcp-config  │ │  --mcp-config  │       │
│     │  --allowedTools│ │  --allowedTools│ │  --allowedTools│       │
│     └────────────────┘ └───────────────┘ └───────────────┘        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    MCP Server Layer                            │  │
│  │  Memory │ Sessions │ Messaging │ Skills │ Platform             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Scheduling: Heartbeat (interval) │ Cron │ RALPH (autonomous) │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  SQLite: sessions │ users │ skills │ cron_jobs │ memory_fts   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Admin Dashboard (Preact + HTM + Tailwind, served at /admin)  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

## Core Components

### Engine (`src/engine/`)

The engine wraps the `claude` CLI:

- **claude-cli.ts** — Spawns `claude -p` subprocesses, parses NDJSON stream output
- **session.ts** — Session state persisted in SQLite (session ID, agent, channel, status)
- **manager.ts** — Session lifecycle (create, resume, destroy, queue management)
- **ralph.ts** — RALPH autonomous work loop (domain-aware, any agent type)
- **compat.ts** — Detects CLI version, adapts flags, supports plugin export

### Agents (`src/agents/`)

- **registry.ts** — Agent registry, loads from config, manages agent directories
- **templates.ts** — Four starting templates (coding, research, ops, pm)
- **reflection.ts** — Self-improvement cycle (evolves SOUL.md, Core Principles locked)
- **collaboration.ts** — Delegation, shared memory, pub/sub message bus
- **portability.ts** — Export/import agents as `.agent.tar.gz` bundles
- **notifications.ts** — Proactive user updates (severity, quiet hours, digests)

### MCP Servers (`src/mcp/`)

Five custom MCP servers, each a stdio process:

| Server | Tools | Purpose |
|--------|-------|---------|
| Memory | `memory_store`, `memory_search`, `memory_get`, `memory_list` | Persistent agent memory with FTS5 search |
| Sessions | `sessions_list`, `sessions_spawn`, `sessions_send`, `session_status`, `agents_list` | Session management, sub-agent spawning |
| Messaging | `send_message`, `send_typing`, `get_channel_info` | Cross-channel messaging |
| Skills | `skills_search`, `skills_install`, `skills_create`, `skills_list`, `skills_remove` | MCP skill discovery and management |
| Platform | `platform_notify`, `clipboard_read`, `clipboard_write`, `platform_open`, `platform_screenshot`, `platform_info` | Native OS interaction |

### Gateway (`src/gateway/`)

Fastify HTTP/WebSocket server. See [API Endpoints](/reference/api) for the full route list.

### Store (`src/store/`)

SQLite via better-sqlite3. Tables: `sessions`, `users`, `skills`, `cron_jobs`, `memory_index`, `memory_fts` (FTS5).

## Data Flows

### Reactive Message

```
1. Slack: user sends "@jarvis check my PRs" in #general
2. Slack adapter creates InboundMessage
3. Router parses @jarvis → routes to agent "jarvis"
4. Session manager: finds existing session or creates new
5. Engine spawns: claude -p "check my PRs" --resume <id> ...
6. Stream-JSON parsed → typing indicators → response
7. Slack adapter posts response to #general
```

### Heartbeat

```
1. Scheduler fires for agent "jarvis" (every 30 minutes)
2. Check active hours (skip if outside window)
3. Read HEARTBEAT.md
4. Spawn claude -p with heartbeat prompt
5. If "HEARTBEAT_OK" → suppress
6. Otherwise → deliver to configured channel
```

### RALPH Work Loop

```
1. clade work --agent coder --plan ./PLAN.md
2. Read PLAN.md → find first incomplete task
3. Read progress.md → accumulated learnings
4. Spawn claude -p with task + learnings + domain guidelines
5. Run verification → commit if passing (coding domain)
6. Send status update → loop to next task
```

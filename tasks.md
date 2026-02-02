# Clade - Implementation Tasks

## Phase 1: Core Engine + CLI

### 1.1 Project Scaffolding
- [x] Create package.json with dependencies
- [x] Create tsconfig.json (strict mode)
- [x] Create .gitignore
- [x] Create directory structure
- [x] Create CLAUDE.md, architecture.md, tasks.md

### 1.2 Configuration System
- [x] Define Zod config schema (src/config/schema.ts)
- [x] Config loader with validation (src/config/index.ts)
- [x] Default config generation (src/config/defaults.ts)
- [x] Test: config loads, validates, rejects bad input

### 1.3 SQLite Store
- [x] Database initialization with migrations (src/store/sqlite.ts)
- [x] Sessions table CRUD
- [x] Users table CRUD
- [x] Skills table CRUD
- [x] Cron jobs table CRUD
- [x] Memory index + FTS5 virtual table
- [x] Test: all CRUD operations, FTS5 search

### 1.4 Claude CLI Wrapper
- [x] Spawn claude -p with stream-json (src/engine/claude-cli.ts)
- [x] Parse NDJSON stream events
- [x] Capture session_id from result
- [x] Handle errors (claude not found, auth failure, timeout)
- [x] Support all flags: --resume, --append-system-prompt, --allowedTools, --mcp-config, --max-turns, --model
- [x] Test: spawn mock, parse known stream-json output

### 1.5 Agent Registry
- [x] Load agents from ~/.clade/agents/ (src/agents/registry.ts)
- [x] Agent type definitions (src/agents/types.ts)
- [x] Tool presets: potato, coding, messaging, full, custom (src/agents/presets.ts)
- [x] SOUL.md loading
- [x] Default agent creation (main)
- [x] Test: load agents, apply presets, resolve tools

### 1.6 Session Manager
- [x] Create new sessions (src/engine/manager.ts)
- [x] Resume existing sessions
- [x] Session state tracking (src/engine/session.ts)
- [x] Message queue (serialize per session)
- [x] Destroy/cleanup sessions
- [x] Test: create, resume, queue, destroy

### 1.7 Gateway Server
- [x] Fastify HTTP server (src/gateway/server.ts)
- [x] WebSocket support
- [x] REST API routes
- [x] Serve admin UI
- [x] Health check endpoint
- [x] Test: server starts, API returns data, WS connects

### 1.8 CLI Commands
- [x] Commander.js setup (src/cli/index.ts)
- [x] `clade setup` - interactive wizard (src/cli/commands/setup.ts)
- [x] `clade start` - launch gateway (src/cli/commands/start.ts)
- [x] `clade ask` - one-off question (src/cli/commands/ask.ts)
- [x] `clade agent` - add/remove/list/edit (src/cli/commands/agent.ts)
- [x] `clade doctor` - health check (src/cli/commands/doctor.ts)
- [x] bin/clade.ts entry point
- [x] Test: CLI parses args, commands execute

### 1.9 WebChat Channel
- [x] WebChat adapter (src/channels/webchat.ts)
- [x] WS message handling (connect, message, disconnect)
- [x] HTML/JS client served by gateway
- [x] Test: connect WS, send message, receive response

### Phase 1 Integration Test
- [x] Full flow: setup → start → send WebChat message → get response
- [x] Verify session persistence across messages
- [x] Verify agent SOUL.md is applied

---

## Phase 2: Memory + MCP Servers

### 2.1 Memory MCP Server
- [x] MCP stdio server implementation (src/mcp/memory/server.ts)
- [x] memory_store tool (append to daily log or MEMORY.md)
- [x] memory_search tool (FTS5 search)
- [x] memory_get tool (read specific file)
- [x] memory_list tool (list memory files)
- [x] Daily log auto-creation (src/mcp/memory/daily-log.ts)
- [x] FTS5 indexing engine (src/mcp/memory/store.ts)
- [x] Chunk files at ~400 tokens with 80-token overlap
- [x] Test: store, search, get, list all work

### 2.2 Sessions MCP Server
- [x] MCP stdio server (src/mcp/sessions/server.ts)
- [x] sessions_list tool
- [x] sessions_spawn tool (spawn sub-agent)
- [x] sessions_send tool (send to other session)
- [x] session_status tool
- [x] agents_list tool
- [x] IPC communication with session manager
- [x] Test: list, spawn, send, status

### 2.3 Skills MCP Server
- [x] MCP stdio server (src/mcp/skills/server.ts)
- [x] skills_search tool (search npm registry)
- [x] skills_install tool (stage in pending/)
- [x] skills_create tool (create custom skill config)
- [x] skills_list tool
- [x] skills_remove tool
- [x] NPM registry search client (src/mcp/skills/registry.ts)
- [x] Test: search, install, create

### 2.4 Messaging MCP Server
- [x] MCP stdio server (src/mcp/messaging/server.ts)
- [x] send_message tool
- [x] send_typing tool
- [x] get_channel_info tool
- [x] IPC communication with channel adapters
- [x] Test: send message via mock channel

### 2.5 MCP Config Generation
- [x] Build dynamic mcp-config JSON per agent
- [x] Include enabled skills + 4 custom servers
- [x] Write to temp file for --mcp-config flag
- [x] Test: generated config is valid, all servers listed

### Phase 2 Integration Test
- [x] Agent can store and search memory
- [x] Agent can list other agents
- [x] Agent can request skill installation
- [x] Pending skill appears in approval queue
- [x] Approved skill loads on next session

---

## Phase 3: Proactive + RALPH

### 3.1 Heartbeat System
- [x] Heartbeat scheduler (src/cron/heartbeat.ts)
- [x] Configurable interval per agent
- [x] Active hours check (timezone-aware)
- [x] Read HEARTBEAT.md as checklist
- [x] Build heartbeat prompt
- [x] Suppress HEARTBEAT_OK responses
- [x] Deliver alerts to configured channel
- [x] Test: heartbeat fires on schedule, OK suppressed, alerts delivered

### 3.2 Cron Scheduler
- [x] Cron job manager (src/cron/scheduler.ts)
- [x] node-cron integration
- [x] CRUD via API + CLI
- [x] Persist jobs in SQLite
- [x] Survive gateway restarts
- [x] Per-job delivery channel
- [x] Test: job fires on schedule, persists across restart

### 3.3 RALPH Loop Engine
- [x] RALPH engine (src/engine/ralph.ts)
- [x] PLAN.md parser (markdown checkbox format)
- [x] progress.md reader/writer
- [x] Work prompt builder
- [x] Verification step (configurable command)
- [x] Task state machine: open → in_progress → done | blocked
- [x] Git commit on task completion
- [x] Retry logic with max retries
- [x] Fresh context per iteration
- [x] Exit conditions: all done, all blocked, max iterations
- [x] Test: parse plan, execute task, verify, commit, loop

### 3.4 CLI: work command
- [x] `clade work --agent <name> --plan <path>` (src/cli/commands/work.ts)
- [x] Progress display in terminal
- [x] Ctrl+C graceful shutdown
- [x] Test: CLI launches RALPH loop, shows progress

### Phase 3 Integration Test
- [x] Heartbeat fires and agent responds
- [x] Cron job triggers agent action
- [x] RALPH loop completes multi-task plan
- [x] Progress persists across interruptions

---

## Phase 4: Channel Adapters

### 4.1 Base Adapter Interface
- [x] ChannelAdapter interface (src/channels/base.ts)
- [x] InboundMessage type
- [x] Common adapter utilities

### 4.2 Telegram Adapter
- [x] Grammy bot setup (src/channels/telegram.ts)
- [x] Message handling (text, commands)
- [x] Threading support
- [x] Typing indicator
- [x] Error handling + reconnection
- [x] Test: mock bot, send/receive messages

### 4.3 Slack Adapter
- [x] Bolt SDK setup (src/channels/slack.ts)
- [x] Socket Mode connection
- [x] Message events + threading
- [x] Mention detection
- [x] Typing indicator
- [x] Error handling + reconnection
- [x] Test: mock Bolt, send/receive messages

### 4.4 Discord Adapter
- [x] discord.js setup (src/channels/discord.ts)
- [x] Message events
- [x] Channel/DM routing
- [x] Typing indicator
- [x] Error handling + reconnection
- [x] Test: mock client, send/receive messages

### 4.5 Router Enhancement
- [x] Per-channel routing rules
- [x] Per-user agent assignment
- [x] Group chat session isolation
- [x] Mention-based activation for groups
- [x] Test: routing rules applied correctly

### Phase 4 Integration Test
- [x] Telegram message → agent response → Telegram reply
- [x] Slack thread → agent response → threaded reply
- [x] Discord DM → agent response → DM reply
- [x] Multi-channel: same agent, different channels

---

## Phase 5: Admin Dashboard

### 5.1 UI Implementation
- [x] Self-contained HTML with Preact + HTM + Tailwind CDN (no build step)
- [x] Dark theme configuration
- [x] Layout: sidebar + main content
- [x] API client functions
- [x] WebSocket client for real-time updates

### 5.2 Dashboard Page
- [x] Agent status cards
- [x] Active sessions count
- [x] Recent activity feed
- [x] System health indicators

### 5.3 Agents Page
- [x] Agent sidebar list
- [x] Tabbed editor: Soul, Tools, Memory, Heartbeat
- [x] Soul tab: Markdown editor for SOUL.md
- [x] Tools tab: Toggle grid with presets
- [x] Memory tab: File browser + search
- [x] Heartbeat tab: Interval config + HEARTBEAT.md editor
- [x] Create/delete agent

### 5.4 Sessions Page
- [x] Active sessions list
- [x] Session detail viewer
- [x] Send message to session
- [x] Terminate session

### 5.5 Skills Page
- [x] Installed skills list
- [x] Pending approval queue with approve/reject
- [x] Skill detail viewer

### 5.6 Channels Page
- [x] Channel status (connected/disconnected)
- [x] Channel configuration forms

### 5.7 Cron Page
- [x] Cron jobs list
- [x] Create/edit/delete jobs
- [x] Cron expression builder

### 5.8 Config Page
- [x] Global settings editor

### 5.9 Build Integration
- [x] Gateway serves admin.html at /admin
- [x] No separate build step needed (CDN-loaded dependencies)

### Phase 5 Integration Test
- [x] Admin UI loads at http://localhost:7890/admin
- [x] All 7 pages render with navigation
- [x] API endpoints wired for CRUD operations

---

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript (tsc --noEmit) | 0 errors |
| Unit Tests (vitest) | 186/186 passing |
| Build (tsup) | 6 entry points, success |
| Source Files | 39 TypeScript files |
| Test Files | 10 test suites |
| Lines of Code | ~13,000 |

---

## Post-Launch

### Documentation
- [ ] README.md with quickstart guide
- [ ] Setup guide for each channel
- [ ] Skill development guide
- [ ] RALPH loop guide

### Polish
- [ ] Error messages are helpful and actionable
- [ ] Graceful shutdown (SIGINT/SIGTERM)
- [ ] Log rotation
- [ ] npm publish preparation

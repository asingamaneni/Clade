# Clade - Claude Code Native AI Agent Platform

## Project Overview

Clade is an autonomous multi-agent platform built natively on top of the `claude` CLI.
It uses Claude Code Max subscriptions (not the API SDK) to power agents that can be triggered
reactively (Slack/Telegram/Discord messages), proactively (heartbeat/cron), or autonomously
(RALPH loop for continuous autonomous work — any domain, not just coding).

The name "Clade" (from Claude) means "a group of organisms that share a common ancestor" —
agents evolving from a common AI foundation, specializing over time.

## Related Documentation

- **[architecture.md](./architecture.md)** — Full system architecture, data flows, SQL schema
- **[README.md](./README.md)** — User-facing quickstart and installation guide
- **[docs/](./docs/)** — VitePress documentation site (run `clade docs --serve` to view)
- **[tasks.md](./tasks.md)** — Implementation task tracker

> **Important**: When making changes to features, architecture, CLI commands, config schema,
> or any user-facing behavior, update **all three** of these files as needed:
> - **CLAUDE.md** — Keep the architecture summary, directory structure, and design decisions current
> - **architecture.md** — Update system diagrams, component docs, data flows, and SQL schema
> - **README.md** — Update the user-facing quickstart, CLI reference, and feature descriptions
>
> These files must stay in sync. A change to one usually means the others need updating too.

## Architecture Summary

- **Engine**: Spawns `claude -p` subprocesses with `--output-format stream-json`
- **Compatibility**: Detects CLI version and adapts flags automatically (`src/engine/compat.ts`)
- **Sessions**: Persistent via `--resume <session_id>`, stored in SQLite
- **MCP**: npm-packaged MCP servers injected via `--mcp-config`
- **Memory**: Two-layer (daily logs + curated MEMORY.md) with FTS5 search
- **Identity**: SOUL.md per agent, injected via `--append-system-prompt`
- **Self-Improvement**: Reflection cycle evolves SOUL.md based on user interactions
- **Collaboration**: Delegation, shared memory, pub/sub message bus between agents
- **Portability**: Export/import agents as `.agent.tar.gz` bundles
- **Platform**: Native OS interaction (notifications, clipboard, screenshots) via platform MCP
- **Routing**: @mention-based agent routing (`@jarvis do this` routes to jarvis agent)
- **Chat**: Multi-conversation tabs per agent, auto-migrating from legacy flat format
- **Tools**: Claude Code's native tools (Read/Edit/Bash/Glob/Grep) + 6 custom MCP servers
- **Skills**: SKILL.md instruction files (reusable procedures) with install/approve/assign lifecycle
- **Context**: USER.md (global preferences) and TOOLS.md (per-agent env notes) injected into prompts
- **Mission Control**: Activity feed, calendar, and global search across all agent data
- **Admin**: Orchestrator agents can autonomously discover, install, and create skills/MCP servers/plugins
- **Browser**: Optional Playwright MCP for browser automation with persistent profile

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript (strict mode)
- **Build**: tsup (esbuild-based bundler)
- **CLI**: Commander.js
- **HTTP/WS Server**: Fastify + @fastify/websocket
- **Database**: better-sqlite3 (synchronous, zero setup)
- **Validation**: Zod schemas for all config/types
- **Testing**: Vitest (17 test suites, 426+ tests)
- **Docs**: VitePress (locally servable, 22 pages)
- **Admin UI**: React 18 + Radix UI + Tailwind CSS + Vite (14-page SPA in `ui/`)
- **Channels**: grammy (Telegram), @slack/bolt (Slack), discord.js (Discord)

## Directory Structure

```
src/
├── cli/           # CLI commands (start, setup, agent, skill, work, ask, doctor, ui, docs)
├── engine/        # Core: claude-cli.ts wrapper, session manager, RALPH loop, compat layer
├── agents/        # Agent registry, presets, types, templates, reflection, collaboration, portability
├── gateway/       # Fastify HTTP + WS server, REST API routes
├── router/        # Message routing (channel+user → agent session)
├── channels/      # Channel adapters (telegram, slack, discord, webchat)
├── mcp/           # 6 custom MCP servers (memory, sessions, messaging, skills, platform, admin)
├── cron/          # Heartbeat + cron scheduler
├── config/        # Zod config schema, loader, defaults, migrations
├── store/         # SQLite persistence layer
└── utils/         # Logger, errors, helpers
```

## Key Design Decisions

1. **Claude CLI over SDK**: Uses `claude -p --output-format stream-json` subprocess spawning
   instead of the Agent SDK. This uses the user's Max subscription (flat rate, TOS-compliant)
   instead of per-token API billing.

2. **`--append-system-prompt` over `--system-prompt`**: Preserves Claude Code's native tools
   and capabilities while layering agent personality on top. Never replaces the default prompt.

3. **`--allowedTools` for per-agent restrictions**: Each agent's tool access is controlled by
   passing explicit tool lists. Presets (potato/coding/messaging/full) map to allowedTools arrays.

4. **Standard Claude Code terminology**: Clade aligns with Claude Code's naming conventions.
   Skills = SKILL.md instruction files (slash commands, project-specific knowledge).
   MCP = npm-packaged MCP servers installed and injected via `--mcp-config`.
   Plugins = exportable bundles. Standard MCP protocol — any MCP-compatible server works.

5. **Memory as files**: MEMORY.md and memory/YYYY-MM-DD.md are plain markdown files.
   Indexed with SQLite FTS5 for search. Human-auditable, version-controllable.

6. **Config is read-only from agents**: Agents cannot modify their own config (prevents the
   self-mutation crash loops that plague OpenClaw).

7. **No pre-defined agents**: Users create their own agents from templates (orchestrator,
   coding, research, ops, pm) or from scratch. Templates provide starting SOUL.md content
   that evolves via the reflection cycle.

8. **Agents are proactive by default**: Heartbeat is enabled by default. Agents observe,
   anticipate, and act — they don't wait for instructions.

9. **SOUL.md self-improvement**: Agents reflect on recent interactions and evolve their
   personality. Core Principles section is locked (immutable). History is preserved in
   `soul-history/YYYY-MM-DD.md` snapshots.

10. **Agent portability**: Agents can be exported as `.agent.tar.gz` bundles and imported
    on another machine, preserving identity, soul, memory, and config.

11. **CLI compatibility layer**: Detects installed Claude CLI version and available flags.
    Adapts arguments automatically. Supports exporting agents as Claude Code plugins.

12. **Config versioning**: Schema version in config.json with additive-only migrations.
    `npm update` never touches agent state.

13. **Multi-conversation chat model**: Each agent supports multiple conversations (tabs)
    stored in `~/.clade/data/chats/{agentId}.json` as an `AgentChatData` object containing
    a `conversations` map and `order` array. Old flat `ChatMessage[]` format is auto-migrated
    on first load. Sessions page derives real session data from active conversations.

14. **Admin MCP for orchestrators**: Agents with `admin.enabled: true` get the admin MCP
    server which provides autonomous skill and MCP management: search (local, GitHub, npm, web),
    install (from any source), create (from scratch or templates), and manage MCP servers
    and plugins. Orchestrators can discover and install capabilities on demand.

15. **UI components — search before building**: Before creating custom UI components, search
    online for pre-built options (npm packages, shadcn blocks, community components). Evaluate
    whether they can be used standalone without adopting a full framework. If tightly coupled
    to an SDK (e.g., Vercel AI SDK, assistant-ui runtime), build custom using existing
    primitives (Radix UI, Lucide icons, Tailwind) instead.

## Common Tasks

### Adding a new CLI command
1. Create `src/cli/commands/<name>.ts`
2. Export a function that takes a Commander `Command` object
3. Register in `src/cli/index.ts`

### Adding a new channel adapter
1. Create `src/channels/<name>.ts`
2. Implement the `ChannelAdapter` interface from `src/channels/base.ts`
3. Register in the channel loader in `src/gateway/server.ts`

### Adding a new MCP tool
1. Find the relevant MCP server in `src/mcp/<server>/server.ts`
2. Add the tool definition to the `tools` array
3. Add the handler in the `handleToolCall` function
4. Update tests

### Adding an agent template
1. Define the template in `src/agents/templates.ts`
2. Add it to the `TEMPLATES` map
3. Include soulSeed, heartbeatSeed, and default config

### Running tests
```bash
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests (requires claude CLI)
```

### Building
```bash
npm run build               # Build TypeScript + bundle UI
npm run dev                 # Development mode with watch
```

### Manual UI testing
After any change to `admin.html` or server endpoints that affect the admin UI, **always**
test with Playwright MCP (browser automation):
1. Start the server: `node dist/bin/clade.js start` (background)
2. Navigate to `http://localhost:7890/admin` via Playwright
3. Verify the affected flows visually (take snapshots/screenshots)
4. Stop the server when done

This is not optional — UI changes must be verified in a real browser before considering
the task complete.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | If Telegram enabled | Telegram Bot API token |
| `SLACK_BOT_TOKEN` | If Slack enabled | Slack Bot OAuth token |
| `SLACK_APP_TOKEN` | If Slack enabled | Slack App-level token (Socket Mode) |
| `DISCORD_BOT_TOKEN` | If Discord enabled | Discord bot token |
| `CLADE_HOME` | No | Override config directory (default: `~/.clade`) |

## Config Location

`~/.clade/config.json` - Global configuration (Zod-validated on load, versioned with migrations)

## Important Constraints

- **NEVER delete `~/.clade` or any agent data without explicit user permission.** This directory
  contains irreplaceable agent state (souls, memories, conversations, config). Even for testing,
  always ask the user before removing or overwriting any data in `~/.clade`.
- Never use `--system-prompt` (replaces Claude Code defaults). Always use `--append-system-prompt`.
- Agent SOUL.md files are injected via CLI flag, NOT placed in workspace (prevents agent self-modification).
- MCP servers requested by agents go to pending/ and require human approval.
- Heartbeat and cron use separate prompt pipelines - never mix them.
- Each agent session is an isolated `claude` subprocess with its own `--model`, `--allowedTools`, and `--mcp-config`.
- SOUL.md Core Principles section is immutable — the reflection cycle cannot modify it.
- Agent state in `~/.clade/agents/` is never touched by `npm update`.

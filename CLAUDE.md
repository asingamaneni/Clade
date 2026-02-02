# TeamAgents - Claude Code Native AI Agent Platform

## Project Overview

TeamAgents is an autonomous multi-agent platform built natively on top of the `claude` CLI.
It uses Claude Code Max subscriptions (not the API SDK) to power agents that can be triggered
reactively (Slack/Telegram/Discord messages), proactively (heartbeat/cron), or autonomously
(RALPH loop for continuous coding work).

## Architecture Summary

- **Engine**: Spawns `claude -p` subprocesses with `--output-format stream-json`
- **Sessions**: Persistent via `--resume <session_id>`, stored in SQLite
- **Skills**: Standard MCP servers injected via `--mcp-config`
- **Memory**: Two-layer (daily logs + curated MEMORY.md) with FTS5 search
- **Identity**: SOUL.md per agent, injected via `--append-system-prompt`
- **Tools**: Claude Code's native tools (Read/Edit/Bash/Glob/Grep) + 4 custom MCP servers

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript (strict mode)
- **Build**: tsup (esbuild-based bundler)
- **CLI**: Commander.js
- **HTTP/WS Server**: Fastify + @fastify/websocket
- **Database**: better-sqlite3 (synchronous, zero setup)
- **Validation**: Zod schemas for all config/types
- **Testing**: Vitest
- **Admin UI**: React 18 + Tailwind CSS + Vite (bundled into npm package)
- **Channels**: grammy (Telegram), @slack/bolt (Slack), discord.js (Discord)

## Directory Structure

```
src/
├── cli/           # CLI commands (start, setup, agent, skill, work, ask, doctor)
├── engine/        # Core: claude-cli.ts wrapper, session manager, RALPH loop
├── agents/        # Agent registry, presets, types
├── gateway/       # Fastify HTTP + WS server, REST API routes
├── router/        # Message routing (channel+user → agent session)
├── channels/      # Channel adapters (telegram, slack, discord, webchat)
├── mcp/           # 4 custom MCP servers (memory, sessions, messaging, skills)
├── cron/          # Heartbeat + cron scheduler
├── config/        # Zod config schema, loader, defaults
├── store/         # SQLite persistence layer
└── utils/         # Logger, errors, helpers
ui/                # Admin dashboard (React + Tailwind)
```

## Key Design Decisions

1. **Claude CLI over SDK**: Uses `claude -p --output-format stream-json` subprocess spawning
   instead of the Agent SDK. This uses the user's Max subscription (flat rate, TOS-compliant)
   instead of per-token API billing.

2. **`--append-system-prompt` over `--system-prompt`**: Preserves Claude Code's native tools
   and capabilities while layering agent personality on top. Never replaces the default prompt.

3. **`--allowedTools` for per-agent restrictions**: Each agent's tool access is controlled by
   passing explicit tool lists. Presets (potato/coding/messaging/full) map to allowedTools arrays.

4. **Skills = MCP servers**: No proprietary skill format. Skills are standard MCP servers that
   work with any MCP-compatible client. Discovered via npm registry.

5. **Memory as files**: MEMORY.md and memory/YYYY-MM-DD.md are plain markdown files.
   Indexed with SQLite FTS5 for search. Human-auditable, version-controllable.

6. **Config is read-only from agents**: Agents cannot modify their own config (prevents the
   self-mutation crash loops that plague OpenClaw).

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | If Telegram enabled | Telegram Bot API token |
| `SLACK_BOT_TOKEN` | If Slack enabled | Slack Bot OAuth token |
| `SLACK_APP_TOKEN` | If Slack enabled | Slack App-level token (Socket Mode) |
| `DISCORD_BOT_TOKEN` | If Discord enabled | Discord bot token |

## Config Location

`~/.teamagents/config.json` - Global configuration (Zod-validated on load)

## Important Constraints

- Never use `--system-prompt` (replaces Claude Code defaults). Always use `--append-system-prompt`.
- Agent SOUL.md files are injected via CLI flag, NOT placed in workspace (prevents agent self-modification).
- Skills requested by agents go to pending/ and require human approval.
- Heartbeat and cron use separate prompt pipelines - never mix them.
- Each agent session is an isolated `claude` subprocess with its own `--model`, `--allowedTools`, and `--mcp-config`.

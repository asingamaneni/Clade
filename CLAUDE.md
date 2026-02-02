# Clade - Claude Code Native AI Agent Platform

## Project Overview

Clade is an autonomous multi-agent platform built natively on top of the `claude` CLI.
It uses Claude Code Max subscriptions (not the API SDK) to power agents that can be triggered
reactively (Slack/Telegram/Discord messages), proactively (heartbeat/cron), or autonomously
(RALPH loop for continuous coding work).

The name "Clade" (from Claude) means "a group of organisms that share a common ancestor" —
agents evolving from a common AI foundation, specializing over time.

## Architecture Summary

- **Engine**: Spawns `claude -p` subprocesses with `--output-format stream-json`
- **Compatibility**: Detects CLI version and adapts flags automatically (`src/engine/compat.ts`)
- **Sessions**: Persistent via `--resume <session_id>`, stored in SQLite
- **Skills**: Standard MCP servers injected via `--mcp-config`
- **Memory**: Two-layer (daily logs + curated MEMORY.md) with FTS5 search
- **Identity**: SOUL.md per agent, injected via `--append-system-prompt`
- **Self-Improvement**: Reflection cycle evolves SOUL.md based on user interactions
- **Collaboration**: Delegation, shared memory, pub/sub message bus between agents
- **Portability**: Export/import agents as `.agent.tar.gz` bundles
- **Tools**: Claude Code's native tools (Read/Edit/Bash/Glob/Grep) + 4 custom MCP servers

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript (strict mode)
- **Build**: tsup (esbuild-based bundler)
- **CLI**: Commander.js
- **HTTP/WS Server**: Fastify + @fastify/websocket
- **Database**: better-sqlite3 (synchronous, zero setup)
- **Validation**: Zod schemas for all config/types
- **Testing**: Vitest (14 test files, 308+ tests)
- **Admin UI**: Preact + HTM + Tailwind CSS (self-contained HTML, no build step)
- **Channels**: grammy (Telegram), @slack/bolt (Slack), discord.js (Discord)

## Directory Structure

```
src/
├── cli/           # CLI commands (start, setup, agent, skill, work, ask, doctor)
├── engine/        # Core: claude-cli.ts wrapper, session manager, RALPH loop, compat layer
├── agents/        # Agent registry, presets, types, templates, reflection, collaboration, portability
├── gateway/       # Fastify HTTP + WS server, REST API routes, admin.html
├── router/        # Message routing (channel+user → agent session)
├── channels/      # Channel adapters (telegram, slack, discord, webchat)
├── mcp/           # 4 custom MCP servers (memory, sessions, messaging, skills)
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

4. **Skills = MCP servers**: No proprietary skill format. Skills are standard MCP servers that
   work with any MCP-compatible client. Discovered via npm registry.

5. **Memory as files**: MEMORY.md and memory/YYYY-MM-DD.md are plain markdown files.
   Indexed with SQLite FTS5 for search. Human-auditable, version-controllable.

6. **Config is read-only from agents**: Agents cannot modify their own config (prevents the
   self-mutation crash loops that plague OpenClaw).

7. **No pre-defined agents**: Users create their own agents from templates (coding, research,
   ops, pm) or from scratch. Templates provide starting SOUL.md content that evolves via
   the reflection cycle.

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

- Never use `--system-prompt` (replaces Claude Code defaults). Always use `--append-system-prompt`.
- Agent SOUL.md files are injected via CLI flag, NOT placed in workspace (prevents agent self-modification).
- Skills requested by agents go to pending/ and require human approval.
- Heartbeat and cron use separate prompt pipelines - never mix them.
- Each agent session is an isolated `claude` subprocess with its own `--model`, `--allowedTools`, and `--mcp-config`.
- SOUL.md Core Principles section is immutable — the reflection cycle cannot modify it.
- Agent state in `~/.clade/agents/` is never touched by `npm update`.

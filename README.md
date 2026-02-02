# Clade

**Your personal team of AI agents, powered by Claude Code.**

Clade is an autonomous multi-agent platform built natively on top of the `claude` CLI. It uses your existing Claude Code Max subscription — no API keys, no per-token billing. Your agents observe, learn, anticipate, and act.

The name "Clade" means *a group of organisms that share a common ancestor* — agents evolving from a common AI foundation, specializing over time.

## What It Does

- **Multi-agent orchestration** — Create specialized agents (coding, research, ops, project management) that each have their own personality, memory, and tools
- **Proactive, not reactive** — Agents wake up on a configurable heartbeat, check for issues, and act before you ask
- **Multi-channel** — Talk to your agents via Slack, Telegram, Discord, or the built-in web chat
- **Persistent memory** — Agents remember across conversations with a two-layer memory system (daily logs + curated knowledge) and full-text search
- **Autonomous work loops** — RALPH loop: give an agent a task list, it works through each task, verifies its work, and reports back
- **Self-improving** — Agents reflect on interactions and evolve their SOUL.md personality over time (core principles stay locked)
- **Native platform integration** — Agents can send system notifications, read your clipboard, open URLs, take screenshots
- **Admin dashboard** — Web UI at `localhost:7890/admin` for managing agents, sessions, skills, and configuration

## Quick Start

```bash
# Install
npm install -g clade

# Start the gateway — auto-creates config if first run
clade start

# Open the admin dashboard in your browser
clade ui

# Browse the documentation
clade docs --serve
```

That's it. Three commands to a running dashboard. No setup wizard required.

### Adding Agents

```bash
# Interactive setup (configure channels, create agents)
clade setup

# Or create agents directly
clade agent create --name jarvis --template coding
clade agent create --name ravi --template research

# Quick one-off question
clade ask --agent jarvis "What's the status of the tests?"

# Give an agent autonomous work
clade work --agent ravi --plan ./PLAN.md
```

## How It Works

Clade doesn't reimplement an LLM runtime. It spawns `claude -p` subprocesses with carefully constructed flags:

```
claude -p "your message"
  --output-format stream-json      # Structured output for parsing
  --resume <session_id>            # Conversation continuity
  --append-system-prompt <SOUL.md> # Agent personality (preserves Claude Code defaults)
  --allowedTools "Read,Edit,..."   # Per-agent tool restrictions
  --mcp-config <path>              # Skills (MCP servers)
  --max-turns 25                   # Autonomous iteration limit
  --model sonnet                   # Agent-specific model
```

This means your agents have access to all of Claude Code's native capabilities — file editing, bash execution, web search, code analysis — plus custom skills via MCP.

## Agent Templates

No agents ship pre-built. You create your own from templates:

| Template | Focus | Default Heartbeat |
|----------|-------|-------------------|
| `coding` | Code quality, testing, codebase ownership | Every 30 minutes |
| `research` | Information gathering, source verification | Every 4 hours |
| `ops` | System monitoring, incident response | Every 15 minutes |
| `pm` | Task tracking, coordination, status reports | Every hour |

```bash
clade agent create --name researcher --template research
clade agent create --name coder --template coding
```

Each template provides a starting SOUL.md personality that evolves through the reflection cycle as the agent learns your preferences.

## Agent Self-Improvement

Agents improve over time through a reflection cycle:

1. After every ~10 sessions, the agent reviews recent interactions
2. It identifies patterns: your communication style, preferences, workflow
3. It updates its own SOUL.md with refined behavioral guidelines
4. **Core Principles are locked** — the agent's foundation never changes
5. Previous versions are saved to `soul-history/` for rollback

## RALPH Loop — Autonomous Work

RALPH (Read-Assess-Learn-Plan-Handle) works for any agent type, not just coding:

```bash
# Create a plan
cat > PLAN.md << 'EOF'
- [ ] Research competitor pricing models
- [ ] Summarize findings in a report
- [ ] Draft recommendations for our pricing strategy
EOF

# Let the research agent work through it
clade work --agent researcher --plan ./PLAN.md
```

The agent picks up each task, works on it, verifies completion, and moves to the next. Progress is tracked in `progress.md`. For coding agents, each completed task auto-commits to git.

## Agent Portability

Take your agents anywhere:

```bash
# Export an agent (identity, soul, memory, config)
clade agent export researcher

# Import on another machine
clade agent import researcher.agent.tar.gz
```

The entire agent directory is plain markdown — you can also sync it via git.

## Channels

### Slack
```bash
# Set environment variables
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...

# Enable during setup, or edit config
clade start
```

### Telegram
```bash
export TELEGRAM_BOT_TOKEN=...
clade start
```

### Discord
```bash
export DISCORD_BOT_TOKEN=...
clade start
```

### Web Chat
Enabled by default at `http://localhost:7890/admin` — no setup needed.

### @mention Routing

With multiple agents, route messages by mentioning them by name:

```
@jarvis deploy the staging branch
@ravi research competitor pricing
@manu review the auth PR
```

Mentions are case-insensitive and work on all channels. If no agent is mentioned, the message goes to the default agent or follows your routing rules.

## Agent Collaboration

Agents can work together:

- **Delegation** — One agent formally hands off a task to another
- **Shared memory** — Agents can read (not write) each other's memory
- **Message bus** — Pub/sub topics for loose coupling between agents
- **Status updates** — Agents proactively notify you on your preferred channel

## CLI Reference

| Command | Description |
|---------|-------------|
| `clade start` | Start the gateway (auto-creates config on first run) |
| `clade setup` | Interactive setup wizard (channels, agents) |
| `clade ui` | Open admin dashboard in your browser |
| `clade docs --serve` | Start local documentation site |
| `clade ask "..."` | Quick one-off question to an agent |
| `clade agent create` | Create a new agent from template |
| `clade agent list` | List all agents |
| `clade agent export <name>` | Export agent as portable bundle |
| `clade agent import <file>` | Import agent from bundle |
| `clade work --agent <name> --plan <path>` | Start RALPH autonomous loop |
| `clade skill list` | List installed skills |
| `clade skill approve <name>` | Approve a pending skill |
| `clade doctor` | Health check |

## Configuration

Config lives at `~/.clade/config.json` (override with `CLADE_HOME` env var).

Agent state lives at `~/.clade/agents/<name>/` — plain markdown files that are never touched by `npm update`.

## Architecture

See [architecture.md](./architecture.md) for the full system architecture, data flow diagrams, SQL schema, and security model.

## Development

```bash
git clone https://github.com/asingamaneni/Clade.git
cd Clade
npm install
npm run build    # Build TypeScript
npm test         # Run all tests
npm run dev      # Development mode with watch
```

### Make Targets

A `Makefile` is provided for common tasks:

| Target | Description |
|--------|-------------|
| `make install` | Install dependencies |
| `make build` | Build TypeScript (tsup) |
| `make dev` | Start dev mode with watch |
| `make test` | Run all tests |
| `make test-unit` | Run unit tests only |
| `make test-integration` | Run integration tests only |
| `make lint` | Type-check with `tsc --noEmit` |
| `make start` | Build and start the gateway |
| `make docs` | Start local docs dev server (VitePress) |
| `make docs-build` | Build docs for production |
| `make docs-preview` | Build and preview docs locally |
| `make check` | Full CI gate — lint + build + tests |
| `make deploy-docs` | Build docs for GitHub Pages |
| `make clean` | Remove build artifacts |

Run `make` or `make help` to see all available targets.

## Requirements

- **Node.js 20+**
- **Claude CLI** installed and authenticated (`claude --version`)
- **Claude Code Max subscription** (any tier)

## License

MIT

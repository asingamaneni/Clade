# Getting Started

## Prerequisites

- **Node.js 20+**
- **Claude CLI** installed and authenticated (`claude --version`)
- **Claude Code Max subscription** (any tier)

## Installation

```bash
npm install -g clade
```

## Setup

Run the interactive setup wizard:

```bash
clade setup
```

This creates your configuration at `~/.clade/config.json` and sets up the data directory.

## Create Your First Agent

```bash
# Create from a template
clade agent create --name jarvis --template coding

# Or create interactively
clade agent create
```

Available templates:

| Template | Focus | Default Heartbeat |
|----------|-------|-------------------|
| `coding` | Code quality, testing, codebase ownership | Every 30 minutes |
| `research` | Information gathering, source verification | Every 4 hours |
| `ops` | System monitoring, incident response | Every 15 minutes |
| `pm` | Task tracking, coordination, status reports | Every hour |

Each template provides a starting SOUL.md personality that evolves as the agent learns your preferences.

## Start the Gateway

```bash
clade start
```

This starts:
- The HTTP/WebSocket gateway on `http://localhost:7890`
- The admin dashboard at `http://localhost:7890/admin`
- Channel adapters (Slack, Telegram, Discord) if configured
- Heartbeat scheduler for all agents

## Quick Interactions

```bash
# Ask a one-off question
clade ask "What's the status of the project?"

# Ask a specific agent
clade ask --agent researcher "What are the latest trends in AI agents?"

# Open the admin dashboard
clade ui

# Start autonomous work
clade work --agent coder --plan ./PLAN.md
```

## Talk via Channels

Once the gateway is running, message your agents on Slack, Telegram, or Discord. Use @mentions to address specific agents:

```
@jarvis fix the failing tests in the auth module
@researcher what are the latest papers on multi-agent systems?
```

If no agent is mentioned, messages route to the default agent.

## What's Next

- [How It Works](/guide/how-it-works) — Understand the architecture
- [Agents](/guide/agents) — Deep dive into agent configuration
- [Channels](/guide/channels) — Set up Slack, Telegram, Discord
- [RALPH](/guide/ralph) — Autonomous work loops
- [Configuration](/reference/config) — Full config reference

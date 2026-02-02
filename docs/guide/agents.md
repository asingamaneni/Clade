# Agents

No agents ship pre-built with Clade. You create your own from templates or from scratch.

## Creating Agents

```bash
# From a template
clade agent create --name coder --template coding
clade agent create --name researcher --template research

# Interactively
clade agent create
```

## Templates

| Template | Focus | Heartbeat | Tool Preset |
|----------|-------|-----------|-------------|
| `coding` | Code quality, testing, codebase ownership | 30m | `coding` |
| `research` | Information gathering, source verification | 4h | `full` |
| `ops` | System monitoring, incident response | 15m | `full` |
| `pm` | Task tracking, coordination, delegation | 1h | `messaging` |

Each template provides:
- **soulSeed** — Starting SOUL.md personality
- **heartbeatSeed** — Starting HEARTBEAT.md checklist
- **Default config** — Heartbeat interval, tool preset, model

## Agent Directory

Each agent lives at `~/.clade/agents/<name>/`:

```
~/.clade/agents/jarvis/
├── SOUL.md           # Personality and behavioral guidelines
├── IDENTITY.md       # Metadata: name, description, creation date
├── HEARTBEAT.md      # Heartbeat checklist
├── MEMORY.md         # Curated long-term memory
├── memory/           # Daily logs (YYYY-MM-DD.md)
├── soul-history/     # SOUL.md snapshots before each reflection
├── PLAN.md           # (optional) RALPH task list
└── progress.md       # (optional) RALPH accumulated learnings
```

All agent state is plain markdown — human-readable, version-controllable, and never touched by `npm update`.

## Tool Presets

Each agent has a tool preset that controls what Claude Code tools it can access:

| Preset | Tools Available |
|--------|----------------|
| `potato` | No tools — pure chat |
| `coding` | Read, Edit, Write, Bash, Glob, Grep + memory/sessions MCP |
| `messaging` | Memory, sessions, and messaging MCP only |
| `full` | All Claude Code tools + all MCP tools |
| `custom` | Explicitly listed in `customTools` array |

## Agent Config

Each agent is configured in `~/.clade/config.json`:

```json
{
  "agents": {
    "jarvis": {
      "name": "Jarvis",
      "description": "Personal coding assistant",
      "model": "sonnet",
      "toolPreset": "full",
      "heartbeat": {
        "enabled": true,
        "interval": "30m",
        "mode": "check",
        "suppressOk": true
      },
      "reflection": {
        "enabled": true,
        "interval": 10
      },
      "notifications": {
        "preferredChannel": "slack:#updates",
        "minSeverity": "info"
      }
    }
  }
}
```

## Managing Agents

```bash
# List all agents
clade agent list

# Export an agent (identity, soul, memory, config)
clade agent export jarvis

# Import on another machine
clade agent import jarvis.agent.tar.gz
```

## Self-Improvement

Agents improve through a reflection cycle. See [SOUL.md & Self-Improvement](/concepts/soul) for details.

# Memory System

Clade uses a two-layer memory system that gives agents persistent knowledge across conversations.

## Two Layers

### Layer 1: Daily Logs

Every day, agent interactions are logged to `memory/YYYY-MM-DD.md`:

```
~/.clade/agents/jarvis/memory/
├── 2025-01-28.md
├── 2025-01-29.md
└── 2025-01-30.md
```

These are append-only daily records of what the agent learned, did, and observed.

### Layer 2: Curated Memory

`MEMORY.md` is the agent's curated long-term knowledge — distilled from daily logs, organized by the agent itself:

```markdown
# Project Knowledge
- Main repo is TypeScript, uses Vitest for tests
- CI runs on GitHub Actions, deploy via Vercel
- Auth uses JWT with refresh tokens

# User Preferences
- Prefers functional style over classes
- Wants all PRs to include test updates
- Timezone: America/New_York
```

## Full-Text Search

Memory is indexed with SQLite FTS5 for fast search. The Memory MCP server provides:

| Tool | Description |
|------|-------------|
| `memory_store` | Write a new memory entry |
| `memory_search` | Full-text search across all memory |
| `memory_get` | Read a specific memory file |
| `memory_list` | List all memory files |

Files are chunked at ~400 tokens with 80-token overlap for accurate search results.

## How Agents Use Memory

Agents automatically:
- **Store** important facts from conversations
- **Search** memory when answering questions (looking for prior context)
- **Reference** daily logs during the reflection cycle

You don't need to tell agents to remember things — it's built into their default behavior via the Memory MCP server.

## Memory Isolation

Each agent has its own memory namespace. By default, agents cannot read each other's memory. This prevents prompt injection via shared memory.

Through the [collaboration system](/guide/collaboration), agents can explicitly grant read-only access to their MEMORY.md for cross-agent information sharing.

## Human-Auditable

All memory is plain markdown. You can:
- Read any agent's memory files directly
- Edit or correct stored information
- Delete entries the agent shouldn't retain
- Version-control memory with git

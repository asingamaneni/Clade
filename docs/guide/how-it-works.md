# How It Works

Clade doesn't reimplement an LLM runtime. It spawns `claude -p` subprocesses with carefully constructed flags, giving your agents access to all of Claude Code's native capabilities.

## The Core Idea

Each agent session is an isolated `claude` CLI process:

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

This means your agents have access to all of Claude Code's native tools — file editing, bash execution, web search, code analysis — plus custom skills via MCP.

## Why Claude CLI, Not the SDK?

| | Claude CLI | Agent SDK |
|---|---|---|
| **Billing** | Flat rate (Max subscription) | Per-token API billing |
| **Tools** | Full Claude Code toolset (Read, Edit, Bash, etc.) | Must implement each tool |
| **Sessions** | Built-in `--resume` | Must build session management |
| **Auth** | Already authenticated | API key management |
| **TOS** | Uses existing subscription | Separate API agreement |

## Message Flow

When a message arrives from any channel:

```
1. Channel adapter receives message
   │
2. Router determines target agent
   │  Priority: @mention → routing rules → user mapping → default
   │
3. Session manager finds or creates a session
   │
4. Engine spawns: claude -p "message" --resume <session_id> ...
   │
5. Stream-JSON output is parsed in real-time
   │  → Typing indicators sent during processing
   │
6. Response delivered back through the channel
```

## Key Components

- **Engine** — Wraps the `claude` CLI, manages subprocess lifecycle
- **Router** — Maps messages to agents (supports @mentions)
- **Session Manager** — Persistent sessions via `--resume`, stored in SQLite
- **MCP Servers** — Five custom servers for memory, sessions, messaging, skills, platform
- **Scheduler** — Heartbeat intervals and cron jobs for proactive agents
- **Gateway** — Fastify HTTP/WS server, REST API, admin dashboard

See [Architecture](/concepts/architecture) for the full system diagram and data flows.

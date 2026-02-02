# Security Model

Clade is designed with defense-in-depth. Each layer limits what agents can do.

## Principles

### 1. SOUL.md Is Read-Only

Agent personality is injected via `--append-system-prompt`, not as a workspace file. Agents cannot modify their own SOUL.md. The reflection cycle runs as a separate process with controlled write access.

### 2. Config Is Read-Only

`~/.clade/config.json` is never in the agent's workspace. Agents can read their own config via the Skills MCP server (read-only). They cannot change their tool permissions, model, or heartbeat settings.

### 3. Skill Approval Gate

Skills requested by agents go to `~/.clade/skills/pending/` and require human approval before activation. This prevents agents from installing arbitrary MCP servers.

```bash
clade skill list        # See pending and active skills
clade skill approve X   # Approve after review
```

### 4. Per-Agent Tool Restrictions

Each agent's tools are controlled via `--allowedTools` at the Claude CLI level. An agent with the `messaging` preset cannot use Bash or Edit. Presets:

| Preset | Can Do |
|--------|--------|
| `potato` | Chat only — no file access, no commands |
| `coding` | Read, Edit, Write, Bash, Glob, Grep |
| `messaging` | Memory and messaging MCP only |
| `full` | Everything |

### 5. Session Isolation

Each agent session is a separate OS process. No shared memory between concurrent sessions. A compromised session cannot affect other agents.

### 6. Memory Isolation

Each agent has its own memory namespace at `~/.clade/agents/<name>/memory/`. Cross-agent memory access requires explicit collaboration setup (read-only).

## What Agents Cannot Do

- Modify their own SOUL.md or Core Principles
- Change their config or tool permissions
- Install skills without human approval
- Access other agents' memory (without explicit sharing)
- Push to git without committing through the RALPH loop
- Modify the Clade source code or `node_modules`

## Recommendations

- **Review agent SOUL.md** periodically — check `soul-history/` for unexpected changes
- **Use restrictive presets** — Give agents only the tools they need
- **Monitor the pending skills queue** — Don't auto-approve blindly
- **Set up quiet hours** — Prevent agents from acting during off-hours
- **Keep `CLADE_HOME` outside your code repos** — Default `~/.clade` is good

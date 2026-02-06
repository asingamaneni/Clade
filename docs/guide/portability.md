# Agent Portability

Agents can be moved between machines as portable bundles. Their identity, personality, memory, and configuration all travel together.

## Export

```bash
clade agent export researcher
# Creates: researcher.agent.tar.gz
```

The bundle includes:
- `SOUL.md` — Agent personality
- `IDENTITY.md` — Agent metadata
- `HEARTBEAT.md` — Heartbeat checklist
- `MEMORY.md` — Curated long-term memory
- `memory/` — All daily memory logs
- `soul-history/` — SOUL.md evolution history
- `manifest.json` — Agent config and metadata

## Import

```bash
clade agent import researcher.agent.tar.gz
```

Import:
1. Unpacks the bundle
2. Validates the manifest
3. Writes agent files to `~/.clade/agents/<name>/`
4. Reindexes memory for full-text search
5. Registers the agent in config

## Git-Friendly

The entire agent directory is plain markdown files. You can also sync agents via git:

```bash
cd ~/.clade/agents/jarvis
git init
git add .
git commit -m "Jarvis snapshot"
git push origin main
```

On another machine:
```bash
git clone <repo> ~/.clade/agents/jarvis
# Then register in config
```

## What Transfers

| Component | Included | Notes |
|-----------|----------|-------|
| SOUL.md | Yes | Full personality, including evolved traits |
| Memory | Yes | All daily logs and curated MEMORY.md |
| Soul History | Yes | All previous SOUL.md versions |
| Config | Yes | Agent-specific settings in manifest |
| Sessions | No | Sessions are machine-specific |
| MCP Servers | No | MCP servers must be installed on the target machine |

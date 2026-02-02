# clade skill

Manage MCP skill servers.

## Subcommands

### `clade skill list`

List all skills (active and pending).

```bash
clade skill list
```

### `clade skill approve`

Approve a pending skill for activation.

```bash
clade skill approve @mcp/github-server
```

## How Skills Work

1. An agent requests a skill via the Skills MCP server
2. The skill is staged in `~/.clade/skills/pending/`
3. You review and approve via `clade skill approve` or the admin UI
4. Once approved, the skill is available to agents

See [Skills (MCP)](/concepts/skills) for full details.

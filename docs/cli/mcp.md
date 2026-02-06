# clade mcp

Manage MCP servers.

## Subcommands

### `clade mcp list`

List all MCP servers (active and pending).

```bash
clade mcp list
```

### `clade mcp approve`

Approve a pending MCP server for activation.

```bash
clade mcp approve @mcp/github-server
```

## How MCP Servers Work

1. An agent requests an MCP server via the MCP Manager
2. The MCP server is staged in `~/.clade/mcp/pending/`
3. You review and approve via `clade mcp approve` or the admin UI
4. Once approved, the MCP server is available to agents

See [MCP Servers](/concepts/mcp) for full details.

# MCP Servers

MCP servers in Clade are standard MCP (Model Context Protocol) servers. No proprietary format — any MCP-compatible tool works.

## Built-in MCP Servers

Clade ships with five custom MCP servers:

| Server | Purpose |
|--------|---------|
| **Memory** | Persistent agent memory with full-text search |
| **Sessions** | Session management, sub-agent spawning |
| **Messaging** | Cross-channel message sending |
| **MCP Manager** | MCP server discovery, installation, management |
| **Platform** | Native OS interaction (notifications, clipboard, URLs) |

These are automatically available to agents based on their tool preset.

## Discovering MCP Servers

Agents can search for new MCP servers from the npm registry:

```
Agent: "I need a tool to interact with GitHub"
→ MCP Manager searches npm for MCP servers matching "github"
→ Finds: @mcp/github-server
→ Stages in ~/.clade/mcp/pending/
```

## Approval Gate

Agent-requested MCP servers go to `pending/` and **require human approval** before activation:

```bash
# List pending MCP servers
clade mcp list

# Approve an MCP server
clade mcp approve @mcp/github-server
```

This prevents agents from installing arbitrary tools without oversight.

## Creating Custom MCP Servers

Agents can also create custom MCP server configs:

```json
{
  "name": "project-tools",
  "command": "node",
  "args": ["./my-mcp-server.js"],
  "env": {}
}
```

Custom MCP servers also go through the approval gate.

## MCP Server Configuration

MCP servers are injected into agent sessions via `--mcp-config`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["./dist/mcp/memory-server.js"],
      "env": { "AGENT_ID": "jarvis" }
    },
    "github": {
      "command": "npx",
      "args": ["@mcp/github-server"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

Each agent session gets its own MCP config file with only the MCP servers that agent has access to.

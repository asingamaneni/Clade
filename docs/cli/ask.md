# clade ask

Send a one-off question to an agent.

## Usage

```bash
clade ask [options] "<prompt>"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--agent <name>` | Which agent to ask | Default agent from config |

## Examples

```bash
# Ask the default agent
clade ask "What's the status of the project?"

# Ask a specific agent
clade ask --agent researcher "What are the latest trends in AI agents?"

# Multi-line prompt
clade ask "Summarize these files:
  - src/engine/ralph.ts
  - src/agents/reflection.ts"
```

## Notes

- Creates a new session for each invocation (no conversation continuity)
- Uses the agent's configured model, tools, and MCP servers
- Output is printed to stdout

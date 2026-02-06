# CLI Reference

Clade is primarily a CLI tool. All commands are available via the `clade` binary.

## Commands

| Command | Description |
|---------|-------------|
| [`clade setup`](/cli/setup) | Interactive setup wizard |
| [`clade start`](/cli/start) | Start the gateway server |
| [`clade agent`](/cli/agent) | Create, list, export, import agents |
| [`clade ask`](/cli/ask) | One-off question to an agent |
| [`clade work`](/cli/work) | Start RALPH autonomous work loop |
| [`clade mcp`](/cli/mcp) | Manage MCP servers |
| [`clade ui`](/cli/ui) | Open admin dashboard in browser |
| [`clade docs`](/cli/docs) | Open or serve documentation |
| [`clade doctor`](/cli/doctor) | Health check |

## Global Options

```bash
clade --version    # Print version
clade --help       # Show help
clade <cmd> --help # Show help for a specific command
```

## Getting Help

```bash
# Check your installation
clade doctor

# See all commands
clade --help
```

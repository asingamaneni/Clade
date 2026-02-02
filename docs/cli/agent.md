# clade agent

Create, list, export, and import agents.

## Subcommands

### `clade agent create`

Create a new agent.

```bash
# From a template
clade agent create --name jarvis --template coding

# Interactively
clade agent create
```

| Option | Description |
|--------|-------------|
| `--name <name>` | Agent identifier (used in config and @mentions) |
| `--template <template>` | Starting template: `coding`, `research`, `ops`, `pm` |

### `clade agent list`

List all registered agents.

```bash
clade agent list
```

### `clade agent export`

Export an agent as a portable `.agent.tar.gz` bundle.

```bash
clade agent export jarvis
# Creates: jarvis.agent.tar.gz
```

### `clade agent import`

Import an agent from a bundle.

```bash
clade agent import jarvis.agent.tar.gz
```

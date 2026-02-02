# clade work

Start a RALPH autonomous work loop.

## Usage

```bash
clade work --agent <name> --plan <path> [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--agent <name>` | Agent to perform the work | Required |
| `--plan <path>` | Path to the PLAN.md task list | Required |
| `--verify <cmd>` | Verification command to run after each task | None |
| `--max-retries <n>` | Max retries per task before marking blocked | `3` |

## Examples

```bash
# Coding work with test verification
clade work --agent coder --plan ./PLAN.md --verify "npm test"

# Research work
clade work --agent researcher --plan ./research-plan.md

# Ops work
clade work --agent ops --plan ./incident-tasks.md
```

## Plan Format

Standard markdown checkboxes:

```markdown
- [ ] First task to complete
- [ ] Second task to complete
- [x] Already done (skipped)
- [ ] Another task
  Context: additional details for the agent
```

See [RALPH](/guide/ralph) for full details on how the work loop operates.

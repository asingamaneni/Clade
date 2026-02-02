# clade doctor

Run a health check on your Clade installation.

## Usage

```bash
clade doctor
```

## What It Checks

- Claude CLI is installed and accessible
- Claude CLI version and available flags
- `~/.clade/` directory exists and is writable
- `config.json` is valid
- SQLite database is accessible
- Agent directories are intact
- MCP servers can be spawned
- Channel tokens are configured (if channels enabled)

## Example Output

```
Clade Doctor
─────────────────────────────

  ✓ Claude CLI found (v1.2.3)
  ✓ Config directory (~/.clade)
  ✓ Config file valid (v2)
  ✓ SQLite database OK
  ✓ 3 agents registered
  ✓ Memory MCP server OK
  ✓ Sessions MCP server OK
  ⚠ Slack: no bot token configured
  ✓ Telegram: connected

All checks passed (1 warning)
```
